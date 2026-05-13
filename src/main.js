const DEPRIVATION_TILES_MANIFEST_URL = `${import.meta.env.BASE_URL}data/england-lsoa-imd-2025_tiles/manifest.json`;
const DEPRIVATION_SUMMARY_URL = new URL("../deprivation/output/england-lsoa-imd-2025_summary.json", import.meta.url).href;
const WARDS_GEOJSON_URL = new URL("./data/england-wards.geojson", import.meta.url).href;
const COUNCILS_GEOJSON_URL = new URL("./data/england-councils.geojson", import.meta.url).href;
const WARD_ELECTION_STATE_URL = new URL("./data/england-ward-election-state.json", import.meta.url).href;
const WARD_DEPRIVATION_INDEX_URL = new URL("./data/ward-deprivation-vote-index.json", import.meta.url).href;
const WARD_DEPRIVATION_GROUPS_URL = new URL("./data/ward-deprivation-groups.json", import.meta.url).href;
const WARD_CENSUS_DEMOGRAPHICS_URL = new URL("./data/ward-census-demographics.json", import.meta.url).href;
const GP_PRACTICES_URL = new URL("./data/england-gp-practices.json", import.meta.url).href;
const GP_RATINGS_SUMMARY_URL = new URL("./data/ward-gp-ratings.json", import.meta.url).href;

const MAP_VIEW_STORAGE_KEY = "voterDeprivation.mapView.v1";
const SMALL_PARTY_MIN_WARDS = 3;
const DEFAULT_VIEW = {
  lat: 52.7,
  lng: -1.95,
  zoom: 6
};
const DEPRIVATION_MIN_ZOOM = 9;
const COUNCIL_RESULTS_MIN_ZOOM = 8;
const WARD_RESULTS_MIN_ZOOM = 11;
const GP_MIN_ZOOM = 11;
const GP_BOUNDS_ONLY_MIN_ZOOM = 13;

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
map.createPane("gpPane");
map.getPane("gpPane").style.zIndex = "445";
map.createPane("electionPane");
map.getPane("electionPane").style.zIndex = "460";
map.createPane("hoverPane");
map.getPane("hoverPane").style.zIndex = "470";
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  subdomains: "abcd",
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
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
const deprivationToggleState = document.getElementById("deprivation-toggle-state");
const effectsToggle = document.getElementById("effects-toggle");
const councilResultsToggle = document.getElementById("council-results-toggle");
const councilResultsToggleState = document.getElementById("council-results-toggle-state");
const wardResultsToggle = document.getElementById("ward-results-toggle");
const wardResultsToggleState = document.getElementById("ward-results-toggle-state");
const wardFillToggle = document.getElementById("ward-fill-toggle");
const gpRatingsToggle = document.getElementById("gp-ratings-toggle");
const gpRatingsToggleState = document.getElementById("gp-ratings-toggle-state");
const deprivationStatus = document.getElementById("deprivation-status");
const deprivationStats = document.getElementById("deprivation-stats");
const informationLayerStatus = document.getElementById("information-layer-status");
const wardHoverStatus = document.getElementById("ward-hover-status");
const gpRatingsStatus = document.getElementById("gp-ratings-status");
const loadStatusPanel = document.getElementById("load-status-panel");
const loadStatusSummary = document.getElementById("load-status-summary");
const loadStatusList = document.getElementById("load-status-list");
const hoverInfoPanel = document.getElementById("hover-info-panel");
const mapWarningPanel = document.getElementById("map-warning-panel");
const wardDeprivationSummary = document.getElementById("ward-deprivation-summary");
const wardDeprivationBars = document.getElementById("ward-deprivation-bars");
const groupedDeprivationSelect = document.getElementById("grouped-deprivation-select");
const groupedDeprivationSummary = document.getElementById("grouped-deprivation-summary");
const groupedDeprivationBars = document.getElementById("grouped-deprivation-bars");
const wardDeprivationTable = document.getElementById("ward-deprivation-table");
const wardDeprivationToggle = document.getElementById("ward-deprivation-toggle");
const wardDeprivationTableToggle = document.getElementById("ward-deprivation-table-toggle");
const censusSignalsSummary = document.getElementById("census-signals-summary");
const censusSignalsTable = document.getElementById("census-signals-table");
const censusPartyTable = document.getElementById("census-party-table");
const censusPartySelect = document.getElementById("census-party-select");
const turnoutChangeSummary = document.getElementById("turnout-change-summary");
const turnoutChangeChart = document.getElementById("turnout-change-chart");
const turnoutChangeToggle = document.getElementById("turnout-change-toggle");
const turnoutChangeTable = document.getElementById("turnout-change-table");
const gpPartySummary = document.getElementById("gp-party-summary");
const gpPartyChart = document.getElementById("gp-party-chart");
const gpPartyTable = document.getElementById("gp-party-table");

let deprivationLayer = null;
let deprivationTileManifest = null;
let deprivationTileMetaByKey = new Map();
let deprivationTileLayerCache = new Map();
let activeDeprivationTileKeys = new Set();
let effectsLayer = null;
let wardFeatures = [];
let councilFeatures = [];
let activeHoveredWardCode = null;
let activeHoveredWardLayer = null;
let declaredWardResultsLayer = null;
let declaredCouncilResultsLayer = null;
let wardElectionStateByCode = new Map();
let councilControlByAuthorityCode = new Map();
let declaredWinnerCount = 0;
let declaredCouncilCount = 0;
let declaredWardCount = 0;
const RESULTS_RENDER_MODE = "council";
let deprivationFeatures = [];
let hoverInfoTimer = null;
let wardDeprivationGroupsPayload = null;
let wardDeprivationIndexPayload = null;
let wardCensusDemographicsPayload = null;
let gpPractices = [];
let gpPracticeLayer = null;
let gpRatingsSummaryPayload = null;
let gpSummaryByWardCode = new Map();
let showSmallParties = false;
let selectedCensusParty = "Reform UK";
const layerPrefs = {
  deprivation: Boolean(deprivationToggle?.checked),
  council: Boolean(councilResultsToggle?.checked),
  ward: Boolean(wardResultsToggle?.checked),
  gp: Boolean(gpRatingsToggle?.checked)
};

const LOAD_STATUS_DEFINITIONS = [
  { key: "wards", label: "Ward boundaries" },
  { key: "councils", label: "Council boundaries" },
  { key: "election", label: "Election results" },
  { key: "deprivation", label: "Deprivation tiles" },
  { key: "deprivationIndex", label: "Deprivation summary" },
  { key: "deprivationGroups", label: "Regional groupings" },
  { key: "census", label: "Census summaries" },
  { key: "gpPractices", label: "GP locations" },
  { key: "gpSummary", label: "GP ratings summary" }
];

const loadStatuses = new Map(
  LOAD_STATUS_DEFINITIONS.map((item) => [item.key, { state: "pending", detail: "" }])
);

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

function renderLoadStatus() {
  if (!loadStatusSummary || !loadStatusList) return;
  const items = LOAD_STATUS_DEFINITIONS.map((item) => ({
    ...item,
    ...(loadStatuses.get(item.key) || { state: "pending", detail: "" })
  }));
  const counts = items.reduce((acc, item) => {
    acc[item.state] = (acc[item.state] || 0) + 1;
    return acc;
  }, {});
  const readyCount = counts.ready || 0;
  const loadingCount = counts.loading || 0;
  const errorCount = counts.error || 0;
  const totalCount = items.length;

  if (errorCount > 0) {
    loadStatusSummary.textContent = `${readyCount}/${totalCount} datasets ready. ${errorCount} failed to load.`;
  } else if (loadingCount > 0) {
    loadStatusSummary.textContent = `${readyCount}/${totalCount} datasets ready. Loading ${loadingCount} more...`;
  } else if (readyCount === totalCount) {
    loadStatusSummary.textContent = "Loading complete.";
  } else {
    loadStatusSummary.textContent = "Preparing data sources...";
  }

  loadStatusList.innerHTML = items.map((item) => {
    const detail = item.detail ? `<span class="load-status-detail">${item.detail}</span>` : "";
    return [
      '<div class="load-status-row">',
      `<span class="load-status-dot" data-state="${item.state}" aria-hidden="true"></span>`,
      `<span class="load-status-label">${item.label}</span>`,
      detail,
      "</div>"
    ].join("");
  }).join("");

  if (loadStatusPanel) {
    loadStatusPanel.dataset.state = errorCount > 0 ? "error" : loadingCount > 0 ? "loading" : readyCount === totalCount ? "ready" : "pending";
    loadStatusPanel.hidden = errorCount === 0 && loadingCount === 0 && readyCount === totalCount;
  }
}

function setLoadStatus(key, state, detail = "") {
  if (!loadStatuses.has(key)) return;
  loadStatuses.set(key, { state, detail });
  renderLoadStatus();
}

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

function getGpRatingColor(scoreValue) {
  const score = Number(scoreValue);
  if (!Number.isFinite(score)) return "#9aa0a6";
  if (score < 2) return "#c3472f";
  if (score < 3) return "#dc8c23";
  if (score < 4) return "#d2b529";
  if (score < 4.5) return "#4c9a52";
  return "#1c7c54";
}

function createPopupContent(feature) {
  const props = feature?.properties || {};
  const name = props.lsoa21nm || props.lsoa21cd || "Unknown LSOA";
  const decile = props.imd_decile ?? "n/a";
  const score = Number.isFinite(props.imd_score) ? props.imd_score.toFixed(2) : "n/a";
  const rank = props.imd_rank ?? "n/a";
  const population = props.population_2022 ?? "n/a";
  const formatPct = (value) => (Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "n/a");
  return [
    `<strong>${name}</strong>`,
    `IMD 2025 decile: ${decile}`,
    `IMD score: ${score}`,
    `IMD rank: ${rank}`,
    `Population (2022): ${population}`,
    `White British: ${formatPct(props.white_british_pct)}`,
    `UK-born: ${formatPct(props.uk_born_pct)}`,
    `English/British identity: ${formatPct(props.english_or_british_only_identity_pct)}`,
    `Age 50+: ${formatPct(props.age_50plus_pct)}`,
    `Owner occupied: ${formatPct(props.owner_occupied_pct)}`,
    `Degree level: ${formatPct(props.degree_pct)}`
  ].join("<br>");
}

function isDeprivationVisibleAtZoom(zoom = map.getZoom()) {
  return zoom >= DEPRIVATION_MIN_ZOOM;
}

function isCouncilResultsVisibleAtZoom(zoom = map.getZoom()) {
  return zoom >= COUNCIL_RESULTS_MIN_ZOOM;
}

function isWardResultsVisibleAtZoom(zoom = map.getZoom()) {
  return zoom >= WARD_RESULTS_MIN_ZOOM;
}

function isGpVisibleAtZoom(zoom = map.getZoom()) {
  return zoom >= GP_MIN_ZOOM;
}

function mercatorX(lon) {
  return (lon + 180) / 360;
}

function mercatorY(lat) {
  const boundedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878);
  const radiansLat = (boundedLat * Math.PI) / 180;
  return (1 - Math.log(Math.tan((Math.PI / 4) + (radiansLat / 2))) / Math.PI) / 2;
}

function lonLatToTile(lon, lat, zoom) {
  const scale = 2 ** zoom;
  const x = Math.min(Math.max(Math.floor(mercatorX(lon) * scale), 0), scale - 1);
  const y = Math.min(Math.max(Math.floor(mercatorY(lat) * scale), 0), scale - 1);
  return { x, y };
}

function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

function getVisibleDeprivationTileKeys() {
  const tileZoom = Number(deprivationTileManifest?.tile_zoom);
  if (!Number.isFinite(tileZoom)) return [];
  const bounds = map.getBounds();
  const northWest = lonLatToTile(bounds.getWest(), bounds.getNorth(), tileZoom);
  const southEast = lonLatToTile(bounds.getEast(), bounds.getSouth(), tileZoom);
  const keys = [];
  for (let x = northWest.x; x <= southEast.x; x += 1) {
    for (let y = northWest.y; y <= southEast.y; y += 1) {
      const key = tileKey(tileZoom, x, y);
      if (deprivationTileMetaByKey.has(key)) keys.push(key);
    }
  }
  return keys;
}

function rebuildDeprivationFeatureCache() {
  deprivationFeatures = [];
  for (const key of activeDeprivationTileKeys) {
    const cached = deprivationTileLayerCache.get(key);
    if (!cached?.features) continue;
    deprivationFeatures.push(...cached.features);
  }
}

function removeInactiveDeprivationTiles(nextKeys) {
  const nextKeySet = new Set(nextKeys);
  for (const key of [...activeDeprivationTileKeys]) {
    if (nextKeySet.has(key)) continue;
    const cached = deprivationTileLayerCache.get(key);
    if (cached?.layer && deprivationLayer && deprivationLayer.hasLayer(cached.layer)) {
      deprivationLayer.removeLayer(cached.layer);
    }
    activeDeprivationTileKeys.delete(key);
  }
  rebuildDeprivationFeatureCache();
}

async function ensureVisibleDeprivationTiles() {
  if (!deprivationLayer || !deprivationTileManifest || !isDeprivationVisibleAtZoom() || !deprivationToggle.checked) {
    return;
  }
  const nextKeys = getVisibleDeprivationTileKeys();
  removeInactiveDeprivationTiles(nextKeys);
  for (const key of nextKeys) {
    const cached = deprivationTileLayerCache.get(key);
    if (cached?.layer) {
      if (!deprivationLayer.hasLayer(cached.layer)) deprivationLayer.addLayer(cached.layer);
      activeDeprivationTileKeys.add(key);
      continue;
    }
    if (cached?.loadingPromise) {
      await cached.loadingPromise;
      continue;
    }
    const tileMeta = deprivationTileMetaByKey.get(key);
    if (!tileMeta?.file) continue;
    const tileUrl = `${import.meta.env.BASE_URL}data/england-lsoa-imd-2025_tiles/${tileMeta.file}`;
    const loadingPromise = fetch(tileUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Deprivation tile request failed: ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const features = Array.isArray(payload?.features) ? payload.features : [];
        const layer = L.geoJSON(payload, {
          pane: "deprivationPane",
          style: (feature) => ({
            stroke: false,
            fillColor: getDecileColor(feature?.properties?.imd_decile),
            fillOpacity: 0.48
          }),
          onEachFeature: (feature, itemLayer) => itemLayer.bindPopup(createPopupContent(feature), { maxWidth: 320 })
        });
        deprivationTileLayerCache.set(key, { layer, features });
        if (deprivationLayer && deprivationToggle.checked && isDeprivationVisibleAtZoom()) {
          deprivationLayer.addLayer(layer);
          activeDeprivationTileKeys.add(key);
          rebuildDeprivationFeatureCache();
        }
      })
      .catch((error) => {
        console.error(error);
        deprivationTileLayerCache.delete(key);
      });
    deprivationTileLayerCache.set(key, { loadingPromise });
    await loadingPromise;
  }
  rebuildDeprivationFeatureCache();
}

function updateMapWarnings() {
  const zoom = map.getZoom();
  const states = getLayerControlState(zoom);
  const warnings = [];
  if (layerPrefs.deprivation && !states.deprivation.actualChecked) {
    warnings.push(`Deprivation and LSOA shading are hidden below zoom ${DEPRIVATION_MIN_ZOOM}.`);
  }
  if (layerPrefs.council && !states.council.actualChecked && !shouldAutoShowCouncilsAtZoom(zoom)) {
    warnings.push(`Council control outlines are hidden below zoom ${COUNCIL_RESULTS_MIN_ZOOM}.`);
  }
  if (layerPrefs.ward && !states.ward.actualChecked) {
    warnings.push(`Ward result outlines stay hidden until zoom ${WARD_RESULTS_MIN_ZOOM}; only the hovered ward outline is shown.`);
  }
  if (layerPrefs.gp && !states.gp.actualChecked) {
    warnings.push(`GP ratings markers are hidden below zoom ${GP_MIN_ZOOM}.`);
  }
  if (!mapWarningPanel) return;
  if (warnings.length) {
    mapWarningPanel.textContent = warnings.join(" ");
    mapWarningPanel.hidden = false;
  } else {
    mapWarningPanel.hidden = true;
    mapWarningPanel.textContent = "";
  }
}

async function applyLayerVisibility() {
  if (!deprivationLayer) {
    updateMapWarnings();
    updateSidebarToggleStates();
    return;
  }
  const zoom = map.getZoom();
  const states = getLayerControlState(zoom);
  const isVisible = states.deprivation.actualChecked;
  if (isVisible && isDeprivationVisibleAtZoom(zoom)) {
    if (!map.hasLayer(deprivationLayer)) deprivationLayer.addTo(map);
    await ensureVisibleDeprivationTiles();
    deprivationStatus.textContent = "Deprivation layer visible.";
  } else {
    if (map.hasLayer(deprivationLayer)) map.removeLayer(deprivationLayer);
    activeDeprivationTileKeys.clear();
    deprivationFeatures = [];
    if (!isVisible) {
      deprivationStatus.textContent = "Deprivation layer hidden.";
    } else {
      deprivationStatus.textContent = `Zoom in to at least ${DEPRIVATION_MIN_ZOOM} to display deprivation.`;
    }
  }
  updateMapWarnings();
  updateSidebarToggleStates();
}

function getVisibleGpPractices() {
  const zoom = map.getZoom();
  if (!isGpVisibleAtZoom(zoom)) return [];
  if (zoom >= GP_BOUNDS_ONLY_MIN_ZOOM) {
    const bounds = map.getBounds().pad(0.08);
    return gpPractices.filter((row) => bounds.contains([row.lat, row.lon]));
  }
  const center = map.getCenter();
  const cap = zoom >= GP_MIN_ZOOM + 1 ? 250 : 120;
  return [...gpPractices]
    .map((row) => ({
      row,
      distance: ((row.lat - center.lat) ** 2) + ((row.lon - center.lng) ** 2)
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, cap)
    .map((entry) => entry.row);
}

function gpPopupMarkup(row) {
  const googleScore = Number.isFinite(Number(row.google_score)) ? Number(row.google_score).toFixed(1) : "n/a";
  const googleCount = Number.isFinite(Number(row.google_count)) ? Number(row.google_count).toLocaleString() : "n/a";
  const survey = Number.isFinite(Number(row.survey_overall_good_percent)) ? `${Number(row.survey_overall_good_percent).toFixed(1)}%` : "n/a";
  const patients = Number.isFinite(Number(row.registered_patient_count)) ? Number(row.registered_patient_count).toLocaleString() : "n/a";
  return [
    `<strong>${row.practice_name || row.practice_code || "GP practice"}</strong>`,
    `Google rating: ${googleScore} (${googleCount} reviews)`,
    `GP survey overall good: ${survey}`,
    `Patients: ${patients}`,
    row.ward_name ? `Ward: ${row.ward_name}` : null,
    row.authority_name ? `Council: ${row.authority_name}` : null
  ].filter(Boolean).join("<br>");
}

function renderGpPracticeLayer() {
  if (!gpPracticeLayer) gpPracticeLayer = L.layerGroup();
  gpPracticeLayer.clearLayers();
  const visibleRows = getVisibleGpPractices();
  const zoom = map.getZoom();
  for (const row of visibleRows) {
    const marker = L.circleMarker([row.lat, row.lon], {
      pane: "gpPane",
      radius: zoom >= 14 ? 6 : zoom >= 13 ? 5 : 4,
      weight: 1,
      color: "#ffffff",
      opacity: 0.95,
      fillColor: getGpRatingColor(row.google_score),
      fillOpacity: 0.9
    });
    marker.bindPopup(gpPopupMarkup(row), { maxWidth: 320 });
    marker.bindTooltip(
      `${row.practice_name || row.practice_code || "GP"}${Number.isFinite(Number(row.google_score)) ? ` · ${Number(row.google_score).toFixed(1)}` : ""}`,
      { direction: "top", offset: [0, -4] }
    );
    gpPracticeLayer.addLayer(marker);
  }
  return visibleRows.length;
}

function applyGpLayerVisibility() {
  if (!gpPracticeLayer) gpPracticeLayer = L.layerGroup();
  const zoom = map.getZoom();
  const states = getLayerControlState(zoom);
  const enabled = Boolean(states.gp.actualChecked);
  if (!enabled) {
    if (map.hasLayer(gpPracticeLayer)) map.removeLayer(gpPracticeLayer);
    if (gpRatingsStatus) gpRatingsStatus.textContent = layerPrefs.gp && !states.gp.actualChecked
      ? `Zoom in to at least ${GP_MIN_ZOOM} to display GP ratings.`
      : "GP ratings layer hidden.";
    updateMapWarnings();
    updateSidebarToggleStates();
    return;
  }
  if (!isGpVisibleAtZoom(zoom)) {
    if (map.hasLayer(gpPracticeLayer)) map.removeLayer(gpPracticeLayer);
    if (gpRatingsStatus) gpRatingsStatus.textContent = `Zoom in to at least ${GP_MIN_ZOOM} to display GP ratings.`;
    updateMapWarnings();
    updateSidebarToggleStates();
    return;
  }
  const count = renderGpPracticeLayer();
  if (!map.hasLayer(gpPracticeLayer)) gpPracticeLayer.addTo(map);
  if (gpRatingsStatus) {
    gpRatingsStatus.textContent = zoom >= GP_BOUNDS_ONLY_MIN_ZOOM
      ? `Showing ${count.toLocaleString()} GP practices in view.`
      : `Showing nearest ${count.toLocaleString()} GP practices at this zoom.`;
  }
  updateMapWarnings();
  updateSidebarToggleStates();
}

function formatEstimate(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}GBP ${Math.abs(value).toLocaleString()}m`;
}

function formatSignedNumber(value, digits = 1, suffix = "") {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(digits)}${suffix}`;
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function isPercentFeatureId(featureId) {
  return featureId !== "imd_score";
}

function formatFeatureMean(featureId, value) {
  if (!hasNumericValue(value)) return "n/a";
  return isPercentFeatureId(featureId)
    ? `${(Number(value) * 100).toFixed(1)}%`
    : Number(value).toFixed(2);
}

function formatFeatureDelta(featureId, value) {
  if (!hasNumericValue(value)) return "n/a";
  return isPercentFeatureId(featureId)
    ? formatSignedNumber(Number(value) * 100, 1, "pp")
    : formatSignedNumber(Number(value), 2);
}

function getDeltaClass(value, epsilon = 0.005) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "delta-neutral";
  if (numeric > epsilon) return "delta-positive";
  if (numeric < -epsilon) return "delta-negative";
  return "delta-neutral";
}

function getRowsAfterSmallPartyFilter(rows, countKey = "wards_won") {
  const typedRows = Array.isArray(rows) ? rows : [];
  const hiddenRows = typedRows.filter((row) => Number(row?.[countKey] || 0) < SMALL_PARTY_MIN_WARDS);
  const visibleRows = showSmallParties
    ? typedRows
    : typedRows.filter((row) => Number(row?.[countKey] || 0) >= SMALL_PARTY_MIN_WARDS);
  return { visibleRows, hiddenRows };
}

function toggleSharedSmallParties() {
  showSmallParties = !showSmallParties;
  rerenderPartyPanels();
}

function setSharedSmallPartyToggle(target, hiddenCount) {
  if (!target) return;
  if (!(hiddenCount > 0)) {
    target.innerHTML = "";
    return;
  }
  const label = showSmallParties
    ? `Hide ${hiddenCount.toLocaleString()} smaller parties`
    : `Show ${hiddenCount.toLocaleString()} smaller parties`;
  target.innerHTML = `<button type="button" class="inline-toggle-button">${label}</button>`;
  target.querySelector("button")?.addEventListener("click", toggleSharedSmallParties);
}

function buildHiddenPartySummaryRow(hiddenCount, colspan) {
  if (!(hiddenCount > 0)) return "";
  const label = showSmallParties
    ? `Hide ${hiddenCount.toLocaleString()} smaller parties`
    : `Show ${hiddenCount.toLocaleString()} smaller parties`;
  return `<tr class="table-summary-row"><td colspan="${colspan}"><button type="button" class="table-toggle-link">${label}</button></td></tr>`;
}

function getMajorCensusParties(parties) {
  const rows = Array.isArray(parties) ? [...parties].sort((a, b) => Number(b?.wards_won || 0) - Number(a?.wards_won || 0)) : [];
  const direct = rows.filter((row) => Number(row?.wards_won || 0) >= 25);
  if (direct.length >= 5) return direct;
  return rows.slice(0, 6);
}

function computeAllDeclaredMeansFromParties(parties, featureIds) {
  const totals = {};
  let totalWards = 0;
  for (const party of parties) {
    const wardsWon = Number(party?.wards_won || 0);
    if (!(wardsWon > 0)) continue;
    totalWards += wardsWon;
    for (const featureId of featureIds) {
      const value = Number(party?.means?.[featureId]);
      if (!Number.isFinite(value)) continue;
      totals[featureId] = (totals[featureId] || 0) + (value * wardsWon);
    }
  }
  return Object.fromEntries(
    featureIds.map((featureId) => [
      featureId,
      totalWards > 0 && Number.isFinite(totals[featureId]) ? totals[featureId] / totalWards : null
    ])
  );
}

function shouldAutoShowCouncilsAtZoom(zoom = map.getZoom()) {
  return zoom >= COUNCIL_RESULTS_MIN_ZOOM && zoom <= 10;
}

function getLayerControlState(zoom = map.getZoom()) {
  const deprivationAvailable = isDeprivationVisibleAtZoom(zoom);
  const councilAutoOn = shouldAutoShowCouncilsAtZoom(zoom);
  const councilAvailable = isCouncilResultsVisibleAtZoom(zoom);
  const wardAvailable = isWardResultsVisibleAtZoom(zoom);
  const gpAvailable = isGpVisibleAtZoom(zoom);

  return {
    deprivation: {
      actualChecked: deprivationAvailable && layerPrefs.deprivation,
      disabled: !deprivationAvailable,
      state: !deprivationAvailable ? "blocked" : (layerPrefs.deprivation ? "visible" : "off"),
      text: !deprivationAvailable ? `Off below z${DEPRIVATION_MIN_ZOOM}` : (layerPrefs.deprivation ? "On" : "Off")
    },
    council: {
      actualChecked: councilAutoOn ? true : (councilAvailable && layerPrefs.council),
      disabled: councilAutoOn || !councilAvailable,
      state: councilAutoOn ? "auto" : (!councilAvailable ? "blocked" : (layerPrefs.council ? "visible" : "off")),
      text: councilAutoOn ? "Forced on" : (!councilAvailable ? `Off below z${COUNCIL_RESULTS_MIN_ZOOM}` : (layerPrefs.council ? "On" : "Off"))
    },
    ward: {
      actualChecked: wardAvailable && layerPrefs.ward,
      disabled: !wardAvailable,
      state: !wardAvailable ? "blocked" : (layerPrefs.ward ? "visible" : "off"),
      text: !wardAvailable ? `Off below z${WARD_RESULTS_MIN_ZOOM}` : (layerPrefs.ward ? "On" : "Off")
    },
    gp: {
      actualChecked: gpAvailable && layerPrefs.gp,
      disabled: !gpAvailable,
      state: !gpAvailable ? "blocked" : (layerPrefs.gp ? "visible" : "off"),
      text: !gpAvailable ? `Off below z${GP_MIN_ZOOM}` : (layerPrefs.gp ? "On" : "Off")
    }
  };
}

function applyToggleControlState(toggle, badge, controlState) {
  if (!toggle) return;
  toggle.checked = Boolean(controlState.actualChecked);
  toggle.disabled = Boolean(controlState.disabled);
  const row = toggle.closest("label");
  if (row) {
    row.dataset.state = controlState.state;
    row.dataset.disabled = controlState.disabled ? "true" : "false";
  }
  if (badge) badge.textContent = controlState.text;
}

function updateSidebarToggleStates() {
  const states = getLayerControlState();
  applyToggleControlState(deprivationToggle, deprivationToggleState, states.deprivation);
  applyToggleControlState(councilResultsToggle, councilResultsToggleState, states.council);
  applyToggleControlState(wardResultsToggle, wardResultsToggleState, states.ward);
  applyToggleControlState(gpRatingsToggle, gpRatingsToggleState, states.gp);
}

function rerenderPartyPanels() {
  if (wardDeprivationIndexPayload) renderWardDeprivationTable(wardDeprivationIndexPayload);
  renderTurnoutChangeByWinningParty();
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

function getCouncilControlForAuthority(authorityCode) {
  return councilControlByAuthorityCode.get(String(authorityCode || "")) || null;
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
  const councilState = getCouncilControlForAuthority(props.LAD24CD);
  const incumbentParty = electionState?.incumbent_party || "Unknown";
  const wardWinnerParty = electionState?.winner_party || null;
  const gpSummary = gpSummaryByWardCode.get(wardCode);
  const councilControl = councilState?.council_result_declared
    ? (councilState?.council_winner_party || councilState?.council_control_party || "declared")
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
    hasNumericValue(electionState?.turnout_change_pct_points)
      ? `Turnout change vs previous local: ${formatSignedNumber(electionState.turnout_change_pct_points, 1, "pp")}`
      : null,
    hasNumericValue(electionState?.vote_count_change)
      ? `Candidate vote total change: ${formatSignedNumber(electionState.vote_count_change, 0)}`
      : null,
    `Displayed winner (${RESULTS_RENDER_MODE}): ${displayedWinner}`,
    `Council control: ${councilControl}`,
    gpSummary?.practices_count ? `GP avg: ${Number.isFinite(Number(gpSummary.avg_google_score)) ? Number(gpSummary.avg_google_score).toFixed(1) : "n/a"} across ${Number(gpSummary.practices_count).toLocaleString()} practices` : null
  ].filter(Boolean).join("<br>");
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
    const gpSummary = gpSummaryByWardCode.get(wardCode);
    const councilState = getCouncilControlForAuthority(props.LAD24CD);
    const councilControl = councilState?.council_result_declared
      ? (councilState?.council_winner_party || councilState?.council_control_party || "declared")
      : "pending";
    lines.push(`${props.WD24NM || wardCode || "Unknown"}`);
    if (councilResultsToggle.checked) lines.push(`${councilControl}`);
    if (wardResultsToggle.checked) lines.push(`${electionState?.winner_party || "pending"}`);
    if (hasNumericValue(electionState?.turnout_change_pct_points)) {
      lines.push(`Turnout ${formatSignedNumber(electionState.turnout_change_pct_points, 1, "pp")}`);
    }
    if (gpSummary?.practices_count) {
      const rating = Number.isFinite(Number(gpSummary.avg_google_score)) ? Number(gpSummary.avg_google_score).toFixed(1) : "n/a";
      lines.push(`GP ${rating} (${Number(gpSummary.practices_count).toLocaleString()})`);
    }
  }
  if (deprivationToggle.checked && isDeprivationVisibleAtZoom()) {
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
  const states = getLayerControlState(zoom);
  const fillWards = Boolean(wardFillToggle?.checked && states.ward.actualChecked);
  const fillCouncils = Boolean(wardFillToggle?.checked && states.council.actualChecked && !fillWards);
  if (declaredCouncilResultsLayer) {
    declaredCouncilResultsLayer.eachLayer((layer) => {
      if (!layer?.setStyle) return;
      const winnerColor = layer?.options?.winnerColor || layer?.options?.color || "#6b7280";
      layer.setStyle({
        weight: councilWeight,
        opacity: 1,
        color: winnerColor,
        fill: fillCouncils,
        fillColor: winnerColor,
        fillOpacity: fillCouncils ? 0.65 : 0
      });
    });
  }
  if (declaredWardResultsLayer) {
    declaredWardResultsLayer.eachLayer((layer) => {
      if (!layer?.setStyle) return;
      const winnerColor = layer?.options?.winnerColor || layer?.options?.color || "#6b7280";
      if (fillWards) {
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

  for (const candidate of councilFeatures) {
    const feature = candidate.feature;
    const authorityCode = feature?.properties?.LAD24CD;
    const councilState = getCouncilControlForAuthority(authorityCode);
    const winner = councilState?.council_result_declared
      ? (councilState?.council_winner_party || councilState?.council_control_party || null)
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
        `Council control: ${winner}`,
        `Seats: ${councilState?.council_seat_total || "n/a"}`,
        `Threshold: ${councilState?.council_control_majority_threshold || "n/a"}`
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
  const zoom = map.getZoom();
  if (layerPrefs.ward && !isWardResultsVisibleAtZoom(zoom)) {
    wardHoverStatus.textContent = shouldAutoShowCouncilsAtZoom(zoom)
      ? `Ward winners hidden below z${WARD_RESULTS_MIN_ZOOM} · councils visible for navigation`
      : `Ward winners hidden below z${WARD_RESULTS_MIN_ZOOM}`;
    return;
  }
  // wardHoverStatus.textContent = `C:${declaredCouncilCount} W:${declaredWardCount}`;
}

function applyWardLayerVisibility() {
  const zoom = map.getZoom();
  const states = getLayerControlState(zoom);
  if (declaredCouncilResultsLayer) {
    const shouldShowCouncils = declaredCouncilCount > 0 && states.council.actualChecked;
    if (shouldShowCouncils) {
      if (!map.hasLayer(declaredCouncilResultsLayer)) declaredCouncilResultsLayer.addTo(map);
    } else if (map.hasLayer(declaredCouncilResultsLayer)) {
      map.removeLayer(declaredCouncilResultsLayer);
    }
  }
  if (declaredWardResultsLayer) {
    if (states.ward.actualChecked && declaredWardCount > 0) {
      if (!map.hasLayer(declaredWardResultsLayer)) declaredWardResultsLayer.addTo(map);
    } else if (map.hasLayer(declaredWardResultsLayer)) {
      map.removeLayer(declaredWardResultsLayer);
    }
  }
  updateMapWarnings();
  updateSidebarToggleStates();
}

async function loadWardHoverSource() {
  setLoadStatus("wards", "loading", "Fetching GeoJSON...");
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
    setLoadStatus("wards", "ready", `${wardFeatures.length.toLocaleString()} wards`);
  } catch (error) {
    console.error(error);
    wardHoverStatus.textContent = "Could not load ward boundaries. Run `yarn updates:maintenance`.";
    setLoadStatus("wards", "error", "Request failed");
  }
}

async function loadCouncilSource() {
  setLoadStatus("councils", "loading", "Fetching GeoJSON...");
  try {
    const response = await fetch(COUNCILS_GEOJSON_URL);
    if (!response.ok) {
      throw new Error(`Council source request failed: ${response.status}`);
    }
    const geojson = await response.json();
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    councilFeatures = features.map((feature) => ({ feature }));
    councilControlByAuthorityCode = new Map(
      features
        .filter((feature) => feature?.properties?.LAD24CD)
        .map((feature) => [feature.properties.LAD24CD, feature.properties])
    );
    rebuildDeclaredWardsLayer();
    applyWardLayerVisibility();
    updateWardStatusDefault();
    setLoadStatus("councils", "ready", `${councilFeatures.length.toLocaleString()} councils`);
  } catch (error) {
    console.error(error);
    councilControlByAuthorityCode = new Map();
    setLoadStatus("councils", "error", "Request failed");
  }
}

async function loadWardElectionState() {
  setLoadStatus("election", "loading", "Fetching winners...");
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
    renderTurnoutChangeByWinningParty();
    rebuildDeclaredWardsLayer();
    applyWardLayerVisibility();
    updateWardStatusDefault();
    setLoadStatus("election", "ready", `${wardElectionStateByCode.size.toLocaleString()} ward rows`);
  } catch (error) {
    console.error(error);
    wardElectionStateByCode = new Map();
    if (turnoutChangeSummary) turnoutChangeSummary.textContent = "Turnout deltas unavailable. Run `yarn updates:maintenance`.";
    if (turnoutChangeChart) turnoutChangeChart.innerHTML = "";
    if (turnoutChangeTable) turnoutChangeTable.innerHTML = "";
    setLoadStatus("election", "error", "Request failed");
  }
}

function renderTurnoutChangeByWinningParty() {
  if (!turnoutChangeSummary || !turnoutChangeChart || !turnoutChangeTable) return;
  const wards = [...wardElectionStateByCode.values()];
  const comparable = wards.filter((row) => row?.winner_party && hasNumericValue(row?.turnout_change_pct_points));

  if (!comparable.length) {
    turnoutChangeSummary.textContent = "No ward-level turnout deltas available yet.";
    turnoutChangeChart.innerHTML = "";
    turnoutChangeTable.innerHTML = "";
    return;
  }

  const overallMean = comparable.reduce((sum, row) => sum + Number(row.turnout_change_pct_points), 0) / comparable.length;
  const grouped = new Map();
  for (const ward of comparable) {
    const party = ward.winner_party;
    const existing = grouped.get(party) || { party, wards_won: 0, turnout_changes: [] };
    existing.wards_won += 1;
    existing.turnout_changes.push(Number(ward.turnout_change_pct_points));
    grouped.set(party, existing);
  }

  const rows = [...grouped.values()]
    .map((row) => {
      const meanTurnoutChange = row.turnout_changes.reduce((sum, value) => sum + value, 0) / row.turnout_changes.length;
      return {
        party: row.party,
        wards_won: row.wards_won,
        mean_turnout_change: meanTurnoutChange,
        delta_vs_all: meanTurnoutChange - overallMean
      };
    })
    .sort((a, b) => b.mean_turnout_change - a.mean_turnout_change);
  const { visibleRows, hiddenRows } = getRowsAfterSmallPartyFilter(rows);

  turnoutChangeSummary.textContent =
    `Matched turnout wards: ${comparable.length.toLocaleString()} across declared winning wards with a prior local comparator.`;

  turnoutChangeChart.innerHTML = `<div class="rating-bars">${visibleRows.slice(0, 10).map((row) => {
    const width = `${Math.min(100, Math.abs(row.mean_turnout_change) * 5).toFixed(1)}%`;
    const color = row.mean_turnout_change >= 0 ? "#1f7a3f" : "#b23322";
    return `<div class="rating-row"><div class="rating-label">${row.party}</div><div class="rating-track"><div class="rating-fill" style="width:${width};background:${color}"></div></div><div class="rating-value">${formatSignedNumber(row.mean_turnout_change, 1, "pp")}</div></div>`;
  }).join("")}</div>`;
  setSharedSmallPartyToggle(turnoutChangeToggle, hiddenRows.length);

  turnoutChangeTable.innerHTML = [
    '<table class="simple-table">',
    "<thead><tr><th>Winning Party</th><th>Matched Turnout Wards</th><th>Avg Turnout Change</th><th>Vs Matched-Ward Mean</th></tr></thead>",
    "<tbody>",
    ...visibleRows.map((row) => (
      `<tr><td>${row.party}</td><td>${row.wards_won.toLocaleString()}</td><td>${formatSignedNumber(row.mean_turnout_change, 1, "pp")}</td><td class="${getDeltaClass(row.delta_vs_all, 0.1)}">${formatSignedNumber(row.delta_vs_all, 1, "pp")}</td></tr>`
    )),
    buildHiddenPartySummaryRow(hiddenRows.length, 4),
    "</tbody></table>"
  ].join("");
  turnoutChangeTable.querySelector(".table-toggle-link")?.addEventListener("click", toggleSharedSmallParties);
}

async function loadDeprivationLayer() {
  setLoadStatus("deprivation", "loading", "Loading tile manifest...");
  try {
    const [manifestResponse, summaryResponse] = await Promise.all([
      fetch(DEPRIVATION_TILES_MANIFEST_URL),
      fetch(DEPRIVATION_SUMMARY_URL)
    ]);
    if (!manifestResponse.ok) throw new Error(`Deprivation manifest request failed: ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const summary = summaryResponse.ok ? await summaryResponse.json() : null;
    deprivationTileManifest = manifest;
    deprivationTileMetaByKey = new Map(
      (Array.isArray(manifest?.tiles) ? manifest.tiles : []).map((tile) => [tileKey(tile.z, tile.x, tile.y), tile])
    );
    deprivationTileLayerCache = new Map();
    activeDeprivationTileKeys = new Set();
    deprivationFeatures = [];
    deprivationLayer = L.layerGroup();
    await applyLayerVisibility();
    const featureCount = Number(manifest?.feature_count || 0);
    const tileCount = Number(manifest?.tile_count || 0);
    const scope = summary?.filter?.territory || "England";
    deprivationStats.textContent = `Prepared ${featureCount.toLocaleString()} deprivation polygons for ${scope} across ${tileCount.toLocaleString()} tiles.`;
    setLoadStatus("deprivation", "ready", `${tileCount.toLocaleString()} tiles`);
  } catch (error) {
    console.error(error);
    deprivationStatus.textContent = "Could not load deprivation layer.";
    deprivationStats.textContent = "Check file paths and run via a local static server.";
    setLoadStatus("deprivation", "error", "Manifest or summary failed");
  }
}

function renderWardDeprivationTable(payload) {
  if (!wardDeprivationSummary || !wardDeprivationTable || !wardDeprivationBars) return;
  const parties = Array.isArray(payload?.parties) ? payload.parties : [];
  const wards = Array.isArray(payload?.wards) ? payload.wards : [];
  const sortedParties = [...parties]
    .sort((a, b) =>
      Number(a.deprivation_weighted_mean_decile || 0) -
      Number(b.deprivation_weighted_mean_decile || 0)
    );
  const { visibleRows: topParties, hiddenRows } = getRowsAfterSmallPartyFilter(sortedParties);
  const barParties = showSmallParties ? sortedParties : topParties;
  const summary = payload?.summary || {};
  wardDeprivationSummary.textContent =
    `Declared winning wards: ${(summary.wards_with_declared_winner || 0).toLocaleString()} / ${(summary.wards_total || 0).toLocaleString()}.`;
  setSharedSmallPartyToggle(wardDeprivationToggle, hiddenRows.length);
  setSharedSmallPartyToggle(wardDeprivationTableToggle, hiddenRows.length);
  if (!sortedParties.length) {
    wardDeprivationBars.innerHTML = "";
    wardDeprivationTable.innerHTML = "";
    return;
  }
  const topPartyNames = new Set(barParties.map((row) => row.party));
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
      const bucketParty = topPartyNames.has(party) ? party : (showSmallParties ? party : "Other");
      decilePartyTotals[key][bucketParty] = (decilePartyTotals[key][bucketParty] || 0) + value;
    }
  }
  const partyColorByName = Object.fromEntries(sortedParties.map((p) => [p.party, getWinnerPartyColor(p.party)]));
  if (!showSmallParties) partyColorByName.Other = "#9ca3af";
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
  const legendParties = showSmallParties ? barParties.map((p) => p.party) : [...barParties.map((p) => p.party), "Other"];
  const legendItems = legendParties
    .map((party) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:2px;background:${partyColorByName[party] || "#6b7280"};display:inline-block;"></span>${party}</span>`)
    .join("");
  wardDeprivationBars.innerHTML = `<div class="stacked-bars">${stackedRows.join("")}</div><div class="stacked-legend">${legendItems}</div>`;
  wardDeprivationTable.innerHTML = [
    '<table class="simple-table">',
    "<thead><tr><th>Winning Party</th><th>Winning Wards</th><th>Weighted Deprivation Decile</th></tr></thead>",
    "<tbody>",
    ...topParties.map((row, rownum) => (
      `<tr><td>${row.party || "Unknown"}</td><td>${Number(row.wards_won || 0).toLocaleString()}</td><td>${Number(row.deprivation_weighted_mean_decile || 0).toFixed(2)}${rownum===0?' (poorest)':(rownum===(topParties.length-1)?' (richest)':'')}</td></tr>`
    )),
    buildHiddenPartySummaryRow(hiddenRows.length, 3),
    "</tbody></table><p class='panel-note'>Weighted decile is based on the deprivation-area mix inside wards won by each party.</p>"
  ].join("");
  wardDeprivationTable.querySelector(".table-toggle-link")?.addEventListener("click", toggleSharedSmallParties);
}

async function loadWardDeprivationIndex() {
  if (!wardDeprivationSummary || !wardDeprivationTable || !wardDeprivationBars) return;
  setLoadStatus("deprivationIndex", "loading", "Preparing party summary...");
  try {
    const response = await fetch(WARD_DEPRIVATION_INDEX_URL);
    if (!response.ok) throw new Error(`Ward deprivation index request failed: ${response.status}`);
    const payload = await response.json();
    wardDeprivationIndexPayload = payload;
    renderWardDeprivationTable(payload);
    const partyCount = Array.isArray(payload?.parties) ? payload.parties.length : 0;
    setLoadStatus("deprivationIndex", "ready", `${partyCount.toLocaleString()} party rows`);
  } catch (_error) {
    wardDeprivationSummary.textContent = "Ward deprivation index unavailable. Run `yarn deprivation:index:update`.";
    wardDeprivationBars.innerHTML = "";
    wardDeprivationTable.innerHTML = "";
    setLoadStatus("deprivationIndex", "error", "Summary unavailable");
  }
}

function renderGroupedDeprivationProfiles(payload, selectedGroupSetId) {
  if (!groupedDeprivationSelect || !groupedDeprivationSummary || !groupedDeprivationBars) return;
  const groupSets = Array.isArray(payload?.group_sets) ? payload.group_sets : [];
  if (!groupSets.length) {
    groupedDeprivationSummary.textContent = "No grouped deprivation profiles available yet.";
    groupedDeprivationBars.innerHTML = "";
    groupedDeprivationSelect.innerHTML = "";
    return;
  }

  const resolvedGroupSetId = selectedGroupSetId || groupedDeprivationSelect.value || groupSets[0]?.id;
  const activeGroupSet = groupSets.find((row) => row.id === resolvedGroupSetId) || groupSets[0];

  if (!groupedDeprivationSelect.options.length || groupedDeprivationSelect.options.length !== groupSets.length) {
    groupedDeprivationSelect.innerHTML = groupSets
      .map((row) => `<option value="${row.id}">${row.label}</option>`)
      .join("");
  }
  groupedDeprivationSelect.value = activeGroupSet.id;

  const groups = Array.isArray(activeGroupSet?.groups) ? activeGroupSet.groups : [];
  const summary = payload?.summary || {};
  groupedDeprivationSummary.textContent =
    `${activeGroupSet.description} Showing ${(summary.wards_with_declared_winner || 0).toLocaleString()} declared wards.`;

  if (!groups.length) {
    groupedDeprivationBars.innerHTML = "<p class='hint'>No groups available for this view.</p>";
    return;
  }

  const rows = groups.map((group) => {
    const shares = group?.deprivation_area_share_by_decile || {};
    const segments = [];
    for (let d = 1; d <= 10; d += 1) {
      const share = Number(shares[String(d)] || 0);
      if (share <= 0) continue;
      segments.push(
        `<span class="distribution-segment" style="width:${(share * 100).toFixed(2)}%;background:${getDecileColor(d)}" title="${group.label}: decile ${d} ${(share * 100).toFixed(1)}%"></span>`
      );
    }
    return (
      `<div class="distribution-row"><div class="distribution-label">${group.label} (${Number(group.ward_count || 0).toLocaleString()})</div><div class="distribution-track">${segments.join("")}</div></div>`
    );
  });

  const legend = Array.from({ length: 10 }, (_value, index) => {
    const decile = index + 1;
    const label = decile === 1 ? "Poorest" : decile === 10 ? "Richest" : `D${decile}`;
    return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:2px;background:${getDecileColor(decile)};display:inline-block;"></span>${label}</span>`;
  }).join("");

  groupedDeprivationBars.innerHTML = `<div class="distribution-bars">${rows.join("")}</div><div class="distribution-legend">${legend}</div>`;
}

async function loadWardDeprivationGroups() {
  if (!groupedDeprivationSelect || !groupedDeprivationSummary || !groupedDeprivationBars) return;
  setLoadStatus("deprivationGroups", "loading", "Preparing grouped views...");
  try {
    const response = await fetch(WARD_DEPRIVATION_GROUPS_URL);
    if (!response.ok) throw new Error(`Ward deprivation groups request failed: ${response.status}`);
    wardDeprivationGroupsPayload = await response.json();
    renderGroupedDeprivationProfiles(wardDeprivationGroupsPayload);
    const groupSetCount = Array.isArray(wardDeprivationGroupsPayload?.group_sets) ? wardDeprivationGroupsPayload.group_sets.length : 0;
    setLoadStatus("deprivationGroups", "ready", `${groupSetCount.toLocaleString()} views`);
  } catch (_error) {
    groupedDeprivationSummary.textContent = "Grouped deprivation profiles unavailable. Run `yarn deprivation:groups:update`.";
    groupedDeprivationBars.innerHTML = "";
    groupedDeprivationSelect.innerHTML = "";
    setLoadStatus("deprivationGroups", "error", "Grouped views unavailable");
  }
}

function formatPercentCell(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "n/a";
}

function renderWardCensusDemographics(payload) {
  if (!censusSignalsSummary || !censusSignalsTable || !censusPartyTable) return;
  const summary = payload?.summary || {};
  const featureCatalog = Array.isArray(payload?.feature_catalog) ? payload.feature_catalog : [];
  const parties = Array.isArray(payload?.parties) ? payload.parties : [];
  const correlations = Array.isArray(payload?.correlations) ? payload.correlations : [];
  const selectableParties = getMajorCensusParties(parties);
  const selectablePartyNames = new Set(selectableParties.map((row) => row.party));
  const reformOption = selectableParties.find((row) => row.party === "Reform UK")?.party || null;

  selectedCensusParty = selectablePartyNames.has(selectedCensusParty)
    ? selectedCensusParty
    : (reformOption || selectableParties[0]?.party || "Reform UK");

  censusSignalsSummary.textContent =
    `Census estimates available for ${(summary.wards_with_declared_winner || 0).toLocaleString()} declared winning wards out of ${(summary.wards_total || 0).toLocaleString()} total wards.`;

  if (censusPartySelect) {
    const optionHtml = selectableParties
      .map((party) => `<option value="${party.party}">${party.party}</option>`)
      .join("");
    if (censusPartySelect.innerHTML !== optionHtml) {
      censusPartySelect.innerHTML = optionHtml;
    }
    censusPartySelect.value = selectedCensusParty;
    censusPartySelect.disabled = selectableParties.length <= 1;
  }

  const selectedParty = parties.find((party) => party.party === selectedCensusParty)
    || selectableParties.find((party) => party.party === selectedCensusParty)
    || selectableParties[0]
    || null;
  const allDeclaredMeans = computeAllDeclaredMeansFromParties(parties, featureCatalog.map((feature) => feature.id));
  const selectedSignalRows = selectedParty
    ? featureCatalog
      .map((feature) => {
        const partyMean = Number(selectedParty?.means?.[feature.id]);
        const allDeclaredMean = Number(allDeclaredMeans?.[feature.id]);
        if (!Number.isFinite(partyMean) || !Number.isFinite(allDeclaredMean)) return null;
        return {
          featureId: feature.id,
          label: feature.label || feature.id,
          partyMean,
          allDeclaredMean,
          difference: partyMean - allDeclaredMean
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
    : [];

  if (selectedSignalRows.length) {
    const topDeltas = selectedSignalRows.slice(0, 8);
    const rows = topDeltas.map((row) => (
      `<tr><td>${row.label}</td><td>${formatFeatureMean(row.featureId, row.partyMean)}</td><td>${formatFeatureMean(row.featureId, row.allDeclaredMean)}</td><td class="${getDeltaClass(row.difference)}">${formatFeatureDelta(row.featureId, row.difference)}</td></tr>`
    ));
    const selectedCorrelations = correlations.find((row) => row.party === selectedCensusParty)?.strongest_signals || [];
    const correlationHtml = selectedCorrelations.length
      ? `<p class="hint">Strongest ${selectedCensusParty} correlations: ${selectedCorrelations.map((row) => `${row.label} (${Number(row.correlation).toFixed(2)})`).join(" · ")}</p>`
      : "";
    censusSignalsTable.innerHTML = [
      '<table class="simple-table">',
      `<thead><tr><th>Feature</th><th>${selectedCensusParty}</th><th>All Declared Winners</th><th>Delta</th></tr></thead>`,
      "<tbody>",
      ...rows,
      "</tbody></table>",
      correlationHtml
    ].join("");
  } else {
    censusSignalsTable.innerHTML = "<p class='hint'>No census signal summary available yet.</p>";
  }

  const partyRows = selectableParties
    .map((party) => (
      `<tr><td>${party.party}</td><td>${Number(party.wards_won || 0).toLocaleString()}</td><td>${formatPercentCell(party.means?.white_british_pct)}</td><td>${formatPercentCell(party.means?.age_50plus_pct)}</td><td>${formatPercentCell(party.means?.owner_occupied_pct)}</td><td>${formatPercentCell(party.means?.degree_pct)}</td><td>${Number(party.means?.imd_score || 0).toFixed(2)}</td></tr>`
    ));
  censusPartyTable.innerHTML = [
    '<table class="simple-table">',
    "<thead><tr><th>Winning Party</th><th>Declared Winning Wards</th><th>White British</th><th>Age 50+</th><th>Owner Occ</th><th>Degree</th><th>IMD</th></tr></thead>",
    "<tbody>",
    ...partyRows,
    "</tbody></table>"
  ].join("");
}

async function loadWardCensusDemographics() {
  if (!censusSignalsSummary || !censusSignalsTable || !censusPartyTable) return;
  setLoadStatus("census", "loading", "Preparing census summaries...");
  try {
    const response = await fetch(WARD_CENSUS_DEMOGRAPHICS_URL);
    if (!response.ok) throw new Error(`Ward census demographics request failed: ${response.status}`);
    const payload = await response.json();
    wardCensusDemographicsPayload = payload;
    renderWardCensusDemographics(payload);
    const wardCount = Number(payload?.summary?.wards_with_declared_winner || 0);
    setLoadStatus("census", "ready", `${wardCount.toLocaleString()} declared wards`);
  } catch (_error) {
    censusSignalsSummary.textContent = "Ward census summaries unavailable. Run `yarn census:update`.";
    censusSignalsTable.innerHTML = "";
    censusPartyTable.innerHTML = "";
    setLoadStatus("census", "error", "Summary unavailable");
  }
}

function renderGpPartyRatings(payload) {
  if (!gpPartySummary || !gpPartyChart || !gpPartyTable) return;
  const summary = payload?.summary || {};
  const parties = Array.isArray(payload?.parties) ? payload.parties : [];
  const filtered = parties
    .filter((row) => Number(row?.rated_practices_count || 0) >= 25)
    .sort((a, b) => Number(b.avg_google_score || 0) - Number(a.avg_google_score || 0));

  gpPartySummary.textContent =
    `Imported ${Number(summary.wards_with_practices || 0).toLocaleString()} wards with GP practices. Chart shows parties with at least 25 rated practices, grouped by the ward winner.`;

  if (!filtered.length) {
    gpPartyChart.innerHTML = "";
    gpPartyTable.innerHTML = "<p class='hint'>No party-level GP ratings available yet.</p>";
    return;
  }

  const chartRows = filtered.slice(0, 8).map((row) => {
    const avg = Number(row.avg_google_score || 0);
    const fill = `${Math.max(0, Math.min(100, (avg / 5) * 100)).toFixed(1)}%`;
    return `<div class="rating-row"><div class="rating-label">${row.party}</div><div class="rating-track"><div class="rating-fill" style="width:${fill};background:${getGpRatingColor(avg)}"></div></div><div class="rating-value">${avg.toFixed(2)}</div></div>`;
  });
  gpPartyChart.innerHTML = `<div class="rating-bars">${chartRows.join("")}</div>`;

  gpPartyTable.innerHTML = [
    '<table class="simple-table">',
    "<thead><tr><th>Party</th><th>Rated GPs</th><th>Google Rating</th><th>Patient Survey</th></tr></thead>",
    "<tbody>",
    ...filtered.slice(0, 10).map((row) => (
      `<tr><td>${row.party}</td><td>${Number(row.rated_practices_count || 0).toLocaleString()}</td><td>${Number(row.avg_google_score || 0).toFixed(2)}</td><td>${Number.isFinite(Number(row.avg_survey_overall_good_percent)) ? `${Number(row.avg_survey_overall_good_percent).toFixed(1)}%` : "n/a"}</td></tr>`
    )),
    "</tbody></table>"
  ].join("");
}

async function loadGpPractices() {
  if (!gpRatingsStatus) return;
  setLoadStatus("gpPractices", "loading", "Loading GP points...");
  try {
    const response = await fetch(GP_PRACTICES_URL);
    if (!response.ok) throw new Error(`GP practices request failed: ${response.status}`);
    const payload = await response.json();
    gpPractices = Array.isArray(payload?.practices) ? payload.practices.filter((row) => Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon))) : [];
    if (!gpPracticeLayer) gpPracticeLayer = L.layerGroup();
    gpRatingsStatus.textContent = `Prepared ${gpPractices.length.toLocaleString()} GP practices.`;
    applyGpLayerVisibility();
    setLoadStatus("gpPractices", "ready", `${gpPractices.length.toLocaleString()} practices`);
  } catch (error) {
    console.error(error);
    gpPractices = [];
    gpRatingsStatus.textContent = "Could not load GP ratings layer.";
    setLoadStatus("gpPractices", "error", "Request failed");
  }
}

async function loadGpRatingsSummary() {
  if (!gpPartySummary || !gpPartyChart || !gpPartyTable) return;
  setLoadStatus("gpSummary", "loading", "Preparing party averages...");
  try {
    const response = await fetch(GP_RATINGS_SUMMARY_URL);
    if (!response.ok) throw new Error(`GP ratings summary request failed: ${response.status}`);
    gpRatingsSummaryPayload = await response.json();
    gpSummaryByWardCode = new Map(
      (Array.isArray(gpRatingsSummaryPayload?.wards) ? gpRatingsSummaryPayload.wards : [])
        .filter((row) => row?.ward_code)
        .map((row) => [row.ward_code, row])
    );
    renderGpPartyRatings(gpRatingsSummaryPayload);
    const wardCount = Array.isArray(gpRatingsSummaryPayload?.wards) ? gpRatingsSummaryPayload.wards.length : 0;
    setLoadStatus("gpSummary", "ready", `${wardCount.toLocaleString()} ward summaries`);
  } catch (error) {
    console.error(error);
    gpSummaryByWardCode = new Map();
    gpPartySummary.textContent = "GP rating summaries unavailable. Run `yarn gp:import`.";
    gpPartyChart.innerHTML = "";
    gpPartyTable.innerHTML = "";
    setLoadStatus("gpSummary", "error", "Summary unavailable");
  }
}

collapseButton.addEventListener("click", () => {
  const isCollapsed = mapStage.classList.toggle("is-collapsed");
  collapseButton.innerHTML = isCollapsed ? "&rsaquo;" : "&lsaquo;";
  collapseButton.setAttribute("aria-pressed", isCollapsed ? "true" : "false");
  setTimeout(() => map.invalidateSize(), 180);
});

if (effectsToggle) {
  effectsToggle.addEventListener("change", applyEffectsVisibility);
}
if (gpRatingsToggle) {
  gpRatingsToggle.addEventListener("change", () => {
    layerPrefs.gp = Boolean(gpRatingsToggle.checked);
    applyGpLayerVisibility();
  });
}
councilResultsToggle.addEventListener("change", () => {
  layerPrefs.council = Boolean(councilResultsToggle.checked);
  applyWardLayerVisibility();
  updateWardStatusDefault();
});
wardResultsToggle.addEventListener("change", () => {
  layerPrefs.ward = Boolean(wardResultsToggle.checked);
  applyWardLayerVisibility();
  updateWardStatusDefault();
});
deprivationToggle.addEventListener("change", () => {
  layerPrefs.deprivation = Boolean(deprivationToggle.checked);
  applyLayerVisibility();
});
if (wardFillToggle) {
  wardFillToggle.addEventListener("change", () => {
    updateElectionStrokeStylesForZoom();
  });
}
if (groupedDeprivationSelect) {
  groupedDeprivationSelect.addEventListener("change", () => {
    if (wardDeprivationGroupsPayload) {
      renderGroupedDeprivationProfiles(wardDeprivationGroupsPayload, groupedDeprivationSelect.value);
    }
  });
}
if (censusPartySelect) {
  censusPartySelect.addEventListener("change", () => {
    selectedCensusParty = censusPartySelect.value || "Reform UK";
    if (wardCensusDemographicsPayload) {
      renderWardCensusDemographics(wardCensusDemographicsPayload);
    }
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
map.on("moveend", () => {
  applyLayerVisibility();
  applyGpLayerVisibility();
});
map.on("zoomend", saveMapView);
map.on("zoomend", () => {
  zoomDebugControl.update();
  applyLayerVisibility();
  applyGpLayerVisibility();
  updateElectionStrokeStylesForZoom();
  applyWardLayerVisibility();
  updateWardStatusDefault();
});

renderLoadStatus();
updateSidebarToggleStates();
buildCombinedEffectsLayer();
applyEffectsVisibility();
await Promise.all([
  loadWardHoverSource(),
  loadCouncilSource(),
  loadWardElectionState(),
  loadGpPractices(),
  loadGpRatingsSummary()
]);
loadDeprivationLayer();
loadWardDeprivationIndex();
loadWardDeprivationGroups();
loadWardCensusDemographics();
updateMapWarnings();
