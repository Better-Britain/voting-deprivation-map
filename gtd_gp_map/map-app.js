const DEPRIVATION_GEOJSON_URL = "../deprivation/output/catchment_lsoa_imd_2025.geojson";
const DEPRIVATION_SUMMARY_URL = "../deprivation/output/catchment_lsoa_imd_2025_summary.json";

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true
}).setView([53.48, -2.24], 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const mapStage = document.getElementById("map-stage");
const collapseButton = document.getElementById("legend-collapse");
const deprivationToggle = document.getElementById("deprivation-toggle");
const deprivationStatus = document.getElementById("deprivation-status");
const deprivationStats = document.getElementById("deprivation-stats");
const informationLayerControls = document.getElementById("information-layer-controls");
const informationLayerStatus = document.getElementById("information-layer-status");

let deprivationLayer = null;
const informationLayers = new Map();

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
    if (!map.hasLayer(deprivationLayer)) {
      deprivationLayer.addTo(map);
    }
    deprivationStatus.textContent = "Deprivation layer visible.";
  } else {
    if (map.hasLayer(deprivationLayer)) {
      map.removeLayer(deprivationLayer);
    }
    deprivationStatus.textContent = "Deprivation layer hidden.";
  }
}

function formatEstimate(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}GBP ${Math.abs(value).toLocaleString()}m`;
}

function estimateColor(value) {
  if (value < 0) return "#b23322";
  return "#1f7a3f";
}

function buildSectorEffectLayer(definition) {
  const group = L.layerGroup();

  for (const entry of definition.entries) {
    const radiusMeters = Number(entry.impactKm) * 1000;
    const color = estimateColor(Number(entry.estimateMGBP));

    const outer = L.circle([entry.lat, entry.lon], {
      radius: radiusMeters,
      stroke: false,
      fillColor: color,
      fillOpacity: 0.08
    });
    const middle = L.circle([entry.lat, entry.lon], {
      radius: radiusMeters * 0.66,
      stroke: false,
      fillColor: color,
      fillOpacity: 0.16
    });
    const inner = L.circle([entry.lat, entry.lon], {
      radius: radiusMeters * 0.38,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.24
    });
    const centerDot = L.circleMarker([entry.lat, entry.lon], {
      radius: 4,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.95
    });

    const popupHtml = [
      `<strong>${entry.label}</strong>`,
      `Layer: ${definition.name}`,
      `Estimated effect: ${formatEstimate(Number(entry.estimateMGBP))}`,
      `Impact radius: ${entry.impactKm} km`
    ].join("<br>");

    outer.bindPopup(popupHtml);
    middle.bindPopup(popupHtml);
    inner.bindPopup(popupHtml);
    centerDot.bindPopup(popupHtml);

    const marker = L.marker([entry.lat, entry.lon], {
      icon: L.divIcon({
        className: "",
        html: `<span class="effect-label"><span class="effect-label-title">${entry.label}</span><span class="effect-label-metric">${formatEstimate(Number(entry.estimateMGBP))}</span></span>`,
        iconSize: [170, 44],
        iconAnchor: [10, 20]
      })
    });
    marker.bindPopup(popupHtml);

    group.addLayer(outer);
    group.addLayer(middle);
    group.addLayer(inner);
    group.addLayer(centerDot);
    group.addLayer(marker);
  }

  return group;
}

function syncInformationLayer(definition, enabled) {
  const layer = informationLayers.get(definition.id);
  if (!layer) return;
  if (enabled) {
    if (!map.hasLayer(layer)) layer.addTo(map);
  } else if (map.hasLayer(layer)) {
    map.removeLayer(layer);
  }
}

function buildInformationLayerControls() {
  informationLayerControls.innerHTML = "";

  for (const definition of INFORMATION_LAYER_DEFINITIONS) {
    const layer = buildSectorEffectLayer(definition);
    informationLayers.set(definition.id, layer);

    const label = document.createElement("label");
    label.className = "layer-toggle-label";
    label.setAttribute("for", `layer-toggle-${definition.id}`);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `layer-toggle-${definition.id}`;
    checkbox.checked = false;

    const textWrap = document.createElement("span");
    const title = document.createElement("span");
    title.className = "layer-toggle-title";
    title.textContent = definition.name;
    const note = document.createElement("span");
    note.className = "layer-toggle-note";
    note.textContent = definition.description;

    textWrap.appendChild(title);
    textWrap.appendChild(note);
    label.appendChild(checkbox);
    label.appendChild(textWrap);
    informationLayerControls.appendChild(label);

    checkbox.addEventListener("change", () => {
      syncInformationLayer(definition, checkbox.checked);
      const activeCount = Array.from(informationLayerControls.querySelectorAll('input[type="checkbox"]:checked')).length;
      informationLayerStatus.textContent = activeCount > 0
        ? `${activeCount} sector layer${activeCount === 1 ? "" : "s"} active.`
        : "No sector layers active.";
    });
  }

  informationLayerStatus.textContent = "No sector layers active.";
}

async function loadDeprivationLayer() {
  try {
    const [geojsonResponse, summaryResponse] = await Promise.all([
      fetch(DEPRIVATION_GEOJSON_URL),
      fetch(DEPRIVATION_SUMMARY_URL)
    ]);
    if (!geojsonResponse.ok) {
      throw new Error(`GeoJSON request failed: ${geojsonResponse.status}`);
    }
    const geojson = await geojsonResponse.json();
    const summary = summaryResponse.ok ? await summaryResponse.json() : null;

    deprivationLayer = L.geoJSON(geojson, {
      style: (feature) => ({
        color: "#2f3840",
        weight: 0.6,
        opacity: 0.7,
        fillColor: getDecileColor(feature?.properties?.imd_decile),
        fillOpacity: 0.48
      }),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(createPopupContent(feature), {
          maxWidth: 320
        });
      }
    });

    if (deprivationLayer.getLayers().length > 0) {
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

collapseButton.addEventListener("click", () => {
  const isCollapsed = mapStage.classList.toggle("is-collapsed");
  collapseButton.innerHTML = isCollapsed ? "&rsaquo;" : "&lsaquo;";
  collapseButton.setAttribute("aria-pressed", isCollapsed ? "true" : "false");
  setTimeout(() => map.invalidateSize(), 180);
});

deprivationToggle.addEventListener("change", applyLayerVisibility);

buildInformationLayerControls();
loadDeprivationLayer();
