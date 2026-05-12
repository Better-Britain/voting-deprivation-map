import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const COUNCILLORS_CSV_YEAR = String(process.env.COUNCILLORS_CSV_YEAR || new Date().getUTCFullYear());
const COUNCILLORS_CSV_URL = `https://opencouncildata.co.uk/csv2.php?y=${encodeURIComponent(COUNCILLORS_CSV_YEAR)}`;

const LAD_QUERY_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_December_2024_Boundaries_UK_BGC/FeatureServer/0/query";

const OUTPUT_DIR = path.resolve(projectRoot, "src/data");
const OUTPUT_GEOJSON = path.resolve(OUTPUT_DIR, "england-councils.geojson");
const OUTPUT_SUMMARY = path.resolve(OUTPUT_DIR, "england-councils.summary.json");

function toQueryString(params) {
  return new URLSearchParams(params).toString();
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function sortEntriesDescending(entries) {
  return [...entries].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return String(a[0]).localeCompare(String(b[0]));
  });
}

async function fetchCouncils() {
  const query = toQueryString({
    f: "geojson",
    where: "LAD24CD LIKE 'E%'",
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

async function fetchCouncillorsCsv() {
  const response = await fetch(COUNCILLORS_CSV_URL);
  if (!response.ok) {
    throw new Error(`Councillors CSV request failed (${response.status})`);
  }
  return response.text();
}

function buildCouncilCompositionByName(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] || "");
  const councilIdx = header.indexOf("Council");
  const partyIdx = header.indexOf("Party Name");
  const partyCodeIdx = header.indexOf("Electoral Commission Party Code");
  if ([councilIdx, partyIdx].some((idx) => idx < 0)) {
    throw new Error("Unexpected councillors CSV schema");
  }

  const byCouncilName = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const councilName = String(row[councilIdx] || "").trim();
    if (!councilName) continue;
    const councilKey = normalizeName(councilName);
    if (!councilKey) continue;
    const partyName = String(row[partyIdx] || "Unknown").trim() || "Unknown";
    const partyCode = String(row[partyCodeIdx] || "").trim() || null;
    const existing = byCouncilName.get(councilKey) || {
      council_name: councilName,
      seat_total: 0,
      party_seats: new Map(),
      party_codes: new Map()
    };
    existing.seat_total += 1;
    existing.party_seats.set(partyName, (existing.party_seats.get(partyName) || 0) + 1);
    if (partyCode && !existing.party_codes.has(partyName)) {
      existing.party_codes.set(partyName, partyCode);
    }
    byCouncilName.set(councilKey, existing);
  }

  const output = new Map();
  for (const [councilKey, row] of byCouncilName.entries()) {
    const seatTotal = row.seat_total;
    const majorityThreshold = Math.floor(seatTotal / 2) + 1;
    const rankedParties = sortEntriesDescending(
      [...row.party_seats.entries()].filter(([partyName]) => normalizeName(partyName) !== "vacant")
    );
    const [topPartyName, topPartySeats] = rankedParties[0] || [null, 0];
    const hasMajority = Boolean(topPartyName) && topPartySeats >= majorityThreshold;
    const controlParty = hasMajority ? topPartyName : "No overall control";
    const controlPartyCode = hasMajority
      ? (row.party_codes.get(topPartyName) || null)
      : "NOC";

    output.set(councilKey, {
      council_name: row.council_name,
      council_control_party: controlParty,
      council_control_party_code: controlPartyCode,
      council_control_declared: seatTotal > 0,
      council_control_basis: hasMajority ? "majority" : "no_overall_control",
      council_control_majority_threshold: majorityThreshold,
      council_seat_total: seatTotal,
      council_party_seats: Object.fromEntries(sortEntriesDescending(row.party_seats.entries())),
      council_party_codes: Object.fromEntries(row.party_codes.entries()),
      council_party_seats_summary: rankedParties
        .map(([partyName, seats]) => `${partyName}: ${seats}`)
        .join(" | ")
    });
  }

  return output;
}

const [geojson, councillorsCsv] = await Promise.all([
  fetchCouncils(),
  fetchCouncillorsCsv()
]);
const councilCompositionByName = buildCouncilCompositionByName(councillorsCsv);
const features = (Array.isArray(geojson?.features) ? geojson.features : []).map((feature) => {
  const properties = feature?.properties || {};
  const matchedComposition = councilCompositionByName.get(normalizeName(properties.LAD24NM)) || null;
  if (!matchedComposition) return feature;
  return {
    ...feature,
    properties: {
      ...properties,
      ...matchedComposition,
      council_control_source: "opencouncildata_csv2",
      council_control_source_url: COUNCILLORS_CSV_URL,
      council_winner_party: matchedComposition.council_control_party,
      council_winner_party_code: matchedComposition.council_control_party_code,
      council_result_declared: matchedComposition.council_control_declared,
      council_result_source: "opencouncildata_csv2"
    }
  };
});
const enrichedCount = features.filter((feature) => feature?.properties?.council_control_source).length;

const summary = {
  updated_at_utc: new Date().toISOString(),
  source: {
    boundaries_service: LAD_QUERY_URL,
    boundaries_dataset: "ONS LAD December 2024 Boundaries UK BGC",
    council_composition_csv: COUNCILLORS_CSV_URL
  },
  filter: {
    territory: "England",
    where: "LAD24CD LIKE 'E%'"
  },
  counts: {
    councils: features.length,
    councils_with_control: enrichedCount
  }
};

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(OUTPUT_GEOJSON, JSON.stringify({ type: "FeatureCollection", features }));
await fs.writeFile(OUTPUT_SUMMARY, JSON.stringify(summary, null, 2));

console.log(`Updated England councils source: ${features.length} council boundaries`);
