import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const WARDS_QUERY_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Wards_December_2024_Boundaries_UK_BGC/FeatureServer/0/query";

const GREATER_MANCHESTER_LAD24_CODES = [
  "E08000001", // Bolton
  "E08000002", // Bury
  "E08000003", // Manchester
  "E08000004", // Oldham
  "E08000005", // Rochdale
  "E08000006", // Salford
  "E08000007", // Stockport
  "E08000008", // Tameside
  "E08000009", // Trafford
  "E08000010"  // Wigan
];

const OUTPUT_DIR = path.resolve(projectRoot, "src/data");
const OUTPUT_GEOJSON = path.resolve(OUTPUT_DIR, "greater-manchester-wards.geojson");
const OUTPUT_SUMMARY = path.resolve(OUTPUT_DIR, "greater-manchester-wards.summary.json");

function toQueryString(params) {
  return new URLSearchParams(params).toString();
}

async function fetchWardPage(resultOffset) {
  const where = `LAD24CD IN (${GREATER_MANCHESTER_LAD24_CODES.map((code) => `'${code}'`).join(",")})`;
  const query = toQueryString({
    f: "geojson",
    where,
    outFields: "WD24CD,WD24NM,LAD24CD,LAD24NM",
    outSR: "4326",
    returnGeometry: "true",
    resultOffset: String(resultOffset),
    resultRecordCount: "2000"
  });
  const url = `${WARDS_QUERY_URL}?${query}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Ward query failed (${response.status}) at offset ${resultOffset}`);
  }
  return response.json();
}

async function downloadGreaterManchesterWards() {
  let offset = 0;
  const features = [];
  let safetyCounter = 0;

  while (safetyCounter < 20) {
    safetyCounter += 1;
    const page = await fetchWardPage(offset);
    const pageFeatures = Array.isArray(page?.features) ? page.features : [];
    features.push(...pageFeatures);
    if (!pageFeatures.length || pageFeatures.length < 2000) {
      break;
    }
    offset += pageFeatures.length;
  }

  const geojson = {
    type: "FeatureCollection",
    features
  };

  const uniqueLadNames = new Set(
    features
      .map((feature) => feature?.properties?.LAD24NM)
      .filter(Boolean)
  );

  const summary = {
    updated_at_utc: new Date().toISOString(),
    source: {
      service: WARDS_QUERY_URL,
      dataset: "ONS Wards December 2024 Boundaries UK BGC"
    },
    filter: {
      lad24_codes: GREATER_MANCHESTER_LAD24_CODES
    },
    counts: {
      wards: features.length,
      authorities: uniqueLadNames.size
    },
    authorities: Array.from(uniqueLadNames).sort()
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_GEOJSON, JSON.stringify(geojson));
  await fs.writeFile(OUTPUT_SUMMARY, JSON.stringify(summary, null, 2));

  return summary;
}

const summary = await downloadGreaterManchesterWards();
console.log(
  `Updated GM wards source: ${summary.counts.wards} wards across ${summary.counts.authorities} authorities`
);
