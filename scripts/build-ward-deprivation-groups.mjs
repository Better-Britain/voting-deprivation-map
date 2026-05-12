import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { centroid } from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const WARDS_GEOJSON_PATH = path.resolve(projectRoot, "src/data/england-wards.geojson");
const WARD_DEPRIVATION_INDEX_PATH = path.resolve(projectRoot, "src/data/ward-deprivation-vote-index.json");
const OUTPUT_PATH = path.resolve(projectRoot, "src/data/ward-deprivation-groups.json");

const LAD_TO_REGION_CSV_URL =
  "https://open-geography-portalx-ons.hub.arcgis.com/api/download/v1/items/3959874c514b470e9dd160acdc00c97a/csv?layers=0";
const DENSITY_RADIUS_KM = 15;
const DENSITY_GRID_CELL_DEGREES = 0.25;

const REGION_GROUP_ORDER = [
  "North East",
  "North West",
  "Yorkshire and The Humber",
  "East Midlands",
  "West Midlands",
  "East of England",
  "London",
  "South East",
  "South West"
];

const MACRO_REGION_MAP = {
  "North East": "North",
  "North West": "North",
  "Yorkshire and The Humber": "North",
  "East Midlands": "Midlands",
  "West Midlands": "Midlands",
  "East of England": "South",
  London: "London",
  "South East": "South",
  "South West": "South"
};

const MACRO_REGION_ORDER = ["North", "Midlands", "South", "London"];
const SETTLEMENT_EXTREME_ORDER = ["Urban / Dense", "Rural / Sparse"];
const CITY_CATCHMENTS = [
  { name: "Manchester", lat: 53.4808, lon: -2.2426, radius_miles: 5.8 },
  { name: "London", lat: 51.5072, lon: -0.1276, radius_miles: 8.5 },
  { name: "Liverpool", lat: 53.4084, lon: -2.9916, radius_miles: 5.3 },
  { name: "Leeds", lat: 53.8008, lon: -1.5491, radius_miles: 5.8 },
  { name: "Sheffield", lat: 53.3811, lon: -1.4701, radius_miles: 5.4 },
  { name: "Birmingham", lat: 52.4862, lon: -1.8904, radius_miles: 6.6 },
  { name: "Bristol", lat: 51.4545, lon: -2.5879, radius_miles: 5.1 },
  { name: "Newcastle", lat: 54.9783, lon: -1.6178, radius_miles: 4.9 },
  { name: "Oxford", lat: 51.752, lon: -1.2577, radius_miles: 3.7 },
  { name: "Harrogate", lat: 53.9921, lon: -1.5418, radius_miles: 3.3 }
];
const CITY_REGION_ORDER = CITY_CATCHMENTS.map((city) => city.name);

function rounded(value, dp = 4) {
  return Number(Number(value || 0).toFixed(dp));
}

function emptyDeciles() {
  const out = {};
  for (let d = 1; d <= 10; d += 1) out[String(d)] = 0;
  return out;
}

function parseCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) return [];
  const rows = [];
  const headers = parseCsvLine(lines[0]);
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (!values.length) continue;
    const row = {};
    for (let j = 0; j < headers.length; j += 1) row[headers[j]] = values[j] ?? "";
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((value) => value.trim());
}

function haversineKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const deltaLat = toRad(b.lat - a.lat);
  const deltaLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(
    Math.sqrt((sinLat ** 2) + (Math.cos(lat1) * Math.cos(lat2) * (sinLon ** 2))),
    Math.sqrt(1 - (sinLat ** 2) - (Math.cos(lat1) * Math.cos(lat2) * (sinLon ** 2)))
  );
  return 6371 * c;
}

function quintileCodeSets(rows, valueKey) {
  const scoredRows = rows
    .map((row) => ({ ward_code: row.ward_code, value: Number(row[valueKey]) }))
    .filter((row) => row.ward_code && Number.isFinite(row.value))
    .sort((a, b) => a.value - b.value);
  if (!scoredRows.length) return { low: new Set(), high: new Set() };
  const quintileSize = Math.max(1, Math.floor(scoredRows.length / 5));
  return {
    low: new Set(scoredRows.slice(0, quintileSize).map((row) => row.ward_code)),
    high: new Set(scoredRows.slice(-quintileSize).map((row) => row.ward_code))
  };
}

function cityCatchmentForRow(row) {
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) return null;
  let best = null;
  for (const city of CITY_CATCHMENTS) {
    const distanceMiles = haversineKm(row, city) * 0.621371;
    if (distanceMiles > Number(city.radius_miles)) continue;
    if (!best || distanceMiles < best.distanceMiles) {
      best = { name: city.name, distanceMiles };
    }
  }
  return best?.name || null;
}

function aggregateWardGroup(rows) {
  const totals = emptyDeciles();
  for (const row of rows) {
    const shares = row?.deprivation_area_share_by_decile || {};
    for (let d = 1; d <= 10; d += 1) totals[String(d)] += Number(shares[String(d)] || 0);
  }
  const denominator = rows.length || 1;
  const shareByDecile = {};
  let weightedMeanDecile = 0;
  let dominantDecile = "n/a";
  let dominantShare = -1;
  for (let d = 1; d <= 10; d += 1) {
    const key = String(d);
    const share = totals[key] / denominator;
    shareByDecile[key] = rounded(share);
    weightedMeanDecile += d * share;
    if (share > dominantShare) {
      dominantShare = share;
      dominantDecile = key;
    }
  }
  return {
    ward_count: rows.length,
    deprivation_weighted_mean_decile: rounded(weightedMeanDecile, 3),
    deprivation_dominant_decile: dominantDecile,
    deprivation_dominant_share: rounded(dominantShare),
    deprivation_area_share_by_decile: shareByDecile
  };
}

function buildOrderedGroups(groupMap, order) {
  const out = [];
  for (const label of order) {
    const rows = groupMap.get(label) || [];
    if (!rows.length) continue;
    out.push({
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      label,
      ...aggregateWardGroup(rows)
    });
  }
  return out;
}

async function fetchLadToRegionLookup() {
  const response = await fetch(LAD_TO_REGION_CSV_URL);
  if (!response.ok) {
    throw new Error(`LAD to region lookup request failed: ${response.status}`);
  }
  const csvText = await response.text();
  const rows = parseCsv(csvText);
  const lookup = new Map();
  for (const row of rows) {
    const ladCode = String(row.LAD24CD || "").trim();
    const regionName = String(row.RGN24NM || "").trim();
    const regionCode = String(row.RGN24CD || "").trim();
    if (!ladCode || !regionName) continue;
    lookup.set(ladCode, { region_name: regionName, region_code: regionCode || null });
  }
  return lookup;
}

const [wardsRaw, wardDeprivationRaw, ladToRegionLookup] = await Promise.all([
  fs.readFile(WARDS_GEOJSON_PATH, "utf8"),
  fs.readFile(WARD_DEPRIVATION_INDEX_PATH, "utf8"),
  fetchLadToRegionLookup()
]);

const wardsGeojson = JSON.parse(wardsRaw);
const wardDeprivation = JSON.parse(wardDeprivationRaw);

const wardFeatures = Array.isArray(wardsGeojson?.features) ? wardsGeojson.features : [];
const wardRows = Array.isArray(wardDeprivation?.wards) ? wardDeprivation.wards : [];
const wardFeatureMeta = new Map();

for (const feature of wardFeatures) {
  const props = feature?.properties || {};
  const wardCode = String(props.WD24CD || "");
  if (!wardCode) continue;
  const center = centroid(feature);
  const [lon, lat] = center?.geometry?.coordinates || [];
  wardFeatureMeta.set(wardCode, {
    ward_code: wardCode,
    ward_name: props.WD24NM || null,
    authority_code: props.LAD24CD || null,
    authority_name: props.LAD24NM || null,
    lat: Number(lat),
    lon: Number(lon)
  });
}

const enrichedWards = wardRows.map((row) => {
  const wardCode = String(row?.ward_code || "");
  const featureMeta = wardFeatureMeta.get(wardCode) || {};
  const authorityCode = String(featureMeta.authority_code || "");
  const regionMeta = ladToRegionLookup.get(authorityCode) || null;
  return {
    ...row,
    authority_code: featureMeta.authority_code || row.authority_code || null,
    authority_name: featureMeta.authority_name || row.authority_name || null,
    lat: featureMeta.lat,
    lon: featureMeta.lon,
    region_name: regionMeta?.region_name || null,
    region_code: regionMeta?.region_code || null,
    macro_region: regionMeta?.region_name ? (MACRO_REGION_MAP[regionMeta.region_name] || null) : null
  };
});

const spatialGrid = new Map();
for (const row of enrichedWards) {
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
  const gridX = Math.floor(row.lon / DENSITY_GRID_CELL_DEGREES);
  const gridY = Math.floor(row.lat / DENSITY_GRID_CELL_DEGREES);
  const key = `${gridX}:${gridY}`;
  const bucket = spatialGrid.get(key) || [];
  bucket.push(row);
  spatialGrid.set(key, bucket);
}

for (const row of enrichedWards) {
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) {
    row.nearby_ward_count_15km = null;
    continue;
  }
  const gridX = Math.floor(row.lon / DENSITY_GRID_CELL_DEGREES);
  const gridY = Math.floor(row.lat / DENSITY_GRID_CELL_DEGREES);
  let nearbyCount = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = spatialGrid.get(`${gridX + dx}:${gridY + dy}`) || [];
      for (const candidate of bucket) {
        if (candidate.ward_code === row.ward_code) continue;
        if (haversineKm(row, candidate) <= DENSITY_RADIUS_KM) nearbyCount += 1;
      }
    }
  }
  row.nearby_ward_count_15km = nearbyCount;
}

for (const row of enrichedWards) {
  row.city_region = cityCatchmentForRow(row);
}

const densityQuintiles = quintileCodeSets(
  enrichedWards.filter((row) => Number.isFinite(row.nearby_ward_count_15km)),
  "nearby_ward_count_15km"
);
for (const row of enrichedWards) {
  row.settlement_extreme = densityQuintiles.low.has(row.ward_code)
    ? "Rural / Sparse"
    : densityQuintiles.high.has(row.ward_code)
      ? "Urban / Dense"
      : null;
}

const declaredWards = enrichedWards.filter((row) => row.winner_party);

const regionGroups = new Map();
const macroRegionGroups = new Map();
const settlementGroups = new Map();
const cityRegionGroups = new Map();

for (const row of declaredWards) {
  if (row.region_name) {
    const bucket = regionGroups.get(row.region_name) || [];
    bucket.push(row);
    regionGroups.set(row.region_name, bucket);
  }
  if (row.macro_region) {
    const bucket = macroRegionGroups.get(row.macro_region) || [];
    bucket.push(row);
    macroRegionGroups.set(row.macro_region, bucket);
  }
  if (row.settlement_extreme) {
    const bucket = settlementGroups.get(row.settlement_extreme) || [];
    bucket.push(row);
    settlementGroups.set(row.settlement_extreme, bucket);
  }
  if (row.city_region) {
    const bucket = cityRegionGroups.get(row.city_region) || [];
    bucket.push(row);
    cityRegionGroups.set(row.city_region, bucket);
  }
}

const output = {
  updated_at_utc: new Date().toISOString(),
  sources: {
    ward_deprivation_index: WARD_DEPRIVATION_INDEX_PATH,
    wards_geojson: WARDS_GEOJSON_PATH,
    lad_to_region_lookup_csv: LAD_TO_REGION_CSV_URL
  },
  summary: {
    wards_total: enrichedWards.length,
    wards_with_declared_winner: declaredWards.length,
    density_radius_km: DENSITY_RADIUS_KM
  },
  global_profile: {
    label: "All declared wards",
    ...aggregateWardGroup(declaredWards)
  },
  group_sets: [
    {
      id: "official-region",
      label: "Official Regions",
      description: "Declared wards grouped by the ONS English region of their local authority.",
      groups: buildOrderedGroups(regionGroups, REGION_GROUP_ORDER)
    },
    {
      id: "macro-region",
      label: "North / Midlands / South / London",
      description: "Declared wards grouped into broad English blocs derived from official regions.",
      groups: buildOrderedGroups(macroRegionGroups, MACRO_REGION_ORDER)
    },
    {
      id: "settlement-extremes",
      label: "Settlement Extremes",
      description:
        "Declared wards split by nearby ward-centroid density within 15 km; bottom fifth is Rural / Sparse and top fifth is Urban / Dense.",
      groups: buildOrderedGroups(settlementGroups, SETTLEMENT_EXTREME_ORDER)
    },
    {
      id: "city-regions",
      label: "City Regions",
      description: "Declared wards grouped into the NHS map's English city catchments.",
      groups: buildOrderedGroups(cityRegionGroups, CITY_REGION_ORDER)
    }
  ]
};

await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
console.log(`Updated ward deprivation groups: ${output.summary.wards_with_declared_winner} declared wards across ${output.group_sets.length} group sets`);
