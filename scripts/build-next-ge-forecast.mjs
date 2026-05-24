import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  area,
  bbox,
  featureCollection,
  intersect
} from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const WARDS_GEOJSON_PATH = path.resolve(projectRoot, "src/data/england-wards.geojson");
const WARD_CENSUS_PATH = path.resolve(projectRoot, "src/data/ward-census-demographics.json");
const WARD_DEPRIVATION_PATH = path.resolve(projectRoot, "src/data/ward-deprivation-vote-index.json");
const WARD_ELECTION_STATE_PATH = path.resolve(projectRoot, "src/data/england-ward-election-state.json");
const CONSTITUENCY_GEOJSON_PATH = path.resolve(projectRoot, "forecast/cache/england-constituencies.geojson");
const OUTPUT_PATH = path.resolve(projectRoot, "src/data/next-ge-forecast.json");

const CONSTITUENCY_SERVICE_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC/FeatureServer/0/query?where=PCON24CD%20LIKE%20%27E%25%27&outFields=PCON24CD,PCON24NM&returnGeometry=true&outSR=4326&geometryPrecision=4&f=geojson";
const CURRENT_MEMBER_SEARCH_URL =
  "https://members-api.parliament.uk/api/Members/Search?House=Commons";
const CURRENT_CONSTITUENCY_OVERRIDES = new Map([
  [
    "makerfield",
    {
      current_member_id: 5060,
      current_member_name: "Josh Simons",
      current_party: "Labour"
    }
  ]
]);

const FORECAST_PARTIES = [
  "Labour",
  "Conservative",
  "Reform UK",
  "Liberal Democrats",
  "Green Party",
  "Independent"
];

const PARTY_ALIASES = new Map([
  ["labour", "Labour"],
  ["labour and co-operative", "Labour"],
  ["labour and cooperative", "Labour"],
  ["labour and co operative", "Labour"],
  ["labour co-operative", "Labour"],
  ["labour cooperative", "Labour"],
  ["labour co operative", "Labour"],
  ["conservative", "Conservative"],
  ["conservative and unionist", "Conservative"],
  ["conservative and unionist party", "Conservative"],
  ["reform uk", "Reform UK"],
  ["reform", "Reform UK"],
  ["liberal democrat", "Liberal Democrats"],
  ["liberal democrats", "Liberal Democrats"],
  ["lib dem", "Liberal Democrats"],
  ["lib dems", "Liberal Democrats"],
  ["green party", "Green Party"],
  ["green", "Green Party"],
  ["independent", "Independent"]
]);

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

function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePartyName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeConstituencyName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bconstituency\b/g, "")
    .replace(/\bward\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalPartyName(value) {
  const normalized = normalizePartyName(value);
  return PARTY_ALIASES.get(normalized) || String(value || "").trim() || "Other";
}

function mean(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function stddev(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (numeric.length < 2) return 1;
  const avg = mean(numeric);
  const variance = numeric.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / numeric.length;
  return Math.sqrt(variance) || 1;
}

function softmax(scoreByParty, temperature = 1) {
  const entries = Object.entries(scoreByParty);
  const maxScore = Math.max(...entries.map(([, score]) => score));
  const numerators = entries.map(([party, score]) => [
    party,
    Math.exp((score - maxScore) / Math.max(temperature, 0.0001))
  ]);
  const total = numerators.reduce((sum, [, value]) => sum + value, 0) || 1;
  return Object.fromEntries(numerators.map(([party, value]) => [party, value / total]));
}

function estimateOverlapArea(leftFeature, rightFeature) {
  try {
    const clipped = intersect(featureCollection([leftFeature, rightFeature]));
    return clipped ? area(clipped) : 0;
  } catch (_error) {
    return 0;
  }
}

function buildFeatureStats(rows) {
  const stats = {};
  for (const featureId of FEATURE_IDS) {
    const values = rows.map((row) => safeNumber(row[featureId], null)).filter((value) => Number.isFinite(value));
    stats[featureId] = {
      mean: mean(values),
      stddev: stddev(values)
    };
  }
  return stats;
}

function flattenWardSignals(censusRow, deprivationRow, electionRow) {
  const row = {};
  for (const featureId of FEATURE_IDS) {
    if (featureId === "imd_score") {
      row.imd_score = safeNumber(censusRow?.imd_score ?? deprivationRow?.deprivation_weighted_mean_decile, null);
      continue;
    }
    row[featureId] = safeNumber(censusRow?.[featureId], null);
  }

  return {
    ...row,
    ward_code: censusRow?.ward_code || deprivationRow?.ward_code || electionRow?.ward_code || null,
    ward_name: censusRow?.ward_name || deprivationRow?.ward_name || electionRow?.ward_name || null,
    authority_code: censusRow?.authority_code || deprivationRow?.authority_code || electionRow?.authority_code || null,
    authority_name: censusRow?.authority_name || deprivationRow?.authority_name || electionRow?.authority_name || null,
    current_winner_party: canonicalPartyName(censusRow?.winner_party || deprivationRow?.winner_party || electionRow?.winner_party || null),
    incumbent_party: canonicalPartyName(electionRow?.incumbent_party || null),
    turnout_change_pct_points: safeNumber(electionRow?.turnout_change_pct_points, null),
    vote_count_change_relative_to_mean: safeNumber(electionRow?.vote_count_change_relative_to_mean, null),
    ward_deprivation_mean_decile: safeNumber(deprivationRow?.deprivation_weighted_mean_decile, null),
    deprivation_dominant_decile: safeNumber(deprivationRow?.deprivation_dominant_decile, null)
  };
}

function buildPartyProfiles(censusData, deprivationData) {
  const censusParties = new Map(
    Array.isArray(censusData?.parties)
      ? censusData.parties.map((row) => [canonicalPartyName(row?.party), row])
      : []
  );
  const deprivationParties = new Map(
    Array.isArray(deprivationData?.parties)
      ? deprivationData.parties.map((row) => [canonicalPartyName(row?.party), row])
      : []
  );
  const correlationByParty = new Map(
    Array.isArray(censusData?.correlations)
      ? censusData.correlations.map((row) => [canonicalPartyName(row?.party), row])
      : []
  );

  return FORECAST_PARTIES.map((party) => {
    const censusProfile = censusParties.get(party) || null;
    const deprivationProfile = deprivationParties.get(party) || null;
    const correlationProfile = correlationByParty.get(party) || null;
    const featureWeights = {};

    for (const item of Array.isArray(correlationProfile?.strongest_signals) ? correlationProfile.strongest_signals : []) {
      featureWeights[item.feature_id] = safeNumber(item.correlation, 0) || 0;
    }

    return {
      party,
      wards_won: Number(censusProfile?.wards_won || deprivationProfile?.wards_won || 0),
      deprivation_mean_decile: safeNumber(deprivationProfile?.deprivation_weighted_mean_decile, null),
      feature_weights: featureWeights
    };
  });
}

function scoreWard(wardRow, partyProfiles, featureStats, volatility = 0) {
  const scores = {};
  const currentWinner = canonicalPartyName(wardRow.current_winner_party);
  const incumbent = canonicalPartyName(wardRow.incumbent_party);
  const wardDecile = safeNumber(wardRow.ward_deprivation_mean_decile, null);

  for (const profile of partyProfiles) {
    let score = 0;
    let featureCount = 0;

    for (const featureId of FEATURE_IDS) {
      const value = safeNumber(wardRow[featureId], null);
      const weight = safeNumber(profile.feature_weights?.[featureId], 0) || 0;
      const stat = featureStats[featureId];
      if (!Number.isFinite(value) || !Number.isFinite(weight) || !(stat?.stddev > 0)) continue;
      score += ((value - stat.mean) / stat.stddev) * weight;
      featureCount += 1;
    }

    if (Number.isFinite(wardDecile) && Number.isFinite(profile.deprivation_mean_decile)) {
      score += -Math.abs(wardDecile - profile.deprivation_mean_decile) / 3.75;
    }

    if (currentWinner === profile.party) score += 0.28;
    if (incumbent === profile.party) score += 0.12;
    score += Math.log1p(Math.max(0, profile.wards_won || 0)) * 0.04;
    score -= Math.min(0.4, Math.abs(volatility) / 25);

    scores[profile.party] = score / Math.max(1, featureCount);
  }

  const probabilities = softmax(scores, 0.85);
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const winner = ranked[0]?.[0] || null;
  const runnerUp = ranked[1]?.[0] || null;
  return {
    scores,
    probabilities,
    winner,
    runner_up: runnerUp,
    winner_probability: rounded(ranked[0]?.[1] || 0, 4),
    runner_up_probability: rounded(ranked[1]?.[1] || 0, 4),
    confidence: rounded(Math.max(0, (ranked[0]?.[1] || 0) - (ranked[1]?.[1] || 0)), 4)
  };
}

function rankContributions(wardRow, partyProfile, featureStats) {
  const contributions = [];
  for (const featureId of FEATURE_IDS) {
    const value = safeNumber(wardRow[featureId], null);
    const weight = safeNumber(partyProfile.feature_weights?.[featureId], 0) || 0;
    const stat = featureStats[featureId];
    if (!Number.isFinite(value) || !Number.isFinite(weight) || !(stat?.stddev > 0)) continue;
    const contribution = ((value - stat.mean) / stat.stddev) * weight;
    if (!Number.isFinite(contribution) || contribution === 0) continue;
    contributions.push({
      feature_id: featureId,
      value: rounded(value, 4),
      contribution: rounded(contribution, 4)
    });
  }
  return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 4);
}

function buildConstituencyForecast(accumulator, currentParty, partyProfiles, featureStats) {
  const totalWeight = accumulator.totalWeight || 0;
  const features = Object.fromEntries(
    FEATURE_IDS.map((featureId) => [
      featureId,
      totalWeight > 0 ? accumulator.totals[featureId] / totalWeight : null
    ])
  );
  const wardDeprivationMean = totalWeight > 0 ? accumulator.deprivationWeightedTotal / totalWeight : null;
  const signalRow = {
    ...features,
    current_winner_party: currentParty,
    incumbent_party: currentParty,
    ward_deprivation_mean_decile: wardDeprivationMean
  };

  const constituencyForecast = scoreWard(signalRow, partyProfiles, featureStats, 0);

  const combinedProbabilities = {};
  for (const party of FORECAST_PARTIES) {
    const featureProbability = safeNumber(constituencyForecast.probabilities?.[party], 0) || 0;
    const wardProbability = totalWeight > 0 ? accumulator.wardProbabilityTotals[party] / totalWeight : 0;
    combinedProbabilities[party] = (featureProbability * 0.7) + (wardProbability * 0.3);
  }

  const normalizer = Object.values(combinedProbabilities).reduce((sum, value) => sum + value, 0) || 1;
  for (const party of FORECAST_PARTIES) {
    combinedProbabilities[party] /= normalizer;
  }

  const ranked = Object.entries(combinedProbabilities).sort((a, b) => b[1] - a[1]);
  const winner = ranked[0]?.[0] || null;
  const runnerUp = ranked[1]?.[0] || null;
  const winnerProfile = partyProfiles.find((profile) => profile.party === winner) || partyProfiles[0];

  return {
    score_by_party: Object.fromEntries(
      FORECAST_PARTIES.map((party) => [party, rounded(combinedProbabilities[party], 6)])
    ),
    winner,
    runner_up: runnerUp,
    winner_probability: rounded(ranked[0]?.[1] || 0, 4),
    runner_up_probability: rounded(ranked[1]?.[1] || 0, 4),
    confidence: rounded(Math.max(0, (ranked[0]?.[1] || 0) - (ranked[1]?.[1] || 0)), 4),
    ward_winner_tally: Object.fromEntries(
      FORECAST_PARTIES.map((party) => [party, rounded(accumulator.wardWinnerTallies[party] || 0, 3)])
    ),
    top_signals: rankContributions(signalRow, winnerProfile, featureStats)
  };
}

async function fetchConstituencyGeojson() {
  const response = await fetch(CONSTITUENCY_SERVICE_URL);
  if (!response.ok) {
    throw new Error(`Constituency boundary request failed: ${response.status}`);
  }
  return response.json();
}

async function fetchAllCurrentConstituencies() {
  const items = [];
  let skip = 0;
  const take = 200;
  let totalResults = Infinity;

  while (skip < totalResults) {
    const url = `${CURRENT_MEMBER_SEARCH_URL}&skip=${skip}&take=${take}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Constituency state request failed: ${response.status}`);
    }
    const payload = await response.json();
    const pageItems = Array.isArray(payload?.items) ? payload.items : [];
    items.push(...pageItems);
    totalResults = Number(payload?.totalResults || items.length);
    skip += pageItems.length || take;
    console.log(`Loaded current constituency page: ${items.length}/${totalResults}`);
    if (!pageItems.length) break;
  }

  return items
    .map((item) => {
      const member = item?.value || {};
      const houseMembership = member?.latestHouseMembership || {};
      const constituencyName = houseMembership?.membershipFrom || null;
      const rawParty = member?.latestParty?.name || null;
      const isCurrentCommonsMember =
        Boolean(houseMembership?.membershipStatus?.statusIsActive) && houseMembership?.house === 1;

      if (!isCurrentCommonsMember || !constituencyName) {
        return null;
      }

      return {
        constituency_id: houseMembership?.membershipFromId || null,
        constituency_name: constituencyName,
        constituency_key: normalizeConstituencyName(constituencyName),
        current_member_id: member?.id || null,
        current_member_name: member?.nameDisplayAs || member?.nameFullTitle || null,
        current_party: canonicalPartyName(rawParty),
        current_party_label: rawParty
      };
    })
    .filter((row) => row && row.constituency_name);
}

const [wardsRaw, censusRaw, deprivationRaw, electionRaw, constituencyGeojsonRaw, currentConstituenciesRaw] = await Promise.all([
  fs.readFile(WARDS_GEOJSON_PATH, "utf8"),
  fs.readFile(WARD_CENSUS_PATH, "utf8"),
  fs.readFile(WARD_DEPRIVATION_PATH, "utf8"),
  fs.readFile(WARD_ELECTION_STATE_PATH, "utf8"),
  fetchConstituencyGeojson(),
  fetchAllCurrentConstituencies()
]);

const wardsGeojson = JSON.parse(wardsRaw);
const censusData = JSON.parse(censusRaw);
const deprivationData = JSON.parse(deprivationRaw);
const electionData = JSON.parse(electionRaw);

const wardFeatures = Array.isArray(wardsGeojson?.features) ? wardsGeojson.features : [];
const constituencyFeaturesRaw = Array.isArray(constituencyGeojsonRaw?.features) ? constituencyGeojsonRaw.features : [];
const censusRows = Array.isArray(censusData?.wards) ? censusData.wards : [];
const deprivationRows = Array.isArray(deprivationData?.wards) ? deprivationData.wards : [];
const electionRows = Array.isArray(electionData?.wards) ? electionData.wards : [];

const censusByWardCode = new Map(censusRows.map((row) => [String(row?.ward_code || ""), row]));
const deprivationByWardCode = new Map(deprivationRows.map((row) => [String(row?.ward_code || ""), row]));
const electionByWardCode = new Map(electionRows.map((row) => [String(row?.ward_code || ""), row]));

const wardSignals = [];
const wardSignalByCode = new Map();
for (const feature of wardFeatures) {
  const props = feature?.properties || {};
  const wardCode = String(props.WD24CD || "");
  if (!wardCode) continue;
  const signal = flattenWardSignals(
    censusByWardCode.get(wardCode),
    deprivationByWardCode.get(wardCode),
    electionByWardCode.get(wardCode)
  );
  wardSignals.push(signal);
  wardSignalByCode.set(wardCode, signal);
}

const featureStats = buildFeatureStats(wardSignals);
const partyProfiles = buildPartyProfiles(censusData, deprivationData);

const wardForecastRows = [];
const forecastByWardCode = new Map();

for (const wardRow of wardSignals) {
  const volatility = safeNumber(wardRow.turnout_change_pct_points, 0) || 0;
  const forecast = scoreWard(wardRow, partyProfiles, featureStats, volatility);
  const topProfile = partyProfiles.find((profile) => profile.party === forecast.winner) || partyProfiles[0];
  const topSignals = rankContributions(wardRow, topProfile, featureStats);
  const row = {
    ward_code: wardRow.ward_code,
    ward_name: wardRow.ward_name,
    authority_code: wardRow.authority_code,
    authority_name: wardRow.authority_name,
    current_winner_party: wardRow.current_winner_party,
    incumbent_party: wardRow.incumbent_party,
    ward_deprivation_mean_decile: rounded(wardRow.ward_deprivation_mean_decile, 3),
    turnout_change_pct_points: rounded(wardRow.turnout_change_pct_points, 3),
    vote_count_change_relative_to_mean: rounded(wardRow.vote_count_change_relative_to_mean, 3),
    score_by_party: Object.fromEntries(
      FORECAST_PARTIES.map((party) => [party, rounded(forecast.probabilities[party] || 0, 6)])
    ),
    winner: forecast.winner,
    runner_up: forecast.runner_up,
    winner_probability: forecast.winner_probability,
    runner_up_probability: forecast.runner_up_probability,
    confidence: forecast.confidence,
    top_signals: topSignals
  };
  wardForecastRows.push(row);
  forecastByWardCode.set(row.ward_code, {
    probabilities: forecast.probabilities,
    winner: forecast.winner
  });
}

const constituencyFeatures = constituencyFeaturesRaw
  .filter((feature) => String(feature?.properties?.PCON24CD || "").startsWith("E"))
  .map((feature) => ({
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      constituency_code: String(feature?.properties?.PCON24CD || ""),
      constituency_name: String(feature?.properties?.PCON24NM || "")
    },
    __bbox: bbox(feature)
  }))
  .filter((feature) => feature.properties.constituency_code);

const currentConstituencyByName = new Map(
  currentConstituenciesRaw.map((row) => [row.constituency_key, row])
);

const constituencyAccumulators = new Map(
  constituencyFeatures.map((feature) => [
    feature.properties.constituency_code,
    {
      constituency_code: feature.properties.constituency_code,
      constituency_name: feature.properties.constituency_name,
      ward_codes: new Set(),
      totals: Object.fromEntries(FEATURE_IDS.map((featureId) => [featureId, 0])),
      totalWeight: 0,
      deprivationWeightedTotal: 0,
      wardProbabilityTotals: Object.fromEntries(FORECAST_PARTIES.map((party) => [party, 0])),
      wardWinnerTallies: Object.fromEntries(FORECAST_PARTIES.map((party) => [party, 0]))
    }
  ])
);

let processedWardOverlapCount = 0;
for (const wardFeature of wardFeatures) {
  const wardCode = String(wardFeature?.properties?.WD24CD || "");
  const wardRow = wardSignalByCode.get(wardCode);
  const wardForecast = forecastByWardCode.get(wardCode);
  if (!wardRow || !wardForecast) continue;

  const wardArea = area(wardFeature);
  if (!(wardArea > 0)) continue;

  const wardBbox = bbox(wardFeature);
  const overlappingConstituencies = constituencyFeatures.filter((feature) => {
    const bb = feature.__bbox;
    return !(wardBbox[0] > bb[2] || wardBbox[2] < bb[0] || wardBbox[1] > bb[3] || wardBbox[3] < bb[1]);
  });

  const overlaps = [];
  for (const constituencyFeature of overlappingConstituencies) {
    const overlapArea = estimateOverlapArea(wardFeature, constituencyFeature);
    if (overlapArea > 0) overlaps.push({ feature: constituencyFeature, overlapArea });
  }

  const totalOverlapArea = overlaps.reduce((sum, item) => sum + item.overlapArea, 0);
  if (!(totalOverlapArea > 0)) continue;

  const baseWeight = Math.max(1, safeNumber(wardRow.age_total ?? wardRow.ethnicity_total ?? 1, 1) || 1);
  for (const { feature, overlapArea } of overlaps) {
    const share = overlapArea / totalOverlapArea;
    const contributionWeight = share * baseWeight;
    const accumulator = constituencyAccumulators.get(feature.properties.constituency_code);
    if (!accumulator) continue;
    accumulator.ward_codes.add(wardCode);
    accumulator.totalWeight += contributionWeight;
    for (const featureId of FEATURE_IDS) {
      const value = safeNumber(wardRow[featureId], null);
      if (!Number.isFinite(value)) continue;
      accumulator.totals[featureId] += value * contributionWeight;
    }
    if (Number.isFinite(wardRow.ward_deprivation_mean_decile)) {
      accumulator.deprivationWeightedTotal += wardRow.ward_deprivation_mean_decile * contributionWeight;
    }
    for (const party of FORECAST_PARTIES) {
      accumulator.wardProbabilityTotals[party] += (safeNumber(wardForecast.probabilities?.[party], 0) || 0) * contributionWeight;
    }
    if (wardForecast.winner && accumulator.wardWinnerTallies[wardForecast.winner] !== undefined) {
      accumulator.wardWinnerTallies[wardForecast.winner] += contributionWeight;
    }
  }
  processedWardOverlapCount += 1;
  if (processedWardOverlapCount % 250 === 0 || processedWardOverlapCount === wardFeatures.length) {
    console.log(`Ward overlap progress: ${processedWardOverlapCount}/${wardFeatures.length}`);
  }
}

const constituencyRows = [];
const currentConstituencyStates = [];
let processedConstituencyCount = 0;
for (const feature of constituencyFeatures) {
  const constituencyCode = feature.properties.constituency_code;
  const currentState = currentConstituencyByName.get(normalizeConstituencyName(feature.properties.constituency_name))
    || CURRENT_CONSTITUENCY_OVERRIDES.get(normalizeConstituencyName(feature.properties.constituency_name))
    || null;
  const accumulator = constituencyAccumulators.get(constituencyCode);
  const wardCodes = accumulator ? [...accumulator.ward_codes] : [];
  const forecast = buildConstituencyForecast(accumulator || {
    totals: Object.fromEntries(FEATURE_IDS.map((featureId) => [featureId, 0])),
    totalWeight: 0,
    deprivationWeightedTotal: 0,
    wardProbabilityTotals: Object.fromEntries(FORECAST_PARTIES.map((party) => [party, 0])),
    wardWinnerTallies: Object.fromEntries(FORECAST_PARTIES.map((party) => [party, 0]))
  }, currentState?.current_party || null, partyProfiles, featureStats);
  const seatStatus = currentState?.current_party && forecast.winner
    ? (currentState.current_party === forecast.winner ? "hold" : "change")
    : "unknown";

  currentConstituencyStates.push({
    constituency_code: constituencyCode,
    constituency_name: feature.properties.constituency_name,
    current_member_id: currentState?.current_member_id || null,
    current_member_name: currentState?.current_member_name || null,
    current_party: currentState?.current_party || null,
    current_party_label: currentState?.current_party_label || null,
    forecast_party: forecast.winner || null,
    seat_status: seatStatus
  });
  constituencyRows.push({
    constituency_code: constituencyCode,
    constituency_name: feature.properties.constituency_name,
    ward_codes: wardCodes,
    ward_count: wardCodes.length,
    current_member_id: currentState?.current_member_id || null,
    current_member_name: currentState?.current_member_name || null,
    current_party: currentState?.current_party || null,
    current_party_label: currentState?.current_party_label || null,
    seat_status: seatStatus,
    forecast
  });
  processedConstituencyCount += 1;
  if (processedConstituencyCount % 50 === 0 || processedConstituencyCount === constituencyFeatures.length) {
    console.log(`Constituency forecast progress: ${processedConstituencyCount}/${constituencyFeatures.length}`);
  }
}

const partySeatTotals = Object.fromEntries(FORECAST_PARTIES.map((party) => [party, 0]));
let holdSeatTotal = 0;
let changeSeatTotal = 0;
for (const row of constituencyRows) {
  if (partySeatTotals[row.forecast.winner] !== undefined) {
    partySeatTotals[row.forecast.winner] += 1;
  }
  if (row.seat_status === "hold") holdSeatTotal += 1;
  if (row.seat_status === "change") changeSeatTotal += 1;
}

const wardHighlights = [...wardForecastRows].sort((a, b) => a.confidence - b.confidence).slice(0, 80);
const constituencyHighlights = [...constituencyRows].sort((a, b) => a.forecast.confidence - b.forecast.confidence).slice(0, 80);

const output = {
  updated_at_utc: new Date().toISOString(),
  target_election: "Next UK general election",
  assumptions: [
    "Uses current ward census, deprivation, and local election signals.",
    "Assigns wards to constituencies using official ONS Westminster Parliamentary Constituency boundaries.",
    "Treats the result as a heuristic projection, not a polling model."
  ],
  sources: {
    wards_geojson: WARDS_GEOJSON_PATH,
    ward_census_demographics: WARD_CENSUS_PATH,
    ward_deprivation_vote_index: WARD_DEPRIVATION_PATH,
    ward_election_state: WARD_ELECTION_STATE_PATH,
    constituency_boundaries: CONSTITUENCY_SERVICE_URL
  },
  summary: {
    wards_total: wardForecastRows.length,
    constituencies_total: constituencyRows.length,
    wards_with_predictions: wardForecastRows.length,
    constituencies_with_predictions: constituencyRows.length,
    constituency_holds: holdSeatTotal,
    constituency_changes: changeSeatTotal,
    constituency_unknown: constituencyRows.length - holdSeatTotal - changeSeatTotal
  },
  parties: partyProfiles.map((profile) => ({
    party: profile.party,
    wards_won: profile.wards_won
  })),
  party_seat_totals: partySeatTotals,
  feature_stats: Object.fromEntries(
    FEATURE_IDS.map((featureId) => [
      featureId,
      {
        mean: rounded(featureStats[featureId].mean, 6),
        stddev: rounded(featureStats[featureId].stddev, 6)
      }
    ])
  ),
  ward_highlights: wardHighlights,
  constituency_highlights: constituencyHighlights,
  current_constituency_states: currentConstituencyStates,
  ward_forecasts: wardForecastRows,
  constituency_forecasts: constituencyRows
};

await fs.writeFile(
  CONSTITUENCY_GEOJSON_PATH,
  JSON.stringify({
    type: "FeatureCollection",
    features: constituencyFeatures.map((feature) => ({
      type: "Feature",
      geometry: feature.geometry,
      properties: feature.properties
    }))
  }, null, 2)
);

await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
console.log(`Updated next-ge forecast: ${output.summary.constituencies_total} constituencies, ${output.summary.wards_total} wards`);
