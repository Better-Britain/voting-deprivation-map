import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const FORECAST_PATH = path.resolve(projectRoot, "src/data/next-ge-forecast.json");
const CENSUS_PATH = path.resolve(projectRoot, "src/data/ward-census-demographics.json");
const DEPRIVATION_PATH = path.resolve(projectRoot, "src/data/ward-deprivation-vote-index.json");
const ELECTION_PATH = path.resolve(projectRoot, "src/data/england-ward-election-state.json");
const COUNCILS_PATH = path.resolve(projectRoot, "src/data/england-councils.geojson");
const OUTPUT_PATH = path.resolve(projectRoot, "src/data/spotlight-focus.json");

const FORECAST_PARTIES = [
  "Labour",
  "Conservative",
  "Reform UK",
  "Liberal Democrats",
  "Green Party",
  "Independent"
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

const GM_AUTHORITIES = new Set([
  "Bolton",
  "Bury",
  "Manchester",
  "Oldham",
  "Rochdale",
  "Salford",
  "Stockport",
  "Tameside",
  "Trafford",
  "Wigan"
]);

function rounded(value, dp = 6) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(dp));
}

function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePartyName(value) {
  return String(value || "").trim().toLowerCase();
}

function canonicalPartyName(value) {
  const normalized = normalizePartyName(value);
  if (
    normalized === "labour" ||
    normalized === "labour and co-operative" ||
    normalized === "labour and cooperative party" ||
    normalized === "labour and cooperative" ||
    normalized === "labour and co operative party" ||
    normalized === "labour and co operative" ||
    normalized === "labour co-operative" ||
    normalized === "labour cooperative" ||
    normalized === "labour co operative"
  ) return "Labour";
  if (normalized === "conservative" || normalized === "conservative and unionist" || normalized === "conservative and unionist party") return "Conservative";
  if (normalized === "reform uk" || normalized === "reform") return "Reform UK";
  if (normalized === "liberal democrat" || normalized === "liberal democrats" || normalized === "lib dem" || normalized === "lib dems") return "Liberal Democrats";
  if (normalized === "green party" || normalized === "green") return "Green Party";
  if (normalized === "independent") return "Independent";
  return String(value || "").trim() || "Other";
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
    age_total: safeNumber(censusRow?.age_total, null),
    ethnicity_total: safeNumber(censusRow?.ethnicity_total, null),
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
  return {
    scores,
    probabilities,
    winner: ranked[0]?.[0] || null,
    runner_up: ranked[1]?.[0] || null,
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

function buildAggregateForecast(accumulator, currentParty, partyProfiles, featureStats) {
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
  const score = scoreWard(signalRow, partyProfiles, featureStats, 0);
  const combinedProbabilities = {};
  for (const party of FORECAST_PARTIES) {
    const featureProbability = safeNumber(score.probabilities?.[party], 0) || 0;
    const wardProbability = totalWeight > 0 ? accumulator.wardProbabilityTotals[party] / totalWeight : 0;
    combinedProbabilities[party] = (featureProbability * 0.7) + (wardProbability * 0.3);
  }
  const normalizer = Object.values(combinedProbabilities).reduce((sum, value) => sum + value, 0) || 1;
  for (const party of FORECAST_PARTIES) combinedProbabilities[party] /= normalizer;

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

function reduceWardForecastRow(row) {
  return {
    ward_code: row.ward_code,
    ward_name: row.ward_name,
    authority_name: row.authority_name,
    current_winner_party: row.current_winner_party,
    incumbent_party: row.incumbent_party,
    forecast_party: row.winner,
    runner_up: row.runner_up,
    gap: row.confidence,
    top_signals: row.top_signals
  };
}

function reduceCouncilRow(feature) {
  const props = feature?.properties || {};
  return {
    council_name: String(props.council_name || props.LAD24NM || "").trim(),
    council_code: String(props.LAD24CD || "").trim(),
    control_party: String(props.council_control_party || "Unknown").trim(),
    control_basis: String(props.council_control_basis || "").trim(),
    seat_total: safeNumber(props.council_seat_total, null),
    majority_threshold: safeNumber(props.council_control_majority_threshold, null),
    party_seats_summary: String(props.council_party_seats_summary || "").trim()
  };
}

const [forecastRaw, censusRaw, deprivationRaw, electionRaw, councilsRaw] = await Promise.all([
  fs.readFile(FORECAST_PATH, "utf8"),
  fs.readFile(CENSUS_PATH, "utf8"),
  fs.readFile(DEPRIVATION_PATH, "utf8"),
  fs.readFile(ELECTION_PATH, "utf8"),
  fs.readFile(COUNCILS_PATH, "utf8")
]);

const forecastData = JSON.parse(forecastRaw);
const censusData = JSON.parse(censusRaw);
const deprivationData = JSON.parse(deprivationRaw);
const electionData = JSON.parse(electionRaw);
const councilsGeojson = JSON.parse(councilsRaw);

const forecastFeatureStats = forecastData.feature_stats || {};
const partyProfiles = buildPartyProfiles(censusData, deprivationData);

const wardForecastRows = Array.isArray(forecastData?.ward_forecasts) ? forecastData.ward_forecasts : [];
const wardForecastByCode = new Map(wardForecastRows.map((row) => [row.ward_code, row]));

const constituencyRows = Array.isArray(forecastData?.constituency_forecasts) ? forecastData.constituency_forecasts : [];
const makerfieldConstituency = constituencyRows.find((row) => row.constituency_name === "Makerfield") || null;
const makerfieldWardRows = (makerfieldConstituency?.ward_codes || [])
  .map((wardCode) => wardForecastByCode.get(wardCode))
  .filter(Boolean)
  .map(reduceWardForecastRow)
  .sort((a, b) => Number(a.gap || 0) - Number(b.gap || 0));

const makerfieldAuthorityNames = [...new Set(makerfieldWardRows.map((row) => row.authority_name).filter(Boolean))];
const councilFeatureByName = new Map(
  Array.isArray(councilsGeojson?.features)
    ? councilsGeojson.features.map((feature) => [String(feature?.properties?.LAD24NM || "").trim(), feature])
    : []
);
const makerfieldCouncilRows = makerfieldAuthorityNames
  .map((name) => councilFeatureByName.get(name))
  .filter(Boolean)
  .map(reduceCouncilRow);

const gmElectionRows = Array.isArray(electionData?.wards)
  ? electionData.wards.filter((row) => GM_AUTHORITIES.has(row.authority_name))
  : [];
const censusByCode = new Map((Array.isArray(censusData?.wards) ? censusData.wards : []).map((row) => [row.ward_code, row]));
const deprivationByCode = new Map((Array.isArray(deprivationData?.wards) ? deprivationData.wards : []).map((row) => [row.ward_code, row]));
const gmWardSignals = gmElectionRows
  .map((row) => flattenWardSignals(censusByCode.get(row.ward_code), deprivationByCode.get(row.ward_code), row))
  .filter((row) => row.ward_code);

const gmAccumulator = {
  totalWeight: 0,
  totals: Object.fromEntries(FEATURE_IDS.map((featureId) => [featureId, 0])),
  deprivationWeightedTotal: 0,
  wardProbabilityTotals: Object.fromEntries(FORECAST_PARTIES.map((party) => [party, 0])),
  wardWinnerTallies: Object.fromEntries(FORECAST_PARTIES.map((party) => [party, 0]))
};

for (const wardRow of gmWardSignals) {
  const wardForecast = scoreWard(wardRow, partyProfiles, forecastFeatureStats, wardRow.turnout_change_pct_points || 0);
  const weight = Math.max(1, safeNumber(wardRow.age_total ?? wardRow.ethnicity_total ?? 1, 1) || 1);
  gmAccumulator.totalWeight += weight;
  for (const featureId of FEATURE_IDS) {
    const value = safeNumber(wardRow[featureId], null);
    if (!Number.isFinite(value)) continue;
    gmAccumulator.totals[featureId] += value * weight;
  }
  if (Number.isFinite(wardRow.ward_deprivation_mean_decile)) {
    gmAccumulator.deprivationWeightedTotal += wardRow.ward_deprivation_mean_decile * weight;
  }
  for (const party of FORECAST_PARTIES) {
    gmAccumulator.wardProbabilityTotals[party] += (safeNumber(wardForecast.probabilities?.[party], 0) || 0) * weight;
  }
  if (wardForecast.winner && gmAccumulator.wardWinnerTallies[wardForecast.winner] !== undefined) {
    gmAccumulator.wardWinnerTallies[wardForecast.winner] += weight;
  }
}

const gmMayorForecast = buildAggregateForecast(gmAccumulator, "Labour", partyProfiles, forecastFeatureStats);
const gmCouncilFeatures = Array.isArray(councilsGeojson?.features)
  ? councilsGeojson.features
      .filter((feature) => GM_AUTHORITIES.has(String(feature?.properties?.LAD24NM || "").trim()))
      .map(reduceCouncilRow)
  : [];

const output = {
  updated_at_utc: new Date().toISOString(),
  sources: {
    forecast: FORECAST_PATH,
    ward_census_demographics: CENSUS_PATH,
    ward_deprivation_vote_index: DEPRIVATION_PATH,
    ward_election_state: ELECTION_PATH,
    council_controls: COUNCILS_PATH,
    makerfield_current_mp: "https://members.parliament.uk/constituency/4165/overview",
    gm_mayor: "https://www.greatermanchester-ca.gov.uk/the-mayor/",
    gm_next_mayoral_election: "https://www.gov.uk/government/publications/english-devolution-area-factsheets/english-devolution-area-factsheets"
  },
  makerfield: {
    place_type: "Westminster constituency",
    constituency_code: makerfieldConstituency?.constituency_code || "E14001350",
    constituency_name: "Makerfield",
    current_member_id: makerfieldConstituency?.current_member_id || 5060,
    current_member_name: makerfieldConstituency?.current_member_name || "Josh Simons",
    current_party: makerfieldConstituency?.current_party || "Labour",
    forecast_party: makerfieldConstituency?.forecast?.winner || null,
    runner_up: makerfieldConstituency?.forecast?.runner_up || null,
    gap: makerfieldConstituency?.forecast?.confidence || null,
    seat_status: makerfieldConstituency?.seat_status || "unknown",
    ward_count: makerfieldConstituency?.ward_count || makerfieldWardRows.length,
    authority_count: makerfieldAuthorityNames.length,
    authority_names: makerfieldAuthorityNames,
    council_rows: makerfieldCouncilRows,
    ward_winner_tally: makerfieldConstituency?.forecast?.ward_winner_tally || {},
    top_signals: makerfieldConstituency?.forecast?.top_signals || [],
    ward_rows: makerfieldWardRows
  },
  greater_manchester_mayoralty: {
    place_type: "Combined authority mayoralty",
    office_name: "Greater Manchester Mayor",
    current_holder_name: "Andy Burnham",
    current_party: "Labour",
    next_election_year: 2028,
    next_election_month: "May 2028",
    forecast_party: gmMayorForecast.winner,
    runner_up: gmMayorForecast.runner_up,
    gap: gmMayorForecast.confidence,
    seat_status: gmMayorForecast.winner === "Labour" ? "hold" : "change",
    ward_count: gmWardSignals.length,
    authority_count: GM_AUTHORITIES.size,
    authority_names: [...GM_AUTHORITIES],
    council_rows: gmCouncilFeatures,
    ward_winner_tally: gmMayorForecast.ward_winner_tally,
    top_signals: gmMayorForecast.top_signals,
    ward_rows: gmWardSignals
      .map((row) => {
        const wardForecast = scoreWard(row, partyProfiles, forecastFeatureStats, row.turnout_change_pct_points || 0);
        return {
          ward_code: row.ward_code,
          ward_name: row.ward_name,
          authority_name: row.authority_name,
          current_winner_party: row.current_winner_party,
          incumbent_party: row.incumbent_party,
          forecast_party: wardForecast.winner,
          runner_up: wardForecast.runner_up,
          gap: wardForecast.confidence,
          top_signals: rankContributions(row, partyProfiles.find((profile) => profile.party === wardForecast.winner) || partyProfiles[0], forecastFeatureStats)
        };
      })
      .sort((a, b) => Number(a.gap || 0) - Number(b.gap || 0))
  }
};

await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
console.log(`Updated spotlight data: Makerfield and Greater Manchester mayoralty`);
