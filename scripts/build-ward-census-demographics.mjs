import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { area, bbox, booleanPointInPolygon, centroid, featureCollection, intersect } from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const WARDS_GEOJSON_PATH = path.resolve(projectRoot, "src/data/england-wards.geojson");
const ELECTION_STATE_PATH = path.resolve(projectRoot, "src/data/england-ward-election-state.json");
const DEPRIVATION_GEOJSON_PATH = path.resolve(projectRoot, "deprivation/output/england-lsoa-imd-2025.geojson");
const CENSUS_LSOA_SUMMARY_PATH = path.resolve(projectRoot, "src/data/england-census-lsoa-summary.json");
const OUTPUT_PATH = path.resolve(projectRoot, "src/data/ward-census-demographics.json");

const RAW_COUNT_FIELDS = [
  "ethnicity_total",
  "white_british",
  "country_of_birth_total",
  "uk_born",
  "national_identity_total",
  "british_only_identity",
  "english_only_identity",
  "english_and_british_only_identity",
  "english_or_british_only_identity",
  "religion_total",
  "christian",
  "no_religion",
  "muslim",
  "age_total",
  "age_50plus",
  "age_65plus",
  "tenure_total_households",
  "owner_occupied",
  "private_rented",
  "social_rented",
  "nssec_total_16plus",
  "nssec_managerial_professional",
  "nssec_working_class",
  "qualifications_total_16plus",
  "degree_level",
  "no_qualifications"
];

const FEATURE_IDS = [
  "white_british_pct",
  "uk_born_pct",
  "english_only_identity_pct",
  "english_or_british_only_identity_pct",
  "christian_pct",
  "no_religion_pct",
  "muslim_pct",
  "age_50plus_pct",
  "age_65plus_pct",
  "owner_occupied_pct",
  "private_rented_pct",
  "social_rented_pct",
  "nssec_managerial_professional_pct",
  "nssec_working_class_pct",
  "degree_pct",
  "no_qualifications_pct",
  "imd_score"
];

function rounded(value, dp = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(dp));
}

function bboxesOverlap(a, b) {
  return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
}

function emptyCounts() {
  return Object.fromEntries(RAW_COUNT_FIELDS.map((field) => [field, 0]));
}

function estimateOverlapArea(wardFeature, lsoaFeature) {
  try {
    const clipped = intersect(featureCollection([wardFeature, lsoaFeature]));
    return clipped ? area(clipped) : 0;
  } catch (_error) {
    const featureCentroid = centroid(lsoaFeature);
    if (booleanPointInPolygon(featureCentroid, wardFeature)) {
      return area(lsoaFeature);
    }
    return 0;
  }
}

function deriveFeaturesFromCounts(counts, imdScore) {
  const ethnicityTotal = Number(counts.ethnicity_total || 0);
  const countryOfBirthTotal = Number(counts.country_of_birth_total || 0);
  const identityTotal = Number(counts.national_identity_total || 0);
  const religionTotal = Number(counts.religion_total || 0);
  const ageTotal = Number(counts.age_total || 0);
  const tenureTotal = Number(counts.tenure_total_households || 0);
  const nssecTotal = Number(counts.nssec_total_16plus || 0);
  const qualificationsTotal = Number(counts.qualifications_total_16plus || 0);

  const pct = (value, total) => (total > 0 ? rounded(Number(value || 0) / total) : null);

  return {
    white_british_pct: pct(counts.white_british, ethnicityTotal),
    uk_born_pct: pct(counts.uk_born, countryOfBirthTotal),
    english_only_identity_pct: pct(counts.english_only_identity, identityTotal),
    english_or_british_only_identity_pct: pct(counts.english_or_british_only_identity, identityTotal),
    christian_pct: pct(counts.christian, religionTotal),
    no_religion_pct: pct(counts.no_religion, religionTotal),
    muslim_pct: pct(counts.muslim, religionTotal),
    age_50plus_pct: pct(counts.age_50plus, ageTotal),
    age_65plus_pct: pct(counts.age_65plus, ageTotal),
    owner_occupied_pct: pct(counts.owner_occupied, tenureTotal),
    private_rented_pct: pct(counts.private_rented, tenureTotal),
    social_rented_pct: pct(counts.social_rented, tenureTotal),
    nssec_managerial_professional_pct: pct(counts.nssec_managerial_professional, nssecTotal),
    nssec_working_class_pct: pct(counts.nssec_working_class, nssecTotal),
    degree_pct: pct(counts.degree_level, qualificationsTotal),
    no_qualifications_pct: pct(counts.no_qualifications, qualificationsTotal),
    imd_score: rounded(imdScore, 4)
  };
}

function mean(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return rounded(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function pearson(xs, ys) {
  const pairs = xs
    .map((x, index) => [Number(x), Number(ys[index])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = pairs.length;
  if (n < 3) return null;
  const sx = pairs.reduce((sum, [x]) => sum + x, 0);
  const sy = pairs.reduce((sum, [, y]) => sum + y, 0);
  const sxx = pairs.reduce((sum, [x]) => sum + (x * x), 0);
  const syy = pairs.reduce((sum, [, y]) => sum + (y * y), 0);
  const sxy = pairs.reduce((sum, [x, y]) => sum + (x * y), 0);
  const denominator = Math.sqrt((n * sxx - (sx * sx)) * (n * syy - (sy * sy)));
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return rounded((n * sxy - sx * sy) / denominator, 6);
}

const [wardsRaw, deprivationRaw, electionRaw, censusRaw] = await Promise.all([
  fs.readFile(WARDS_GEOJSON_PATH, "utf8"),
  fs.readFile(DEPRIVATION_GEOJSON_PATH, "utf8"),
  fs.readFile(ELECTION_STATE_PATH, "utf8"),
  fs.readFile(CENSUS_LSOA_SUMMARY_PATH, "utf8")
]);

const wardsGeojson = JSON.parse(wardsRaw);
const deprivationGeojson = JSON.parse(deprivationRaw);
const electionState = JSON.parse(electionRaw);
const censusSummary = JSON.parse(censusRaw);

const wardFeatures = Array.isArray(wardsGeojson?.features) ? wardsGeojson.features : [];
const deprivationFeatures = Array.isArray(deprivationGeojson?.features) ? deprivationGeojson.features : [];
const electionWards = Array.isArray(electionState?.wards) ? electionState.wards : [];
const censusRows = Array.isArray(censusSummary?.rows) ? censusSummary.rows : [];
const featureCatalog = Array.isArray(censusSummary?.feature_catalog) ? censusSummary.feature_catalog : [];

const electionByWardCode = new Map(electionWards.map((row) => [String(row?.ward_code || ""), row]));
const censusByLsoaCode = new Map(censusRows.map((row) => [String(row?.lsoa21cd || ""), row]));

const lsoaByAuthorityCode = new Map();
for (const feature of deprivationFeatures) {
  const props = feature?.properties || {};
  const lsoaCode = String(props.lsoa21cd || props.LSOA21CD || "");
  const censusRow = censusByLsoaCode.get(lsoaCode);
  if (!censusRow) continue;
  const authorityCode = String(props.lad24cd || props.LAD24CD || "");
  const entry = {
    feature,
    bbox: bbox(feature),
    area: area(feature),
    authorityCode,
    censusRow,
    imdScore: Number(props.imd_score || 0)
  };
  const existing = lsoaByAuthorityCode.get(authorityCode) || [];
  existing.push(entry);
  lsoaByAuthorityCode.set(authorityCode, existing);
}

const wardsOut = [];
let processed = 0;
for (const wardFeature of wardFeatures) {
  processed += 1;
  const props = wardFeature?.properties || {};
  const wardCode = String(props.WD24CD || "");
  const authorityCode = String(props.LAD24CD || "");
  const election = electionByWardCode.get(wardCode) || null;
  const candidates = (lsoaByAuthorityCode.get(authorityCode) || []).filter((candidate) => bboxesOverlap(bbox(wardFeature), candidate.bbox));
  const counts = emptyCounts();
  let weightedImdNumerator = 0;
  let weightedImdDenominator = 0;

  for (const candidate of candidates) {
    const overlapArea = estimateOverlapArea(wardFeature, candidate.feature);
    if (!(overlapArea > 0) || !(candidate.area > 0)) continue;
    const ratio = overlapArea / candidate.area;
    for (const field of RAW_COUNT_FIELDS) {
      counts[field] += Number(candidate.censusRow[field] || 0) * ratio;
    }
    weightedImdNumerator += Number(candidate.imdScore || 0) * overlapArea;
    weightedImdDenominator += overlapArea;
  }

  const derived = deriveFeaturesFromCounts(
    counts,
    weightedImdDenominator > 0 ? weightedImdNumerator / weightedImdDenominator : null
  );

  wardsOut.push({
    ward_code: wardCode,
    ward_name: props.WD24NM || null,
    authority_code: authorityCode,
    authority_name: props.LAD24NM || null,
    winner_party: election?.winner_party || null,
    winner_status: election?.winner_status || "pending",
    ...Object.fromEntries(RAW_COUNT_FIELDS.map((field) => [field, rounded(counts[field], 3)])),
    ...derived
  });

  if (processed % 25 === 0 || processed === wardFeatures.length) {
    console.log(`Ward census demographics progress: ${processed}/${wardFeatures.length}`);
  }
}

const declaredWards = wardsOut.filter((ward) => ward.winner_party);
const partyNames = [...new Set(declaredWards.map((ward) => ward.winner_party))].sort((a, b) => {
  const countA = declaredWards.filter((ward) => ward.winner_party === a).length;
  const countB = declaredWards.filter((ward) => ward.winner_party === b).length;
  return countB - countA;
});

const parties = partyNames.map((party) => {
  const partyWards = declaredWards.filter((ward) => ward.winner_party === party);
  const means = Object.fromEntries(
    FEATURE_IDS.map((featureId) => [featureId, mean(partyWards.map((ward) => ward[featureId]))])
  );
  return {
    party,
    wards_won: partyWards.length,
    means
  };
});

const allMeans = Object.fromEntries(
  FEATURE_IDS.map((featureId) => [featureId, mean(declaredWards.map((ward) => ward[featureId]))])
);

const reformParty = parties.find((party) => party.party === "Reform UK") || null;
const reformProfile = reformParty
  ? {
      party: reformParty.party,
      wards_won: reformParty.wards_won,
      deltas: featureCatalog
        .filter((feature) => FEATURE_IDS.includes(feature.id))
        .map((feature) => ({
          feature_id: feature.id,
          label: feature.label,
          reform_mean: reformParty.means[feature.id],
          all_declared_mean: allMeans[feature.id],
          difference: rounded((reformParty.means[feature.id] ?? 0) - (allMeans[feature.id] ?? 0), 6)
        }))
        .filter((row) => Number.isFinite(row.reform_mean) && Number.isFinite(row.all_declared_mean))
        .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
    }
  : null;

const correlations = partyNames
  .map((party) => {
    const binary = declaredWards.map((ward) => (ward.winner_party === party ? 1 : 0));
    const rows = featureCatalog
      .filter((feature) => FEATURE_IDS.includes(feature.id))
      .map((feature) => ({
        feature_id: feature.id,
        label: feature.label,
        correlation: pearson(declaredWards.map((ward) => ward[feature.id]), binary)
      }))
      .filter((row) => Number.isFinite(row.correlation))
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
      .slice(0, 8);
    return {
      party,
      wards_won: declaredWards.filter((ward) => ward.winner_party === party).length,
      strongest_signals: rows
    };
  })
  .filter((row) => row.wards_won >= 15);

const output = {
  updated_at_utc: new Date().toISOString(),
  sources: {
    wards_geojson: WARDS_GEOJSON_PATH,
    deprivation_geojson: DEPRIVATION_GEOJSON_PATH,
    ward_election_state: ELECTION_STATE_PATH,
    census_lsoa_summary: CENSUS_LSOA_SUMMARY_PATH
  },
  summary: {
    wards_total: wardsOut.length,
    wards_with_declared_winner: declaredWards.length,
    wards_with_census: wardsOut.filter((ward) => Number.isFinite(ward.white_british_pct)).length,
    lsoas_with_census: censusRows.length
  },
  feature_catalog: featureCatalog.filter((feature) => FEATURE_IDS.includes(feature.id) || feature.id === "imd_score"),
  parties,
  reform_profile: reformProfile,
  correlations,
  wards: wardsOut
};

await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
console.log(`Updated ward census demographics: ${output.summary.wards_total} wards`);
