import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { bbox, booleanPointInPolygon, point } from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const NHS_DATASET_DIR = "/home/bobbigmac/projects/nhs-complaint-dec-2024/datasets/output/gtd-greater-manchester-gp-practice-reviews-2026-03-09";
const GM_CORE_JSON_PATH = path.join(NHS_DATASET_DIR, "gtd_greater_manchester_gp_practices.json");
const NATIONAL_SUPPLEMENTALS_JS_PATH = path.join(NHS_DATASET_DIR, "national-practice-supplementals.js");
const WARDS_GEOJSON_PATH = path.resolve(projectRoot, "src/data/england-wards.geojson");
const ELECTION_STATE_PATH = path.resolve(projectRoot, "src/data/england-ward-election-state.json");
const OUTPUT_PRACTICES_PATH = path.resolve(projectRoot, "src/data/england-gp-practices.json");
const OUTPUT_SUMMARY_PATH = path.resolve(projectRoot, "src/data/ward-gp-ratings.json");

const GRID_CELL_DEGREES = 0.25;

function rounded(value, dp = 4) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(dp)) : null;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function pointInBbox(lon, lat, box) {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

function parseWindowAssignment(jsSource, fieldName) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(jsSource, context);
  return context.window[fieldName];
}

function normalizeGmRow(row) {
  return {
    practice_code: stringOrNull(row.canonical_code),
    practice_name: stringOrNull(row.practice_name),
    lat: numericOrNull(row.latitude),
    lon: numericOrNull(row.longitude),
    postcode: stringOrNull(row.postcode),
    street_address: stringOrNull(row.street_address),
    nation: "england",
    google_score: numericOrNull(row.google_review_score),
    google_count: numericOrNull(row.google_review_count),
    survey_overall_good_percent: null,
    survey_completion_rate_percent: null,
    registered_patient_count: numericOrNull(row.registered_patient_count),
    cqc_overall_rating: stringOrNull(row.cqc_overall_rating),
    nhs_url: stringOrNull(row.nhs_profile_url),
    website_url: stringOrNull(row.website_url),
    google_maps_url: stringOrNull(row.google_review_source_url),
    management_company: stringOrNull(row.management_company_name),
    gtd: Boolean(row.gtd_managed),
    source_dataset: "nhs_project_gm_core"
  };
}

function normalizeSupplementalRow(row) {
  return {
    practice_code: stringOrNull(row.code),
    practice_name: stringOrNull(row.name),
    lat: numericOrNull(row.lat),
    lon: numericOrNull(row.lon),
    postcode: stringOrNull(row.postcode),
    street_address: stringOrNull(row.short_address),
    nation: stringOrNull(row.nation),
    google_score: numericOrNull(row.google_score),
    google_count: numericOrNull(row.google_count),
    survey_overall_good_percent: numericOrNull(row.survey_overall_good_percent),
    survey_completion_rate_percent: numericOrNull(row.survey_completion_rate_percent),
    registered_patient_count: numericOrNull(row.registered_patient_count_effective ?? row.registered_patient_count),
    cqc_overall_rating: stringOrNull(row.cqc_overall_rating),
    nhs_url: stringOrNull(row.nhs_url),
    website_url: stringOrNull(row.website_url),
    google_maps_url: stringOrNull(row.google_maps_url),
    management_company: stringOrNull(row.management_company),
    gtd: Boolean(row.gtd),
    source_dataset: "nhs_project_national_supplementals"
  };
}

function mergePracticeRows(existing, incoming) {
  const out = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || value === "") continue;
    if (out[key] === null || out[key] === undefined || out[key] === "") {
      out[key] = value;
      continue;
    }
    if (key === "source_dataset") {
      out[key] = `${out[key]},${value}`;
      continue;
    }
    if ((key === "google_score" || key === "google_count" || key === "survey_overall_good_percent" || key === "survey_completion_rate_percent" || key === "registered_patient_count") && numericOrNull(out[key]) === null) {
      out[key] = value;
    }
  }
  return out;
}

function mean(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return rounded(valid.reduce((sum, value) => sum + value, 0) / valid.length, 4);
}

function weightedMean(pairs) {
  const valid = pairs.filter(([value, weight]) => Number.isFinite(value) && Number.isFinite(weight) && weight > 0);
  if (!valid.length) return null;
  const numerator = valid.reduce((sum, [value, weight]) => sum + (value * weight), 0);
  const denominator = valid.reduce((sum, [, weight]) => sum + weight, 0);
  return denominator > 0 ? rounded(numerator / denominator, 4) : null;
}

const [gmCoreRaw, supplementalsJsRaw, wardsRaw, electionRaw] = await Promise.all([
  fs.readFile(GM_CORE_JSON_PATH, "utf8"),
  fs.readFile(NATIONAL_SUPPLEMENTALS_JS_PATH, "utf8"),
  fs.readFile(WARDS_GEOJSON_PATH, "utf8"),
  fs.readFile(ELECTION_STATE_PATH, "utf8")
]);

const gmCoreRows = JSON.parse(gmCoreRaw);
const supplementalsRows = parseWindowAssignment(supplementalsJsRaw, "NATIONAL_PRACTICE_SUPPLEMENTALS");
const wardsGeojson = JSON.parse(wardsRaw);
const electionState = JSON.parse(electionRaw);

const mergedByCode = new Map();
for (const rawRow of Array.isArray(supplementalsRows) ? supplementalsRows : []) {
  const row = normalizeSupplementalRow(rawRow);
  if (!row.practice_code) continue;
  const existing = mergedByCode.get(row.practice_code);
  mergedByCode.set(row.practice_code, existing ? mergePracticeRows(existing, row) : row);
}
for (const rawRow of Array.isArray(gmCoreRows) ? gmCoreRows : []) {
  const row = normalizeGmRow(rawRow);
  if (!row.practice_code) continue;
  const existing = mergedByCode.get(row.practice_code);
  mergedByCode.set(row.practice_code, existing ? mergePracticeRows(existing, row) : row);
}

const practices = Array.from(mergedByCode.values())
  .filter((row) => row.nation === "england" && Number.isFinite(row.lat) && Number.isFinite(row.lon))
  .sort((a, b) => String(a.practice_name || "").localeCompare(String(b.practice_name || ""), "en"));

const wardFeatures = Array.isArray(wardsGeojson?.features) ? wardsGeojson.features : [];
const electionWards = Array.isArray(electionState?.wards) ? electionState.wards : [];
const electionByWardCode = new Map(electionWards.map((row) => [String(row?.ward_code || ""), row]));

const wardGrid = new Map();
const wardEntries = wardFeatures.map((feature) => {
  const props = feature?.properties || {};
  const box = bbox(feature);
  const minX = Math.floor(box[0] / GRID_CELL_DEGREES);
  const maxX = Math.floor(box[2] / GRID_CELL_DEGREES);
  const minY = Math.floor(box[1] / GRID_CELL_DEGREES);
  const maxY = Math.floor(box[3] / GRID_CELL_DEGREES);
  const entry = {
    feature,
    bbox: box,
    ward_code: String(props.WD24CD || ""),
    ward_name: props.WD24NM || null,
    authority_code: props.LAD24CD || null,
    authority_name: props.LAD24NM || null
  };
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const key = `${x}:${y}`;
      const bucket = wardGrid.get(key) || [];
      bucket.push(entry);
      wardGrid.set(key, bucket);
    }
  }
  return entry;
});

for (const practice of practices) {
  const pointX = Math.floor(practice.lon / GRID_CELL_DEGREES);
  const pointY = Math.floor(practice.lat / GRID_CELL_DEGREES);
  const candidateEntries = wardGrid.get(`${pointX}:${pointY}`) || wardEntries;
  const pt = point([practice.lon, practice.lat]);
  let matchedWard = null;
  for (const candidate of candidateEntries) {
    if (!pointInBbox(practice.lon, practice.lat, candidate.bbox)) continue;
    if (booleanPointInPolygon(pt, candidate.feature)) {
      matchedWard = candidate;
      break;
    }
  }
  practice.ward_code = matchedWard?.ward_code || null;
  practice.ward_name = matchedWard?.ward_name || null;
  practice.authority_code = matchedWard?.authority_code || null;
  practice.authority_name = matchedWard?.authority_name || null;
}

const wardSummaryByCode = new Map();
for (const practice of practices) {
  const wardCode = String(practice.ward_code || "");
  if (!wardCode) continue;
  const existing = wardSummaryByCode.get(wardCode) || {
    ward_code: wardCode,
    ward_name: practice.ward_name || null,
    authority_code: practice.authority_code || null,
    authority_name: practice.authority_name || null,
    winner_party: electionByWardCode.get(wardCode)?.winner_party || null,
    winner_status: electionByWardCode.get(wardCode)?.winner_status || "pending",
    practices_count: 0,
    rated_practices_count: 0,
    google_scores: [],
    google_score_pairs: [],
    survey_scores: [],
    patients_total: 0
  };
  existing.practices_count += 1;
  const googleScore = numericOrNull(practice.google_score);
  if (googleScore !== null) {
    existing.rated_practices_count += 1;
    existing.google_scores.push(googleScore);
    existing.google_score_pairs.push([googleScore, numericOrNull(practice.registered_patient_count) || 0]);
  }
  const surveyScore = numericOrNull(practice.survey_overall_good_percent);
  if (surveyScore !== null) existing.survey_scores.push(surveyScore);
  existing.patients_total += numericOrNull(practice.registered_patient_count) || 0;
  wardSummaryByCode.set(wardCode, existing);
}

const wardSummaries = Array.from(wardSummaryByCode.values()).map((row) => ({
  ward_code: row.ward_code,
  ward_name: row.ward_name,
  authority_code: row.authority_code,
  authority_name: row.authority_name,
  winner_party: row.winner_party,
  winner_status: row.winner_status,
  practices_count: row.practices_count,
  rated_practices_count: row.rated_practices_count,
  avg_google_score: mean(row.google_scores),
  avg_google_score_weighted_by_patients: weightedMean(row.google_score_pairs),
  avg_survey_overall_good_percent: mean(row.survey_scores),
  patients_total: row.patients_total
}));

const wardsWonByParty = new Map();
for (const election of electionWards) {
  const party = String(election?.winner_party || "").trim();
  if (!party) continue;
  wardsWonByParty.set(party, (wardsWonByParty.get(party) || 0) + 1);
}

const partySummaryByName = new Map();
for (const practice of practices) {
  const wardCode = String(practice.ward_code || "");
  const winnerParty = wardCode ? (electionByWardCode.get(wardCode)?.winner_party || null) : null;
  if (!winnerParty) continue;
  const existing = partySummaryByName.get(winnerParty) || {
    party: winnerParty,
    wards_won: wardsWonByParty.get(winnerParty) || 0,
    wards_with_practices: new Set(),
    practices_count: 0,
    rated_practices_count: 0,
    google_scores: [],
    google_score_pairs: [],
    survey_scores: [],
    patients_total: 0
  };
  existing.practices_count += 1;
  if (wardCode) existing.wards_with_practices.add(wardCode);
  const googleScore = numericOrNull(practice.google_score);
  if (googleScore !== null) {
    existing.rated_practices_count += 1;
    existing.google_scores.push(googleScore);
    existing.google_score_pairs.push([googleScore, numericOrNull(practice.registered_patient_count) || 0]);
  }
  const surveyScore = numericOrNull(practice.survey_overall_good_percent);
  if (surveyScore !== null) existing.survey_scores.push(surveyScore);
  existing.patients_total += numericOrNull(practice.registered_patient_count) || 0;
  partySummaryByName.set(winnerParty, existing);
}

const partySummaries = Array.from(partySummaryByName.values())
  .map((row) => ({
    party: row.party,
    wards_won: row.wards_won,
    wards_with_practices: row.wards_with_practices.size,
    practices_count: row.practices_count,
    rated_practices_count: row.rated_practices_count,
    avg_google_score: mean(row.google_scores),
    avg_google_score_weighted_by_patients: weightedMean(row.google_score_pairs),
    avg_survey_overall_good_percent: mean(row.survey_scores),
    patients_total: row.patients_total
  }))
  .sort((a, b) => (b.rated_practices_count - a.rated_practices_count) || String(a.party).localeCompare(String(b.party), "en"));

const practicesPayload = {
  updated_at_utc: new Date().toISOString(),
  sources: {
    nhs_gm_core_json: GM_CORE_JSON_PATH,
    nhs_national_supplementals_js: NATIONAL_SUPPLEMENTALS_JS_PATH
  },
  summary: {
    practices_total: practices.length,
    practices_with_google_rating: practices.filter((row) => numericOrNull(row.google_score) !== null).length,
    practices_with_survey: practices.filter((row) => numericOrNull(row.survey_overall_good_percent) !== null).length,
    practices_with_ward_match: practices.filter((row) => row.ward_code).length
  },
  practices
};

const ratingSummaryPayload = {
  updated_at_utc: new Date().toISOString(),
  sources: {
    gp_practices: OUTPUT_PRACTICES_PATH,
    wards_geojson: WARDS_GEOJSON_PATH,
    ward_election_state: ELECTION_STATE_PATH
  },
  summary: {
    wards_total: wardFeatures.length,
    wards_with_declared_winner: electionWards.filter((row) => row?.winner_party).length,
    wards_with_practices: wardSummaries.length,
    parties_with_practice_ratings: partySummaries.length
  },
  parties: partySummaries,
  wards: wardSummaries
};

await fs.writeFile(OUTPUT_PRACTICES_PATH, JSON.stringify(practicesPayload, null, 2));
await fs.writeFile(OUTPUT_SUMMARY_PATH, JSON.stringify(ratingSummaryPayload, null, 2));

console.log(`Imported ${practicesPayload.summary.practices_total} England GP practices`);
console.log(`Matched ${practicesPayload.summary.practices_with_ward_match} practices to wards`);
