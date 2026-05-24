import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildConstituencyView } from "./lib/ge-adjustment.mjs";
import { FORECAST_TOO_CLOSE_THRESHOLD, TOO_CLOSE_TO_CALL_LABEL } from "./lib/forecast-thresholds.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const FORECAST_PATH = path.resolve(projectRoot, "src/data/next-ge-forecast.json");
const LOCAL_CONSTITUENCY_CACHE_PATH = path.resolve(projectRoot, "forecast/cache/england-constituencies.geojson");
const RAW_OUTPUT_PATH = path.resolve(projectRoot, "public/images/forecast-projection-map-raw.png");
const GE_ADJUSTED_OUTPUT_PATH = path.resolve(projectRoot, "public/images/forecast-projection-map-ge-adjusted.png");
const LEGACY_OUTPUT_PATH = path.resolve(projectRoot, "public/images/forecast-projection-map.png");

const CONSTITUENCY_SERVICE_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC/FeatureServer/0/query?where=PCON24CD%20LIKE%20%27E%25%27&outFields=PCON24CD,PCON24NM&returnGeometry=true&outSR=4326&geometryPrecision=3&f=geojson";

const PARTY_COLORS = {
  Labour: "#e4003b",
  Conservative: "#0087dc",
  "Reform UK": "#12b6cf",
  "Liberal Democrats": "#faa61a",
  "Green Party": "#6ab023",
  Independent: "#9ca3af"
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function loadConstituencyGeojson() {
  try {
    return await readJsonFile(LOCAL_CONSTITUENCY_CACHE_PATH);
  } catch (_error) {
    const response = await fetch(CONSTITUENCY_SERVICE_URL);
    if (!response.ok) {
      throw new Error(`Constituency boundary request failed: ${response.status}`);
    }
    return response.json();
  }
}

function mercatorProject(lon, lat) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = (lon + 180) / 360;
  const y = (1 - (Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360)) / Math.PI)) / 2;
  return [x, y];
}

function visitCoordinates(geometry, visitor) {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    for (const ring of Array.isArray(geometry.coordinates) ? geometry.coordinates : []) {
      for (const coord of Array.isArray(ring) ? ring : []) {
        if (Array.isArray(coord) && coord.length >= 2) visitor(coord[0], coord[1]);
      }
    }
    return;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of Array.isArray(geometry.coordinates) ? geometry.coordinates : []) {
      for (const ring of Array.isArray(polygon) ? polygon : []) {
        for (const coord of Array.isArray(ring) ? ring : []) {
          if (Array.isArray(coord) && coord.length >= 2) visitor(coord[0], coord[1]);
        }
      }
    }
    return;
  }
  if (geometry.type === "GeometryCollection") {
    for (const child of Array.isArray(geometry.geometries) ? geometry.geometries : []) {
      visitCoordinates(child, visitor);
    }
  }
}

function geometryToPathData(geometry, project) {
  const parts = [];
  if (!geometry) return "";

  const pushRing = (ring) => {
    const coords = Array.isArray(ring) ? ring : [];
    if (!coords.length) return;
    const path = coords
      .filter((coord) => Array.isArray(coord) && coord.length >= 2)
      .map(([lon, lat], index) => {
        const [x, y] = project(lon, lat);
        return `${index === 0 ? "M" : "L"}${rounded(x)} ${rounded(y)}`;
      })
      .join(" ");
    if (path) parts.push(`${path} Z`);
  };

  if (geometry.type === "Polygon") {
    for (const ring of Array.isArray(geometry.coordinates) ? geometry.coordinates : []) pushRing(ring);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of Array.isArray(geometry.coordinates) ? geometry.coordinates : []) {
      for (const ring of Array.isArray(polygon) ? polygon : []) pushRing(ring);
    }
  } else if (geometry.type === "GeometryCollection") {
    for (const child of Array.isArray(geometry.geometries) ? geometry.geometries : []) {
      const childPath = geometryToPathData(child, project);
      if (childPath) parts.push(childPath);
    }
  }

  return parts.join(" ");
}

function buildProjection(features) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const feature of features) {
    visitCoordinates(feature?.geometry, (lon, lat) => {
      const [x, y] = mercatorProject(lon, lat);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    throw new Error("No valid constituency geometry found for projection");
  }

  const xSpan = Math.max(maxX - minX, 0.00001);
  const ySpan = Math.max(maxY - minY, 0.00001);
  const maxDimension = 3000;
  const pad = Math.round(maxDimension * 0.035);
  const fitWidth = maxDimension - pad * 2;
  const fitHeight = maxDimension - pad * 2;
  const scale = Math.min(fitWidth / xSpan, fitHeight / ySpan);
  const contentWidth = xSpan * scale;
  const contentHeight = ySpan * scale;
  const width = Math.max(1, Math.round(contentWidth + pad * 2));
  const height = Math.max(1, Math.round(contentHeight + pad * 2));
  const extraX = (width - pad * 2 - contentWidth) / 2;
  const extraY = (height - pad * 2 - contentHeight) / 2;

  function project(lon, lat) {
    const [x, y] = mercatorProject(lon, lat);
    const screenX = ((x - minX) * scale) + pad + extraX;
    const screenY = ((y - minY) * scale) + pad + extraY;
    return [screenX, screenY];
  }

  return { width, height, project };
}

function partyFill(party) {
  return PARTY_COLORS[party] || "#d1d5db";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getConstituencyCode(feature) {
  return String(
    feature?.properties?.constituency_code ||
    feature?.properties?.PCON24CD ||
    ""
  ).trim();
}

function buildLegendBox(modeLabel) {
  return `
    <g transform="translate(42 42)">
      <rect x="0" y="0" width="360" height="112" rx="3" ry="3" fill="rgba(255, 252, 246, 0.96)" stroke="rgba(24, 32, 29, 0.16)" stroke-width="2"></rect>
      <text x="18" y="28" fill="#18201d" font-family="Avenir Next, Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="24" font-weight="800">${escapeHtml(modeLabel)}</text>
      <text x="18" y="52" fill="rgba(24, 32, 29, 0.74)" font-family="Avenir Next, Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="16" font-weight="600">Grey seats = ${escapeHtml(TOO_CLOSE_TO_CALL_LABEL)}</text>
      <rect x="18" y="68" width="20" height="20" rx="3" ry="3" fill="#d1d5db" stroke="rgba(24, 32, 29, 0.18)" stroke-width="1.5"></rect>
      <text x="48" y="84" fill="rgba(24, 32, 29, 0.72)" font-family="Avenir Next, Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="600">Low-confidence constituencies</text>
    </g>
  `;
}

function buildSvg({ projection, mapPaths, modeLabel }) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${projection.width}" height="${projection.height}" viewBox="0 0 ${projection.width} ${projection.height}" role="img" aria-label="Projected constituency outcome map">
      <rect width="100%" height="100%" fill="#f4efe4"></rect>
      ${buildLegendBox(modeLabel)}
      <g>${mapPaths.join("")}</g>
      <rect x="0" y="0" width="${projection.width}" height="${projection.height}" fill="none" stroke="#d4cbbd" stroke-width="4"></rect>
    </svg>
  `;
}

function buildMapPaths(features, projection, forecastRows) {
  const mapPaths = [];
  for (const feature of features) {
    const code = getConstituencyCode(feature);
    const row = forecastRows.get(code) || null;
    const confidence = Number(row?.forecast?.confidence || 0);
    const winner = confidence > FORECAST_TOO_CLOSE_THRESHOLD ? (row?.forecast?.winner || null) : TOO_CLOSE_TO_CALL_LABEL;
    const fill = winner && winner !== TOO_CLOSE_TO_CALL_LABEL ? partyFill(winner) : "#d1d5db";
    const pathData = geometryToPathData(feature.geometry, projection.project);
    if (!pathData) continue;
    mapPaths.push(`
      <path
        d="${pathData}"
        fill="${fill}"
        fill-rule="evenodd"
        stroke="#ffffff"
        stroke-width="0.7"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      ></path>
    `);
  }
  return mapPaths;
}

async function renderVariant({ projection, features, forecastRows, outputPath, modeLabel }) {
  const mapPaths = buildMapPaths(features, projection, forecastRows);
  const svg = buildSvg({ projection, mapPaths, modeLabel });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: projection.width, height: projection.height },
      deviceScaleFactor: 1
    });
    await page.setContent(`
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: ${projection.width}px;
            height: ${projection.height}px;
            overflow: hidden;
            background: #f4efe4;
          }
          svg {
            display: block;
            width: ${projection.width}px;
            height: ${projection.height}px;
          }
        </style>
      </head>
      <body>
        ${svg}
      </body>
      </html>
    `);
    await page.screenshot({
      path: outputPath,
      omitBackground: false
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  const forecast = await readJsonFile(FORECAST_PATH);
  const geojson = await loadConstituencyGeojson();
  const features = (Array.isArray(geojson?.features) ? geojson.features : [])
    .filter((feature) => getConstituencyCode(feature).startsWith("E"))
    .filter((feature) => feature?.geometry);

  const projection = buildProjection(features);
  const rawRows = new Map(
    (Array.isArray(forecast?.constituency_forecasts) ? forecast.constituency_forecasts : [])
      .map((row) => [String(row?.constituency_code || ""), row])
  );
  const geAdjustedForecast = buildConstituencyView(forecast, true);
  const geAdjustedRows = new Map(
    (Array.isArray(geAdjustedForecast?.constituency_forecasts) ? geAdjustedForecast.constituency_forecasts : [])
      .map((row) => [String(row?.constituency_code || ""), row])
  );

  await fs.mkdir(path.dirname(RAW_OUTPUT_PATH), { recursive: true });
  await renderVariant({
    projection,
    features,
    forecastRows: rawRows,
    outputPath: RAW_OUTPUT_PATH,
    modeLabel: "Raw local"
  });
  await renderVariant({
    projection,
    features,
    forecastRows: geAdjustedRows,
    outputPath: GE_ADJUSTED_OUTPUT_PATH,
    modeLabel: "GE-adjusted"
  });
  await fs.copyFile(GE_ADJUSTED_OUTPUT_PATH, LEGACY_OUTPUT_PATH);

  const projectedSeats = Object.entries(geAdjustedForecast?.party_seat_totals || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([party, seats]) => `${party} ${safeNumber(seats, 0)}`)
    .join(", ");
  console.log(`Rendered forecast map PNGs at ${RAW_OUTPUT_PATH} and ${GE_ADJUSTED_OUTPUT_PATH}`);
  console.log(`Updated legacy map alias at ${LEGACY_OUTPUT_PATH}`);
  console.log(`GE-adjusted seat totals: ${projectedSeats}`);
}

await main();
