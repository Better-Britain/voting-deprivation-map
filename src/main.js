const DEPRIVATION_GEOJSON_URL = new URL("../deprivation/output/catchment_lsoa_imd_2025.geojson", import.meta.url).href;
const DEPRIVATION_SUMMARY_URL = new URL("../deprivation/output/catchment_lsoa_imd_2025_summary.json", import.meta.url).href;
const WARDS_GEOJSON_URL = new URL("./data/greater-manchester-wards.geojson", import.meta.url).href;
const COUNCILS_GEOJSON_URL = new URL("./data/greater-manchester-councils.geojson", import.meta.url).href;
const WARD_ELECTION_STATE_URL = new URL("./data/greater-manchester-ward-election-state.json", import.meta.url).href;
const WARD_DEPRIVATION_INDEX_URL = new URL("./data/ward-deprivation-vote-index.json", import.meta.url).href;

const MAP_VIEW_STORAGE_KEY = "voterDeprivation.mapView.v1";
const DEFAULT_VIEW = {
  lat: 53.48,
  lng: -2.24,
  zoom: 10
};

function loadStoredMapView() {
  try {
    const raw = localStorage.getItem(MAP_VIEW_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VIEW, hasStoredView: false };
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    const zoom = Number(parsed?.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
      return { ...DEFAULT_VIEW, hasStoredView: false };
    }
    return { lat, lng, zoom, hasStoredView: true };
  } catch (_error) {
    return { ...DEFAULT_VIEW, hasStoredView: false };
  }
}

function saveMapView() {
  try {
    const center = map.getCenter();
    const payload = {
      lat: Number(center.lat.toFixed(6)),
      lng: Number(center.lng.toFixed(6)),
      zoom: map.getZoom()
    };
    localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify(payload));
  } catch (_error) {
    // Ignore storage failures.
  }
}

const initialView = loadStoredMapView();
const map = L.map("map", { zoomControl: true, attributionControl: true }).setView(
  [initialView.lat, initialView.lng],
  initialView.zoom
);
map.createPane("deprivationPane");
map.getPane("deprivationPane").style.zIndex = "410";
map.createPane("effectsPane");
map.getPane("effectsPane").style.zIndex = "420";
map.createPane("electionPane");
map.getPane("electionPane").style.zIndex = "460";
map.createPane("hoverPane");
map.getPane("hoverPane").style.zIndex = "470";
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const ZoomDebugControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    container.style.background = "rgba(255,255,255,0.95)";
    container.style.padding = "4px 8px";
    container.style.font = '700 12px/1 "Avenir Next", "Trebuchet MS", sans-serif';
    container.style.color = "#111";
    container.style.userSelect = "none";
    container.style.pointerEvents = "none";
    container.textContent = `z ${map.getZoom()}`;
    this._container = container;
    return container;
  },
  update() {
    if (this._container) this._container.textContent = `z ${map.getZoom()}`;
  }
});
const zoomDebugControl = new ZoomDebugControl();
map.addControl(zoomDebugControl);

const mapStage = document.getElementById("map-stage");
const collapseButton = document.getElementById("legend-collapse");
const deprivationToggle = document.getElementById("deprivation-toggle");
const effectsToggle = document.getElementById("effects-toggle");
const councilResultsToggle = document.getElementById("council-results-toggle");
const wardResultsToggle = document.getElementById("ward-results-toggle");
const wardFillToggle = document.getElementById("ward-fill-toggle");
const deprivationStatus = document.getElementById("deprivation-status");
const deprivationStats = document.getElementById("deprivation-stats");
const informationLayerStatus = document.getElementById("information-layer-status");
const wardHoverStatus = document.getElementById("ward-hover-status");
const hoverInfoPanel = document.getElementById("hover-info-panel");
const wardDeprivationSummary = document.getElementById("ward-deprivation-summary");
const wardDeprivationBars = document.getElementById("ward-deprivation-bars");
const wardDeprivationTable = document.getElementById("ward-deprivation-table");

let deprivationLayer = null;
let effectsLayer = null;
let wardFeatures = [];
let councilFeatures = [];
let activeHoveredWardCode = null;
let activeHoveredWardLayer = null;
let declaredWardResultsLayer = null;
let declaredCouncilResultsLayer = null;
let wardElectionStateByCode = new Map();
let declaredWinnerCount = 0;
let declaredCouncilCount = 0;
let declaredWardCount = 0;
const RESULTS_RENDER_MODE = "council";
const COUNCIL_RESULTS_MIN_ZOOM = 6;
const WARD_RESULTS_MIN_ZOOM = 11;
let deprivationFeatures = [];
let hoverInfoTimer = null;

const PARTY_COLORS = {
  "labour": "#e4003b",
  "conservative and unionist": "#0087dc",
  "conservative": "#0087dc",
  "liberal democrats": "#faa61a",
  "green party": "#6ab023",
  "reform uk": "#12b6cf",
  "scottish national party (snp)": "#fdf38e",
  "plaid cymru - the party of wales": "#008142",
  "uk independence party (ukip)": "#70147a",
  "independent": "#9ca3af"
};

const INFORMATION_LAYER_DEFINITIONS = [
  {
    id: "logistics-extraction",
    name: "Logistics Extraction",
    description: "Illustrative freight/distribution pull from local spend.",
    entries: [
      { label: "Trafford Park", lat: 53.466, lon: -2.316, impactKm: 11, estimateMGBP: -95 },
      { label: "Heywood Hub", lat: 53.588, lon: -2.222, impactKm: 9, estimateMGBP: -48 }
    ]
  },
  {
    id: "retail-leakage",
    name: "Retail Leakage",
    description: "Approximate leakage to major retail destinations.",
    entries: [
      { label: "Regional Mall Belt", lat: 53.438, lon: -2.359, impactKm: 10, estimateMGBP: -72 },
      { label: "Airport Corridor Spend", lat: 53.353, lon: -2.272, impactKm: 8, estimateMGBP: -34 }
    ]
  },
  {
    id: "development-injection",
    name: "Development Injection",
    description: "Example inward investment/development uplift.",
    entries: [
      { label: "City Core Regeneration", lat: 53.481, lon: -2.242, impactKm: 7, estimateMGBP: 88 },
      { label: "North Corridor Buildout", lat: 53.546, lon: -2.116, impactKm: 9, estimateMGBP: 41 }
    ]
  }
];

function getDecileColor(decileValue) {
  const decile = Number(decileValue);
  if (!Number.isFinite(decile)) return "#9aa0a6";
  if (decile <= 2) return "#b23322";
  if (decile <= 4) return "#d4821f";
  if (decile <= 6) return "#cfb536";
  if (decile <= 8) return "#6eab55";
  return "#1f7a3f";
}

function createPopupContent(feature) {
  const props = feature?.properties || {};
  const name = props.lsoa21nm || props.lsoa21cd || "Unknown LSOA";
  const decile = props.imd_decile ?? "n/a";
  const score = Number.isFinite(props.imd_score) ? props.imd_score.toFixed(2) : "n/a";
  const rank = props.imd_rank ?? "n/a";
  const population = props.population_2022 ?? "n/a";
  return [
    `<strong>${name}</strong>`,
    `IMD 2025 decile: ${decile}`,
    `IMD score: ${score}`,
    `IMD rank: ${rank}`,
    `Population (2022): ${population}`
  ].join("<br>");
}

function applyLayerVisibility() {
  if (!deprivationLayer) return;
  const isVisible = deprivationToggle.checked;
  if (isVisible) {
    if (!map.hasLayer(deprivationLayer)) deprivationLayer.addTo(map);
    deprivationStatus.textContent = "";
  } else {
    if (map.hasLayer(deprivationLayer)) map.removeLayer(deprivationLayer);
    deprivationStatus.textContent = "Deprivation layer hidden.";
  }
}

function formatEstimate(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}GBP ${Math.abs(value).toLocaleString()}m`;
}

function estimateColor(value) {
  return value < 0 ? "#b23322" : "#1f7a3f";
}

function buildSectorEffectLayer(definition) {
  const group = L.layerGroup();
  for (const entry of definition.entries) {
    const radiusMeters = Number(entry.impactKm) * 1000;
    const color = estimateColor(Number(entry.estimateMGBP));
    const popupHtml = [
      `<strong>${entry.label}</strong>`,
      `Layer: ${definition.name}`,
      `Estimated effect: ${formatEstimate(Number(entry.estimateMGBP))}`,
      `Impact radius: ${entry.impactKm} km`
    ].join("<br>");
    const rings = [
      L.circle([entry.lat, entry.lon], { radius: radiusMeters, stroke: false, fillColor: color, fillOpacity: 0.08 }),
      L.circle([entry.lat, entry.lon], { radius: radiusMeters * 0.66, stroke: false, fillColor: color, fillOpacity: 0.16 }),
      L.circle([entry.lat, entry.lon], { radius: radiusMeters * 0.38, color, weight: 1, fillColor: color, fillOpacity: 0.24 }),
      L.circleMarker([entry.lat, entry.lon], { radius: 4, color, weight: 1, fillColor: color, fillOpacity: 0.95 }),
      L.marker([entry.lat, entry.lon], {
        icon: L.divIcon({
          className: "",
          html: `<span class="effect-label"><span class="effect-label-title">${entry.label}</span><span class="effect-label-metric">${formatEstimate(Number(entry.estimateMGBP))}</span></span>`,
          iconSize: [170, 44],
          iconAnchor: [10, 20]
        })
      })
    ];
    for (const layer of rings) {
      layer.bindPopup(popupHtml);
      group.addLayer(layer);
    }
  }
  return group;
}

function buildCombinedEffectsLayer() {
  const group = L.layerGroup();
  for (const definition of INFORMATION_LAYER_DEFINITIONS) {
    const subLayer = buildSectorEffectLayer(definition);
    subLayer.eachLayer((item) => group.addLayer(item));
  }
  effectsLayer = group;

  const categoryCount = INFORMATION_LAYER_DEFINITIONS.length;
  const pointCount = INFORMATION_LAYER_DEFINITIONS.reduce((sum, def) => sum + def.entries.length, 0);
  if (informationLayerStatus) {
    informationLayerStatus.textContent = `Effects layer ready (${categoryCount} subcategories, ${pointCount} locations).`;
  }
}

function applyEffectsVisibility() {
  if (!effectsLayer) return;
  const showEffects = Boolean(effectsToggle?.checked);
  if (showEffects) {
    if (!map.hasLayer(effectsLayer)) effectsLayer.addTo(map);
    if (informationLayerStatus) informationLayerStatus.textContent = "Effects layer visible (all subcategories).";
  } else {
    if (map.hasLayer(effectsLayer)) map.removeLayer(effectsLayer);
    if (informationLayerStatus) informationLayerStatus.textContent = "Effects layer hidden.";
  }
}

function pointInRing(point, ring) {
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function hideHoverInfoPanel() {
  if (hoverInfoTimer) {
    clearTimeout(hoverInfoTimer);
    hoverInfoTimer = null;
  }
  hoverInfoPanel.hidden = true;
  hoverInfoPanel.innerHTML = "";
}

function showHoverInfoPanel(lines) {
  if (!Array.isArray(lines) || !lines.length) return;
  if (hoverInfoTimer) clearTimeout(hoverInfoTimer);
  hoverInfoTimer = setTimeout(() => {
    hoverInfoPanel.innerHTML = lines
      .map((line) => `<div class="hover-info-row">${line}</div>`)
      .join("");
    hoverInfoPanel.hidden = false;
  }, 220);
}

function pointInPolygonGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates || [];
    if (!rings.length) return false;
    if (!pointInRing(point, rings[0])) return false;
    for (let i = 1; i < rings.length; i += 1) {
      if (pointInRing(point, rings[i])) return false;
    }
    return true;
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates || []).some((polygonRings) => {
      if (!polygonRings.length) return false;
      if (!pointInRing(point, polygonRings[0])) return false;
      for (let i = 1; i < polygonRings.length; i += 1) {
        if (pointInRing(point, polygonRings[i])) return false;
      }
      return true;
    });
  }
  return false;
}

function clearHoveredWard() {
  if (activeHoveredWardLayer && map.hasLayer(activeHoveredWardLayer)) {
    map.removeLayer(activeHoveredWardLayer);
  }
  activeHoveredWardLayer = null;
  activeHoveredWardCode = null;
}

function normalizePartyName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getWinnerPartyColor(partyName) {
  const normalized = normalizePartyName(partyName);
  if (PARTY_COLORS[normalized]) return PARTY_COLORS[normalized];
  if (normalized.includes("labour")) return PARTY_COLORS.labour;
  if (normalized.includes("conservative")) return PARTY_COLORS["conservative"];
  if (normalized.includes("liberal")) return PARTY_COLORS["liberal democrats"];
  if (normalized.includes("green")) return PARTY_COLORS["green party"];
  if (normalized.includes("reform")) return PARTY_COLORS["reform uk"];
  if (normalized.includes("independent")) return PARTY_COLORS.independent;
  return "#6b7280";
}

let outlineClipCounter = 0;

function ensureSvgDefs(svgRoot) {
  let defs = svgRoot.querySelector("defs[data-vd-outline-defs='1']");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.setAttribute("data-vd-outline-defs", "1");
    svgRoot.insertBefore(defs, svgRoot.firstChild || null);
  }
  return defs;
}

function applyInsideStrokeClip(layer, clipKey) {
  const pathEl = layer?._path;
  if (!pathEl || !pathEl.ownerSVGElement) return;
  const svgRoot = pathEl.ownerSVGElement;
  const defs = ensureSvgDefs(svgRoot);
  if (!pathEl.dataset.vdClipUid) pathEl.dataset.vdClipUid = String(++outlineClipCounter);
  const safeKey = String(clipKey || `outline-${++outlineClipCounter}`).replace(/[^a-z0-9_-]+/gi, "-");
  const pathId = `vd-path-${safeKey}-${pathEl.dataset.vdClipUid}`;
  const clipId = `vd-clip-${safeKey}-${pathEl.dataset.vdClipUid}`;
  pathEl.setAttribute("id", pathId);
  let clipPathEl = defs.querySelector(`clipPath#${clipId}`);
  if (!clipPathEl) {
    clipPathEl = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
    clipPathEl.setAttribute("id", clipId);
    const useEl = document.createElementNS("http://www.w3.org/2000/svg", "use");
    useEl.setAttribute("href", `#${pathId}`);
    useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${pathId}`);
    clipPathEl.appendChild(useEl);
    defs.appendChild(clipPathEl);
  } else {
    const useEl = clipPathEl.querySelector("use");
    if (useEl) {
      useEl.setAttribute("href", `#${pathId}`);
      useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${pathId}`);
    }
  }
  pathEl.setAttribute("clip-path", `url(#${clipId})`);
}

function renderHoveredWard(feature) {
  clearHoveredWard();
  activeHoveredWardCode = feature?.properties?.WD24CD || null;
  const { hoverWeight } = getElectionStrokeWeightsForZoom(map.getZoom());
  activeHoveredWardLayer = L.geoJSON(feature, {
    pane: "hoverPane",
    style: {
      color: "#0f5e9c",
      weight: hoverWeight,
      opacity: 1,
      fill: false
    }
  }).addTo(map);
  activeHoveredWardLayer.eachLayer((layer) => {
    layer.on("add", () => applyInsideStrokeClip(layer, `hover-${activeHoveredWardCode || "unknown"}`));
    applyInsideStrokeClip(layer, `hover-${activeHoveredWardCode || "unknown"}`);
  });
  const props = feature?.properties || {};
  const wardCode = props.WD24CD || "";
  const electionState = wardElectionStateByCode.get(wardCode);
  const incumbentParty = electionState?.incumbent_party || "Unknown";
  const wardWinnerParty = electionState?.winner_party || null;
  const councilControl = electionState?.council_result_declared
    ? (electionState?.council_winner_party || "declared")
    : "pending";
  const displayedWinner = RESULTS_RENDER_MODE === "council"
    ? councilControl
    : (wardWinnerParty || "pending");
  wardHoverStatus.textContent = `${props.WD24NM || props.WD24CD || "Unknown"} · ${displayedWinner}`;

  const popupHtml = [
    `<strong>${props.WD24NM || "Unknown ward"}</strong>`,
    `Ward code: ${wardCode || "n/a"}`,
    `Authority: ${props.LAD24NM || "n/a"}`,
    `Incumbent: ${incumbentParty}`,
    `Ward winner: ${wardWinnerParty || "pending"}`,
    `Displayed winner (${RESULTS_RENDER_MODE}): ${displayedWinner}`,
    `Council control: ${councilControl}`
  ].join("<br>");
  activeHoveredWardLayer.bindPopup(popupHtml);
}

function findWardFeatureAt(latlng) {
  for (const candidate of wardFeatures) {
    if (!candidate.bounds.contains(latlng)) continue;
    if (pointInPolygonGeometry(latlng, candidate.feature.geometry)) {
      return candidate.feature;
    }
  }
  return null;
}

function findDeprivationFeatureAt(latlng) {
  for (const feature of deprivationFeatures) {
    if (pointInPolygonGeometry(latlng, feature.geometry)) return feature;
  }
  return null;
}

function findEffectsAt(latlng) {
  const matches = [];
  for (const definition of INFORMATION_LAYER_DEFINITIONS) {
    for (const entry of definition.entries) {
      const meters = map.distance([latlng.lat, latlng.lng], [entry.lat, entry.lon]);
      if (meters <= Number(entry.impactKm) * 1000) {
        matches.push(`${definition.name}: ${entry.label}`);
      }
    }
  }
  return matches;
}

function buildHoverInfoLines(latlng, hoveredFeature) {
  const lines = [];
  if (hoveredFeature) {
    const props = hoveredFeature.properties || {};
    const wardCode = props.WD24CD || "";
    const electionState = wardElectionStateByCode.get(wardCode);
    const councilControl = electionState?.council_result_declared
      ? (electionState?.council_winner_party || "declared")
      : "pending";
    lines.push(`${props.WD24NM || wardCode || "Unknown"}`);
    if (councilResultsToggle.checked) lines.push(`${councilControl}`);
    if (wardResultsToggle.checked) lines.push(`${electionState?.winner_party || "pending"}`);
  }
  if (deprivationToggle.checked) {
    const deprivationFeature = findDeprivationFeatureAt(latlng);
    if (deprivationFeature?.properties) {
      const p = deprivationFeature.properties;
      lines.push(`D${p.imd_decile ?? "?"}`);
    }
  }
  // if (effectsToggle.checked) {
  //   const effectMatches = findEffectsAt(latlng);
  //   if (effectMatches.length) {
  //     lines.push(`${effectMatches.slice(0, 2).join(" · ")}`);
  //   }
  // }
  return lines;
}

function getElectionStrokeWeightsForZoom(zoom) {
  const z = Number.isFinite(zoom) ? zoom : map.getZoom();
  if (z <= 8) {
    return { councilWeight: 4, wardWeight: 0, hoverWeight: 0 };
  }
  if (z === 9) {
    return { councilWeight: 5, wardWeight: 5, hoverWeight: 1.25 };
  }
  if (z === 10) {
    return { councilWeight: 6, wardWeight: 6, hoverWeight: 1.5 };
  }
  if (z === 11) {
    return { councilWeight: 7, wardWeight: 7, hoverWeight: 1.75 };
  }
  if (z === 12) {
    return { councilWeight: 8, wardWeight: 8, hoverWeight: 2 };
  }
  return { councilWeight: 10, wardWeight: 10, hoverWeight: 2.5 };
}

function updateElectionStrokeStylesForZoom() {
  const zoom = map.getZoom();
  const { councilWeight, wardWeight, hoverWeight } = getElectionStrokeWeightsForZoom(zoom);
  if (declaredCouncilResultsLayer) {
    declaredCouncilResultsLayer.eachLayer((layer) => {
      if (layer?.setStyle) layer.setStyle({ weight: councilWeight, opacity: 1, fill: false });
    });
  }
  if (declaredWardResultsLayer) {
    declaredWardResultsLayer.eachLayer((layer) => {
      if (!layer?.setStyle) return;
      const winnerColor = layer?.options?.winnerColor || layer?.options?.color || "#6b7280";
      if (wardFillToggle?.checked) {
        layer.setStyle({
          weight: wardWeight,
          opacity: 1,
          color: winnerColor,
          fill: true,
          fillColor: winnerColor,
          fillOpacity: 1
        });
      } else {
        layer.setStyle({
          weight: wardWeight,
          opacity: 1,
          color: winnerColor,
          fill: false,
          fillOpacity: 0
        });
      }
    });
  }
  if (activeHoveredWardLayer) {
    activeHoveredWardLayer.eachLayer((layer) => {
      if (layer?.setStyle) layer.setStyle({ weight: hoverWeight, opacity: 1, fill: false });
    });
  }
}

function rebuildDeclaredWardsLayer() {
  if (declaredWardResultsLayer && map.hasLayer(declaredWardResultsLayer)) {
    map.removeLayer(declaredWardResultsLayer);
  }
  if (declaredCouncilResultsLayer && map.hasLayer(declaredCouncilResultsLayer)) {
    map.removeLayer(declaredCouncilResultsLayer);
  }
  declaredWardResultsLayer = L.layerGroup();
  declaredCouncilResultsLayer = L.layerGroup();
  declaredWinnerCount = 0;
  declaredCouncilCount = 0;
  declaredWardCount = 0;

  const byAuthorityCode = new Map();
  for (const electionState of wardElectionStateByCode.values()) {
    const authorityCode = electionState?.authority_code;
    if (!authorityCode || byAuthorityCode.has(authorityCode)) continue;
    byAuthorityCode.set(authorityCode, electionState);
  }
  for (const candidate of councilFeatures) {
    const feature = candidate.feature;
    const authorityCode = feature?.properties?.LAD24CD;
    const councilState = byAuthorityCode.get(authorityCode);
    const winner = councilState?.council_result_declared
      ? (councilState?.council_winner_party || null)
      : null;
    if (!winner) continue;
    const color = getWinnerPartyColor(winner);
    const { councilWeight } = getElectionStrokeWeightsForZoom(map.getZoom());
    const councilLayer = L.geoJSON(feature, {
      pane: "electionPane",
      style: { color, weight: councilWeight, opacity: 1, fill: false, lineJoin: "round" }
    });
    councilLayer.bindPopup(
      [
        `<strong>${feature?.properties?.LAD24NM || authorityCode || "Council"}</strong>`,
        `Council control: ${winner}`
      ].join("<br>")
    );
    councilLayer.eachLayer((layer) => {
      layer.on("add", () => applyInsideStrokeClip(layer, `council-${authorityCode || "unknown"}`));
      declaredCouncilResultsLayer.addLayer(layer);
    });
    declaredCouncilCount += 1;
  }

  for (const candidate of wardFeatures) {
    const feature = candidate.feature;
    const wardCode = feature?.properties?.WD24CD;
    const electionState = wardElectionStateByCode.get(wardCode);
    const winner = electionState?.winner_party || null;
    if (!winner) continue;
    const color = getWinnerPartyColor(winner);
    const { wardWeight } = getElectionStrokeWeightsForZoom(map.getZoom());
    const wardLayer = L.geoJSON(feature, {
      pane: "electionPane",
      style: { color, weight: wardWeight, opacity: 1, fill: false, lineJoin: "round" }
    });
    wardLayer.bindPopup(
      [
        `<strong>${feature?.properties?.WD24NM || wardCode || "Ward"}</strong>`,
        `Ward winner: ${winner}`,
        `Incumbent: ${electionState?.incumbent_party || "Unknown"}`
      ].join("<br>")
    );
    wardLayer.eachLayer((layer) => {
      layer.options.winnerColor = color;
      layer.on("add", () => applyInsideStrokeClip(layer, `ward-${wardCode || "unknown"}`));
      declaredWardResultsLayer.addLayer(layer);
    });
    declaredWardCount += 1;
  }

  declaredWinnerCount = declaredCouncilCount + declaredWardCount;
  applyWardLayerVisibility();
}

function updateWardStatusDefault() {
  wardHoverStatus.textContent = `C:${declaredCouncilCount} W:${declaredWardCount}`;
}

function applyWardLayerVisibility() {
  const zoom = map.getZoom();
  const allowCouncilResultsAtZoom = zoom >= COUNCIL_RESULTS_MIN_ZOOM;
  const allowWardResultsAtZoom = zoom >= WARD_RESULTS_MIN_ZOOM;
  if (declaredCouncilResultsLayer) {
    if (councilResultsToggle?.checked && allowCouncilResultsAtZoom && declaredCouncilCount > 0) {
      if (!map.hasLayer(declaredCouncilResultsLayer)) declaredCouncilResultsLayer.addTo(map);
    } else if (map.hasLayer(declaredCouncilResultsLayer)) {
      map.removeLayer(declaredCouncilResultsLayer);
    }
  }
  if (declaredWardResultsLayer) {
    if (wardResultsToggle?.checked && allowWardResultsAtZoom && declaredWardCount > 0) {
      if (!map.hasLayer(declaredWardResultsLayer)) declaredWardResultsLayer.addTo(map);
    } else if (map.hasLayer(declaredWardResultsLayer)) {
      map.removeLayer(declaredWardResultsLayer);
    }
  }
}

async function loadWardHoverSource() {
  try {
    const response = await fetch(WARDS_GEOJSON_URL);
    if (!response.ok) {
      throw new Error(`Ward source request failed: ${response.status}`);
    }
    const geojson = await response.json();
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    wardFeatures = features
      .map((feature) => {
        const bounds = L.geoJSON(feature).getBounds();
        return { feature, bounds };
      })
      .filter((entry) => entry.bounds.isValid());
    rebuildDeclaredWardsLayer();
    updateWardStatusDefault();
  } catch (error) {
    console.error(error);
    wardHoverStatus.textContent = "Could not load ward boundaries. Run `yarn updates:maintenance`.";
  }
}

async function loadCouncilSource() {
  try {
    const response = await fetch(COUNCILS_GEOJSON_URL);
    if (!response.ok) {
      throw new Error(`Council source request failed: ${response.status}`);
    }
    const geojson = await response.json();
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    councilFeatures = features.map((feature) => ({ feature }));
    rebuildDeclaredWardsLayer();
    applyWardLayerVisibility();
    updateWardStatusDefault();
  } catch (error) {
    console.error(error);
  }
}

async function loadWardElectionState() {
  try {
    const response = await fetch(WARD_ELECTION_STATE_URL);
    if (!response.ok) {
      throw new Error(`Election state request failed: ${response.status}`);
    }
    const payload = await response.json();
    const wards = Array.isArray(payload?.wards) ? payload.wards : [];
    wardElectionStateByCode = new Map(
      wards
        .filter((entry) => entry?.ward_code)
        .map((entry) => [entry.ward_code, entry])
    );
    rebuildDeclaredWardsLayer();
    applyWardLayerVisibility();
    updateWardStatusDefault();
  } catch (error) {
    console.error(error);
    wardElectionStateByCode = new Map();
  }
}

async function loadDeprivationLayer() {
  try {
    const [geojsonResponse, summaryResponse] = await Promise.all([
      fetch(DEPRIVATION_GEOJSON_URL),
      fetch(DEPRIVATION_SUMMARY_URL)
    ]);
    if (!geojsonResponse.ok) throw new Error(`GeoJSON request failed: ${geojsonResponse.status}`);
    const geojson = await geojsonResponse.json();
    const summary = summaryResponse.ok ? await summaryResponse.json() : null;
    deprivationFeatures = Array.isArray(geojson?.features) ? geojson.features : [];
    deprivationLayer = L.geoJSON(geojson, {
      pane: "deprivationPane",
      style: (feature) => ({
        stroke: false,
        fillColor: getDecileColor(feature?.properties?.imd_decile),
        fillOpacity: 0.48
      }),
      onEachFeature: (feature, layer) => layer.bindPopup(createPopupContent(feature), { maxWidth: 320 })
    });
    if (!initialView.hasStoredView && deprivationLayer.getLayers().length > 0) {
      map.fitBounds(deprivationLayer.getBounds(), { padding: [16, 16] });
    }
    applyLayerVisibility();
    const featureCount = geojson?.features?.length || 0;
    const bbox = Array.isArray(summary?.bbox_wgs84) ? summary.bbox_wgs84.join(", ") : "n/a";
    deprivationStats.textContent = `Loaded ${featureCount.toLocaleString()} deprivation polygons. BBox: ${bbox}.`;
  } catch (error) {
    console.error(error);
    deprivationStatus.textContent = "Could not load deprivation layer.";
    deprivationStats.textContent = "Check file paths and run via a local static server.";
  }
}

function renderWardDeprivationTable(payload) {
  if (!wardDeprivationSummary || !wardDeprivationTable || !wardDeprivationBars) return;
  const parties = Array.isArray(payload?.parties) ? payload.parties : [];
  const wards = Array.isArray(payload?.wards) ? payload.wards : [];
  //const topParties = parties.slice(0, 8);
  const topParties = [...parties]
    .sort((a, b) =>
      Number(a.deprivation_weighted_mean_decile || 0) -
      Number(b.deprivation_weighted_mean_decile || 0)
    );
    // .slice(0, 8);
  const summary = payload?.summary || {};
  wardDeprivationSummary.textContent =
    `Declared wards: ${(summary.wards_with_declared_winner || 0).toLocaleString()} / ${(summary.wards_total || 0).toLocaleString()}.`;
  if (!topParties.length) {
    wardDeprivationBars.innerHTML = "";
    wardDeprivationTable.innerHTML = "";
    return;
  }
  const topPartyNames = new Set(topParties.map((row) => row.party));
  const decilePartyTotals = {};
  for (let d = 1; d <= 10; d += 1) decilePartyTotals[String(d)] = {};
  for (const ward of wards) {
    const party = ward?.winner_party;
    if (!party) continue;
    const shares = ward?.deprivation_area_share_by_decile || {};
    for (let d = 1; d <= 10; d += 1) {
      const key = String(d);
      const value = Number(shares[key] || 0);
      if (value <= 0) continue;
      const bucketParty = topPartyNames.has(party) ? party : "Other";
      decilePartyTotals[key][bucketParty] = (decilePartyTotals[key][bucketParty] || 0) + value;
    }
  }
  const partyColorByName = Object.fromEntries(topParties.map((p) => [p.party, getWinnerPartyColor(p.party)]));
  partyColorByName.Other = "#9ca3af";
  const stackedRows = [];
  for (let d = 1; d <= 10; d += 1) {
    const key = String(d);
    const totals = decilePartyTotals[key];
    const total = Object.values(totals).reduce((sum, v) => sum + v, 0);
    const segments = Object.entries(totals)
      .map(([party, value]) => ({ party, share: total > 0 ? value / total : 0 }))
      .sort((a, b) => b.share - a.share)
      .filter((x) => x.share > 0.001);
    const segmentHtml = segments
      .map(
        (seg) =>
          `<span class="stacked-segment" style="width:${(seg.share * 100).toFixed(2)}%;background:${partyColorByName[seg.party] || "#6b7280"}" title="${seg.party}: ${(seg.share * 100).toFixed(1)}%"></span>`
      )
      .join("");
    stackedRows.push(
      `<div class="stacked-row"><div class="stacked-label">${d === 10 ? "Richest" : d === 1 ? "Poorest" : "Decile " + d}</div><div class="stacked-track">${segmentHtml}</div></div>`
    );
  }
  const legendItems = [...topParties.map((p) => p.party), "Other"]
    .map((party) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:2px;background:${partyColorByName[party] || "#6b7280"};display:inline-block;"></span>${party}</span>`)
    .join("");
  wardDeprivationBars.innerHTML = `<div class="stacked-bars">${stackedRows.join("")}</div><div class="stacked-legend">${legendItems}</div>`;
  wardDeprivationTable.innerHTML = [
    '<table class="simple-table">',
    "<thead><tr><th>Party</th><th>Wards Won</th><th>Weighted Decile</th></tr></thead>",
    "<tbody>",
    ...topParties.map((row, rownum) => (
      `<tr><td>${row.party || "Unknown"}</td><td>${Number(row.wards_won || 0).toLocaleString()}</td><td>${Number(row.deprivation_weighted_mean_decile || 0).toFixed(2)}${rownum===0?' (poorest)':(rownum===10?' (richest)':'')}</td></tr>`
    )),
    "</tbody></table><br/><p class='hint'>TODO: Rendering distribution, rather than averages, might illustrate this better</p>"
  ].join("");
}

async function loadWardDeprivationIndex() {
  if (!wardDeprivationSummary || !wardDeprivationTable || !wardDeprivationBars) return;
  try {
    const response = await fetch(WARD_DEPRIVATION_INDEX_URL);
    if (!response.ok) throw new Error(`Ward deprivation index request failed: ${response.status}`);
    const payload = await response.json();
    renderWardDeprivationTable(payload);
  } catch (_error) {
    wardDeprivationSummary.textContent = "Ward deprivation index unavailable. Run `yarn deprivation:index:update`.";
    wardDeprivationBars.innerHTML = "";
    wardDeprivationTable.innerHTML = "";
  }
}

collapseButton.addEventListener("click", () => {
  const isCollapsed = mapStage.classList.toggle("is-collapsed");
  collapseButton.innerHTML = isCollapsed ? "&rsaquo;" : "&lsaquo;";
  collapseButton.setAttribute("aria-pressed", isCollapsed ? "true" : "false");
  setTimeout(() => map.invalidateSize(), 180);
});

deprivationToggle.addEventListener("change", applyLayerVisibility);
if (effectsToggle) {
  effectsToggle.addEventListener("change", applyEffectsVisibility);
}
councilResultsToggle.addEventListener("change", () => {
  applyWardLayerVisibility();
  updateWardStatusDefault();
});
wardResultsToggle.addEventListener("change", () => {
  applyWardLayerVisibility();
  updateWardStatusDefault();
});
if (wardFillToggle) {
  wardFillToggle.addEventListener("change", () => {
    updateElectionStrokeStylesForZoom();
  });
}
map.on("mousemove", (event) => {
  const hoveredFeature = wardFeatures.length ? findWardFeatureAt(event.latlng) : null;
  if (!hoveredFeature) {
    clearHoveredWard();
    updateWardStatusDefault();
  } else {
    const hoveredCode = hoveredFeature?.properties?.WD24CD || null;
    if (!(hoveredCode && hoveredCode === activeHoveredWardCode)) {
      renderHoveredWard(hoveredFeature);
    }
  }
  const lines = buildHoverInfoLines(event.latlng, hoveredFeature);
  if (lines.length) showHoverInfoPanel(lines);
});

map.on("mouseout", () => {
  clearHoveredWard();
  updateWardStatusDefault();
});

map.on("click", () => {
  hideHoverInfoPanel();
});

map.on("moveend", saveMapView);
map.on("zoomend", saveMapView);
map.on("zoomend", () => {
  zoomDebugControl.update();
  updateElectionStrokeStylesForZoom();
  applyWardLayerVisibility();
  updateWardStatusDefault();
});

buildCombinedEffectsLayer();
applyEffectsVisibility();
await loadWardHoverSource();
await loadCouncilSource();
await loadWardElectionState();
loadDeprivationLayer();
loadWardDeprivationIndex();
