import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const ELECTION_DATE = process.env.ELECTION_DATE || "2026-05-07";
const COUNCILLORS_CSV_YEAR = String(process.env.COUNCILLORS_CSV_YEAR || ELECTION_DATE.slice(0, 4));
const COUNCILLORS_CSV_URL = `https://opencouncildata.co.uk/csv2.php?y=${encodeURIComponent(COUNCILLORS_CSV_YEAR)}`;
const DEMOCRACY_CLUB_BALLOTS_BASE_URL = "https://candidates.democracyclub.org.uk/api/next/ballots/";
const REFRESH_ALL_WARDS = /^(1|true|yes)$/i.test(String(process.env.REFRESH_ALL_WARDS || ""));
const CHECK_PENDING_WARDS = /^(1|true|yes)$/i.test(String(process.env.CHECK_PENDING_WARDS || "1"));
const WARDS_GEOJSON_PATH = path.resolve(projectRoot, "src/data/england-wards.geojson");
const OUTPUT_JSON_PATH = path.resolve(projectRoot, "src/data/england-ward-election-state.json");
const PRIOR_LOCAL_ELECTION_DATES = [
  "2025-05-01",
  "2023-05-04",
  "2022-05-05"
];

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
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function chooseIncumbentParty(partyCounts) {
  const entries = Object.entries(partyCounts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "Unknown";
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return "Mixed";
  return entries[0][0];
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, label) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      return response.json();
    }
    const isRetriable = response.status === 429 || response.status >= 500;
    if (!isRetriable || attempt === maxAttempts) {
      throw new Error(`Failed to fetch ${label} (${response.status})`);
    }
    const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
    const backoffMs = retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 1200 * Math.pow(2, attempt - 1);
    await sleep(backoffMs);
  }
  throw new Error(`Failed to fetch ${label} (exhausted retries)`);
}

function extractWinnerPartyFromBallot(ballot) {
  const candidacies = Array.isArray(ballot?.candidacies) ? ballot.candidacies : [];
  const elected = candidacies.filter((row) => row?.elected === true);
  if (!elected.length) return null;
  const partyStats = new Map();
  for (const row of elected) {
    const partyName = String(row?.party_name || row?.party?.name || "").trim();
    if (!partyName) continue;
    const votes = toFiniteNumber(row?.result?.num_ballots) ?? -1;
    const existing = partyStats.get(partyName) || { seats: 0, topVotes: -1 };
    existing.seats += 1;
    existing.topVotes = Math.max(existing.topVotes, votes);
    partyStats.set(partyName, existing);
  }
  const winner = [...partyStats.entries()].sort((a, b) => {
    if (b[1].seats !== a[1].seats) return b[1].seats - a[1].seats;
    if (b[1].topVotes !== a[1].topVotes) return b[1].topVotes - a[1].topVotes;
    return a[0].localeCompare(b[0]);
  })[0];
  return winner?.[0] || null;
}

function summarizeBallot(ballot) {
  const wardCode = String(ballot?.post?.id || "").replace(/^gss:/i, "");
  if (!wardCode) return null;
  const candidacies = Array.isArray(ballot?.candidacies) ? ballot.candidacies : [];
  let totalCandidateVotes = 0;
  let hasCandidateVotes = false;
  let winnerVotes = null;
  for (const row of candidacies) {
    const votes = toFiniteNumber(row?.result?.num_ballots);
    if (votes === null) continue;
    totalCandidateVotes += votes;
    hasCandidateVotes = true;
    if (row?.elected === true && (winnerVotes === null || votes > winnerVotes)) {
      winnerVotes = votes;
    }
  }
  return {
    ward_code: wardCode,
    ballot_paper_id: String(ballot?.ballot_paper_id || ""),
    election_date: String(ballot?.election?.election_date || ""),
    election_id: String(ballot?.election?.election_id || ""),
    winner_party: extractWinnerPartyFromBallot(ballot),
    winner_count: toFiniteNumber(ballot?.winner_count),
    turnout_percentage: toFiniteNumber(ballot?.results?.turnout_percentage),
    total_electorate: toFiniteNumber(ballot?.results?.total_electorate),
    num_turnout_reported: toFiniteNumber(ballot?.results?.num_turnout_reported),
    num_spoilt_ballots: toFiniteNumber(ballot?.results?.num_spoilt_ballots),
    total_candidate_votes: hasCandidateVotes ? totalCandidateVotes : null,
    winner_votes: winnerVotes,
    source: String(ballot?.results?.source || "")
  };
}

async function fetchBallotSummariesForDate(electionDate, allowedWardCodes, onlyWardCodes = null) {
  const byWardCode = new Map();
  let nextUrl = `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?${new URLSearchParams({
    election_date: electionDate,
    page_size: "200"
  }).toString()}`;
  let safetyCounter = 0;
  let matchedWardCodes = 0;
  console.log(`[ward-refresh] Fetching Democracy Club ballots for ${electionDate}...`);

  while (nextUrl && safetyCounter < 100) {
    safetyCounter += 1;
    const payload = await fetchJsonWithRetry(nextUrl, `Democracy Club ballots ${electionDate}`);
    const results = Array.isArray(payload?.results) ? payload.results : [];

    for (const ballot of results) {
      const electionId = String(ballot?.election?.election_id || "");
      if (!electionId.startsWith("local.")) continue;
      const summary = summarizeBallot(ballot);
      const wardCode = summary?.ward_code || "";
      if (!wardCode || !allowedWardCodes.has(wardCode)) continue;
      if (onlyWardCodes && !onlyWardCodes.has(wardCode)) continue;
      if (byWardCode.has(wardCode)) continue;
      byWardCode.set(wardCode, summary);
      matchedWardCodes += 1;
    }

    console.log(
      `[ward-refresh] ${electionDate} page ${safetyCounter}: scanned ${results.length}, matched wards ${matchedWardCodes}`
    );
    nextUrl = payload?.next || null;
  }

  console.log(`[ward-refresh] ${electionDate} complete: ${byWardCode.size} ward ballots`);
  return byWardCode;
}

async function fetchCurrentAndPreviousBallots(allowedWardCodes) {
  const shouldFetchBallots = REFRESH_ALL_WARDS || CHECK_PENDING_WARDS;
  if (!shouldFetchBallots) {
    return {
      currentByWardCode: new Map(),
      previousByWardCode: new Map()
    };
  }

  const currentByWardCode = await fetchBallotSummariesForDate(ELECTION_DATE, allowedWardCodes);
  const remainingWardCodes = new Set(currentByWardCode.keys());
  const previousByWardCode = new Map();

  for (const previousDate of PRIOR_LOCAL_ELECTION_DATES) {
    if (!remainingWardCodes.size) break;
    const dateMatches = await fetchBallotSummariesForDate(previousDate, allowedWardCodes, remainingWardCodes);
    for (const [wardCode, summary] of dateMatches.entries()) {
      if (previousByWardCode.has(wardCode)) continue;
      previousByWardCode.set(wardCode, summary);
      remainingWardCodes.delete(wardCode);
    }
  }

  return { currentByWardCode, previousByWardCode };
}

async function fetchCouncillorsCsv() {
  const response = await fetch(COUNCILLORS_CSV_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch councillors CSV (${response.status})`);
  }
  return response.text();
}

function getMetricOrExisting(currentValue, existingValue) {
  return currentValue ?? existingValue ?? null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function buildElectionState() {
  const wardsRaw = await fs.readFile(WARDS_GEOJSON_PATH, "utf8");
  const wardsGeojson = JSON.parse(wardsRaw);
  const wardFeatures = Array.isArray(wardsGeojson?.features) ? wardsGeojson.features : [];
  const wardCodeSet = new Set(
    wardFeatures
      .map((feature) => String(feature?.properties?.WD24CD || ""))
      .filter(Boolean)
  );
  const [councillorsCsv, ballotMetrics] = await Promise.all([
    fetchCouncillorsCsv(),
    fetchCurrentAndPreviousBallots(wardCodeSet)
  ]);

  const currentBallotsByWardCode = ballotMetrics.currentByWardCode;
  const previousBallotsByWardCode = ballotMetrics.previousByWardCode;

  let existingWardsByCode = new Map();
  try {
    const existingRaw = await fs.readFile(OUTPUT_JSON_PATH, "utf8");
    const existingPayload = JSON.parse(existingRaw);
    const existingWards = Array.isArray(existingPayload?.wards) ? existingPayload.wards : [];
    existingWardsByCode = new Map(
      existingWards
        .filter((row) => row?.ward_code)
        .map((row) => [row.ward_code, row])
    );
  } catch (_error) {
    existingWardsByCode = new Map();
  }

  const lines = councillorsCsv.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] || "");
  const councilIdx = header.indexOf("Council");
  const wardIdx = header.indexOf("Ward Name");
  const councillorIdx = header.indexOf("Councillor Name");
  const partyIdx = header.indexOf("Party Name");
  if ([councilIdx, wardIdx, councillorIdx, partyIdx].some((idx) => idx < 0)) {
    throw new Error("Unexpected councillors CSV schema");
  }

  const byAuthorityWard = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const council = row[councilIdx];
    const ward = row[wardIdx];
    const party = row[partyIdx] || "Unknown";
    const councillor = row[councillorIdx] || "";
    const key = `${normalizeName(council)}::${normalizeName(ward)}`;
    const existing = byAuthorityWard.get(key) || {
      council,
      ward,
      councillors: [],
      partyCounts: {}
    };
    existing.councillors.push({
      name: councillor,
      party
    });
    existing.partyCounts[party] = (existing.partyCounts[party] || 0) + 1;
    byAuthorityWard.set(key, existing);
  }

  const wards = [];
  const comparableVoteChanges = [];
  const comparableTurnoutChanges = [];
  let matched = 0;
  let declaredWardWinners = 0;
  let wardsWithCurrentBallotMetrics = 0;
  let wardsWithPreviousLocalBallot = 0;
  let wardsWithVoteChange = 0;
  let wardsWithTurnoutChange = 0;

  for (const feature of wardFeatures) {
    const props = feature?.properties || {};
    const wardCode = String(props.WD24CD || "");
    const wardName = props.WD24NM;
    const authorityName = props.LAD24NM;
    const authorityCode = props.LAD24CD;
    const key = `${normalizeName(authorityName)}::${normalizeName(wardName)}`;
    const incumbent = byAuthorityWard.get(key);
    const existing = existingWardsByCode.get(wardCode) || null;
    const currentBallot = currentBallotsByWardCode.get(wardCode) || null;
    const previousBallot = previousBallotsByWardCode.get(wardCode) || null;
    if (incumbent) matched += 1;

    const dcWinnerParty = currentBallot?.winner_party || null;
    const shouldApplyDcWinner = Boolean(dcWinnerParty) && (REFRESH_ALL_WARDS || !existing?.winner_party);
    const finalWinnerParty = shouldApplyDcWinner ? dcWinnerParty : (existing?.winner_party ?? null);

    const currentTotalCandidateVotes = getMetricOrExisting(
      currentBallot?.total_candidate_votes,
      existing?.current_total_candidate_votes
    );
    const previousTotalCandidateVotes = getMetricOrExisting(
      previousBallot?.total_candidate_votes,
      existing?.previous_total_candidate_votes
    );
    const currentTurnoutPercentage = getMetricOrExisting(
      currentBallot?.turnout_percentage,
      existing?.current_turnout_percentage
    );
    const previousTurnoutPercentage = getMetricOrExisting(
      previousBallot?.turnout_percentage,
      existing?.previous_turnout_percentage
    );

    const voteCountChange = currentTotalCandidateVotes !== null && previousTotalCandidateVotes !== null
      ? currentTotalCandidateVotes - previousTotalCandidateVotes
      : null;
    const turnoutChangePctPoints = currentTurnoutPercentage !== null && previousTurnoutPercentage !== null
      ? currentTurnoutPercentage - previousTurnoutPercentage
      : null;

    if (currentBallot) wardsWithCurrentBallotMetrics += 1;
    if (previousBallot) wardsWithPreviousLocalBallot += 1;
    if (voteCountChange !== null) {
      wardsWithVoteChange += 1;
      comparableVoteChanges.push(voteCountChange);
    }
    if (turnoutChangePctPoints !== null) {
      wardsWithTurnoutChange += 1;
      comparableTurnoutChanges.push(turnoutChangePctPoints);
    }

    wards.push({
      ward_code: wardCode,
      ward_name: wardName,
      authority_name: authorityName,
      authority_code: authorityCode,
      incumbent_party: incumbent ? chooseIncumbentParty(incumbent.partyCounts) : "Unknown",
      incumbent_councillors: incumbent ? incumbent.councillors : [],
      winner_party: finalWinnerParty,
      winner_status: finalWinnerParty ? "declared" : "pending",
      winner_source: shouldApplyDcWinner ? "democracy_club_ballots_api" : (existing?.winner_source ?? null),
      current_ballot_paper_id: getMetricOrExisting(currentBallot?.ballot_paper_id, existing?.current_ballot_paper_id),
      current_election_date: getMetricOrExisting(currentBallot?.election_date, existing?.current_election_date),
      current_election_id: getMetricOrExisting(currentBallot?.election_id, existing?.current_election_id),
      current_turnout_percentage: currentTurnoutPercentage,
      current_total_electorate: getMetricOrExisting(currentBallot?.total_electorate, existing?.current_total_electorate),
      current_num_turnout_reported: getMetricOrExisting(currentBallot?.num_turnout_reported, existing?.current_num_turnout_reported),
      current_num_spoilt_ballots: getMetricOrExisting(currentBallot?.num_spoilt_ballots, existing?.current_num_spoilt_ballots),
      current_total_candidate_votes: currentTotalCandidateVotes,
      current_winner_votes: getMetricOrExisting(currentBallot?.winner_votes, existing?.current_winner_votes),
      current_results_source: getMetricOrExisting(currentBallot?.source, existing?.current_results_source),
      previous_ballot_paper_id: getMetricOrExisting(previousBallot?.ballot_paper_id, existing?.previous_ballot_paper_id),
      previous_election_date: getMetricOrExisting(previousBallot?.election_date, existing?.previous_election_date),
      previous_election_id: getMetricOrExisting(previousBallot?.election_id, existing?.previous_election_id),
      previous_turnout_percentage: previousTurnoutPercentage,
      previous_total_electorate: getMetricOrExisting(previousBallot?.total_electorate, existing?.previous_total_electorate),
      previous_num_turnout_reported: getMetricOrExisting(previousBallot?.num_turnout_reported, existing?.previous_num_turnout_reported),
      previous_num_spoilt_ballots: getMetricOrExisting(previousBallot?.num_spoilt_ballots, existing?.previous_num_spoilt_ballots),
      previous_total_candidate_votes: previousTotalCandidateVotes,
      previous_winner_votes: getMetricOrExisting(previousBallot?.winner_votes, existing?.previous_winner_votes),
      previous_results_source: getMetricOrExisting(previousBallot?.source, existing?.previous_results_source),
      vote_count_change: voteCountChange,
      turnout_change_pct_points: turnoutChangePctPoints,
      vote_count_change_relative_to_mean: null
    });

    if (finalWinnerParty) declaredWardWinners += 1;
  }

  const meanVoteCountChange = mean(comparableVoteChanges);
  for (const ward of wards) {
    if (ward.vote_count_change !== null && meanVoteCountChange !== null) {
      ward.vote_count_change_relative_to_mean = ward.vote_count_change - meanVoteCountChange;
    }
  }

  const output = {
    updated_at_utc: new Date().toISOString(),
    sources: {
      wards_geojson: WARDS_GEOJSON_PATH,
      incumbents_csv: COUNCILLORS_CSV_URL,
      democracy_club_ballots_current: `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?election_date=${encodeURIComponent(ELECTION_DATE)}`,
      democracy_club_ballots_previous_local_dates: PRIOR_LOCAL_ELECTION_DATES.map(
        (date) => `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?election_date=${encodeURIComponent(date)}`
      )
    },
    summary: {
      wards_total: wards.length,
      incumbents_matched: matched,
      incumbents_unmatched: wards.length - matched,
      wards_declared: declaredWardWinners,
      wards_with_current_ballot_metrics: wardsWithCurrentBallotMetrics,
      wards_with_previous_local_ballot: wardsWithPreviousLocalBallot,
      wards_with_vote_count_change: wardsWithVoteChange,
      wards_with_turnout_change: wardsWithTurnoutChange,
      mean_vote_count_change: meanVoteCountChange,
      mean_turnout_change_pct_points: mean(comparableTurnoutChanges)
    },
    wards
  };

  await fs.writeFile(OUTPUT_JSON_PATH, JSON.stringify(output, null, 2));
  return output;
}

const result = await buildElectionState();
console.log(
  `Updated England ward election state: ${result.summary.incumbents_matched}/${result.summary.wards_total} incumbents matched`
);
console.log(
  REFRESH_ALL_WARDS
    ? `Refreshed ward winners from Democracy Club (${result.summary.wards_declared} declared wards).`
    : `Checked pending wards via Democracy Club (${result.summary.wards_declared} declared wards).`
);
console.log(
  `Comparable prior locals: ${result.summary.wards_with_vote_count_change} vote deltas, ${result.summary.wards_with_turnout_change} turnout deltas.`
);
