import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const LAD_QUERY_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_December_2024_Boundaries_UK_BGC/FeatureServer/0/query";

const GREATER_MANCHESTER_LAD24_CODES = [
  "E08000001",
  "E08000002",
  "E08000003",
  "E08000004",
  "E08000005",
  "E08000006",
  "E08000007",
  "E08000008",
  "E08000009",
  "E08000010"
];

const OUTPUT_DIR = path.resolve(projectRoot, "src/data");
const OUTPUT_GEOJSON = path.resolve(OUTPUT_DIR, "greater-manchester-councils.geojson");
const OUTPUT_SUMMARY = path.resolve(OUTPUT_DIR, "greater-manchester-councils.summary.json");

function toQueryString(params) {
  return new URLSearchParams(params).toString();
}

async function fetchCouncils() {
  const where = `LAD24CD IN (${GREATER_MANCHESTER_LAD24_CODES.map((code) => `'${code}'`).join(",")})`;
  const query = toQueryString({
    f: "geojson",
    where,
    outFields: "LAD24CD,LAD24NM",
    outSR: "4326",
    returnGeometry: "true"
  });
  const url = `${LAD_QUERY_URL}?${query}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Council query failed (${response.status})`);
  }
  return response.json();
}

const geojson = await fetchCouncils();
const features = Array.isArray(geojson?.features) ? geojson.features : [];

const summary = {
  updated_at_utc: new Date().toISOString(),
  source: {
    service: LAD_QUERY_URL,
    dataset: "ONS LAD December 2024 Boundaries UK BGC"
  },
  filter: {
    lad24_codes: GREATER_MANCHESTER_LAD24_CODES
  },
  counts: {
    councils: features.length
  }
};

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(OUTPUT_GEOJSON, JSON.stringify({ type: "FeatureCollection", features }));
await fs.writeFile(OUTPUT_SUMMARY, JSON.stringify(summary, null, 2));

console.log(`Updated GM councils source: ${features.length} council boundaries`);
