import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot, readJsonIfExists, updateSourceManifest, readWardElectionProgress, writeWardElectionProgress } from "./pipeline-tools.mjs";

export const ELECTION_DATE = process.env.ELECTION_DATE || "2026-05-07";
export const COUNCILLORS_CSV_YEAR = String(process.env.COUNCILLORS_CSV_YEAR || ELECTION_DATE.slice(0, 4));
export const COUNCILLORS_CSV_URL = `https://opencouncildata.co.uk/csv2.php?y=${encodeURIComponent(COUNCILLORS_CSV_YEAR)}`;
export const DEMOCRACY_CLUB_BALLOTS_BASE_URL = "https://candidates.democracyclub.org.uk/api/next/ballots/";
export const PRIOR_LOCAL_ELECTION_DATES = ["2025-05-01", "2023-05-04", "2022-05-05"];
export const WARDS_GEOJSON_PATH = path.resolve(projectRoot, "src/data/england-wards.geojson");
export const OUTPUT_JSON_PATH = path.resolve(projectRoot, "src/data/england-ward-election-state.json");

export function parseCsvLine(line) {
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

export function normalizeName(value) {
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

function normalizeTurnoutPercentage(value) {
  const num = toFiniteNumber(value);
  return num !== null && num > 0 ? num : null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, label) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return response.json();
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
  const turnoutPercentageRaw = normalizeTurnoutPercentage(ballot?.results?.turnout_percentage);
  const totalElectorateRaw = toFiniteNumber(ballot?.results?.total_electorate);
  const numTurnoutReportedRaw = toFiniteNumber(ballot?.results?.num_turnout_reported);
  return {
    ward_code: wardCode,
    ballot_paper_id: String(ballot?.ballot_paper_id || ""),
    election_date: String(ballot?.election?.election_date || ""),
    election_id: String(ballot?.election?.election_id || ""),
    winner_party: extractWinnerPartyFromBallot(ballot),
    winner_count: toFiniteNumber(ballot?.winner_count),
    turnout_percentage: turnoutPercentageRaw,
    total_electorate: totalElectorateRaw !== null && totalElectorateRaw > 0 ? totalElectorateRaw : null,
    num_turnout_reported: numTurnoutReportedRaw !== null && numTurnoutReportedRaw > 0 ? numTurnoutReportedRaw : null,
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
    console.log(`[ward-refresh] ${electionDate} page ${safetyCounter}: scanned ${results.length}, matched wards ${matchedWardCodes}`);
    nextUrl = payload?.next || null;
  }

  console.log(`[ward-refresh] ${electionDate} complete: ${byWardCode.size} ward ballots`);
  return byWardCode;
}

async function fetchCouncillorsCsv() {
  const response = await fetch(COUNCILLORS_CSV_URL);
  if (!response.ok) throw new Error(`Failed to fetch councillors CSV (${response.status})`);
  return response.text();
}

function getMetricOrExisting(currentValue, existingValue) {
  return currentValue ?? existingValue ?? null;
}

function clearHistoricalFields(row) {
  row.previous_ballot_paper_id = null;
  row.previous_election_date = null;
  row.previous_election_id = null;
  row.previous_turnout_percentage = null;
  row.previous_total_electorate = null;
  row.previous_num_turnout_reported = null;
  row.previous_num_spoilt_ballots = null;
  row.previous_total_candidate_votes = null;
  row.previous_winner_votes = null;
  row.previous_results_source = null;
}

function recomputeRowMetrics(row) {
  row.vote_count_change =
    row.current_total_candidate_votes !== null && row.previous_total_candidate_votes !== null
      ? row.current_total_candidate_votes - row.previous_total_candidate_votes
      : null;
  row.turnout_change_pct_points =
    row.current_turnout_percentage !== null && row.previous_turnout_percentage !== null
      ? row.current_turnout_percentage - row.previous_turnout_percentage
      : null;
}

function finalizeElectionPayload(rows) {
  const comparableVoteChanges = [];
  const comparableTurnoutChanges = [];
  let declaredWardWinners = 0;
  let wardsWithCurrentBallotMetrics = 0;
  let wardsWithPreviousLocalBallot = 0;
  let wardsWithVoteChange = 0;
  let wardsWithTurnoutChange = 0;

  for (const row of rows) {
    recomputeRowMetrics(row);
    if (row.winner_party) declaredWardWinners += 1;
    if (row.current_ballot_paper_id) wardsWithCurrentBallotMetrics += 1;
    if (row.previous_ballot_paper_id) wardsWithPreviousLocalBallot += 1;
    if (row.vote_count_change !== null) {
      wardsWithVoteChange += 1;
      comparableVoteChanges.push(row.vote_count_change);
    }
    if (row.turnout_change_pct_points !== null) {
      wardsWithTurnoutChange += 1;
      comparableTurnoutChanges.push(row.turnout_change_pct_points);
    }
  }

  const meanVoteCountChange = mean(comparableVoteChanges);
  for (const row of rows) {
    row.vote_count_change_relative_to_mean = row.vote_count_change !== null && meanVoteCountChange !== null
      ? row.vote_count_change - meanVoteCountChange
      : null;
  }

  return {
    wards_total: rows.length,
    wards_declared: declaredWardWinners,
    wards_with_current_ballot_metrics: wardsWithCurrentBallotMetrics,
    wards_with_previous_local_ballot: wardsWithPreviousLocalBallot,
    wards_with_vote_count_change: wardsWithVoteChange,
    wards_with_turnout_change: wardsWithTurnoutChange,
    mean_vote_count_change: meanVoteCountChange,
    mean_turnout_change_pct_points: mean(comparableTurnoutChanges)
  };
}

async function loadBaseContext() {
  const wardsRaw = await fs.readFile(WARDS_GEOJSON_PATH, "utf8");
  const wardsGeojson = JSON.parse(wardsRaw);
  const wardFeatures = Array.isArray(wardsGeojson?.features) ? wardsGeojson.features : [];
  const wardCodeSet = new Set(
    wardFeatures
      .map((feature) => String(feature?.properties?.WD24CD || ""))
      .filter(Boolean)
  );
  const [councillorsCsv, existingPayload] = await Promise.all([
    fetchCouncillorsCsv(),
    readJsonIfExists(OUTPUT_JSON_PATH, null)
  ]);
  const existingWards = Array.isArray(existingPayload?.wards) ? existingPayload.wards : [];
  const existingWardsByCode = new Map(existingWards.filter((row) => row?.ward_code).map((row) => [row.ward_code, row]));

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
    const existing = byAuthorityWard.get(key) || { councillors: [], partyCounts: {} };
    existing.councillors.push({ name: councillor, party });
    existing.partyCounts[party] = (existing.partyCounts[party] || 0) + 1;
    byAuthorityWard.set(key, existing);
  }

  const rows = wardFeatures.map((feature) => {
    const props = feature?.properties || {};
    const wardCode = String(props.WD24CD || "");
    const wardName = props.WD24NM || null;
    const authorityName = props.LAD24NM || null;
    const authorityCode = props.LAD24CD || null;
    const key = `${normalizeName(authorityName)}::${normalizeName(wardName)}`;
    const incumbent = byAuthorityWard.get(key);
    const existing = existingWardsByCode.get(wardCode) || {};
    return {
      ward_code: wardCode,
      ward_name: wardName,
      authority_name: authorityName,
      authority_code: authorityCode,
      incumbent_party: incumbent ? chooseIncumbentParty(incumbent.partyCounts) : "Unknown",
      incumbent_councillors: incumbent ? incumbent.councillors : [],
      winner_party: existing.winner_party ?? null,
      winner_status: existing.winner_party ? "declared" : (existing.winner_status ?? "pending"),
      winner_source: existing.winner_source ?? null,
      current_ballot_paper_id: existing.current_ballot_paper_id ?? null,
      current_election_date: existing.current_election_date ?? null,
      current_election_id: existing.current_election_id ?? null,
      current_turnout_percentage: normalizeTurnoutPercentage(existing.current_turnout_percentage),
      current_total_electorate: existing.current_total_electorate ?? null,
      current_num_turnout_reported: existing.current_num_turnout_reported ?? null,
      current_num_spoilt_ballots: existing.current_num_spoilt_ballots ?? null,
      current_total_candidate_votes: existing.current_total_candidate_votes ?? null,
      current_winner_votes: existing.current_winner_votes ?? null,
      current_results_source: existing.current_results_source ?? null,
      previous_ballot_paper_id: existing.previous_ballot_paper_id ?? null,
      previous_election_date: existing.previous_election_date ?? null,
      previous_election_id: existing.previous_election_id ?? null,
      previous_turnout_percentage: normalizeTurnoutPercentage(existing.previous_turnout_percentage),
      previous_total_electorate: existing.previous_total_electorate ?? null,
      previous_num_turnout_reported: existing.previous_num_turnout_reported ?? null,
      previous_num_spoilt_ballots: existing.previous_num_spoilt_ballots ?? null,
      previous_total_candidate_votes: existing.previous_total_candidate_votes ?? null,
      previous_winner_votes: existing.previous_winner_votes ?? null,
      previous_results_source: existing.previous_results_source ?? null,
      vote_count_change: existing.vote_count_change ?? null,
      turnout_change_pct_points: existing.turnout_change_pct_points ?? null,
      vote_count_change_relative_to_mean: existing.vote_count_change_relative_to_mean ?? null
    };
  });

  return { wardFeatures, wardCodeSet, rows };
}

async function writeElectionState(rows, extraSources = {}) {
  const summary = finalizeElectionPayload(rows);
  const output = {
    updated_at_utc: new Date().toISOString(),
    sources: {
      wards_geojson: WARDS_GEOJSON_PATH,
      incumbents_csv: COUNCILLORS_CSV_URL,
      democracy_club_ballots_current: `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?election_date=${encodeURIComponent(ELECTION_DATE)}`,
      democracy_club_ballots_previous_local_dates: PRIOR_LOCAL_ELECTION_DATES.map((date) => `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?election_date=${encodeURIComponent(date)}`),
      ...extraSources
    },
    summary,
    wards: rows
  };
  await fs.writeFile(OUTPUT_JSON_PATH, JSON.stringify(output, null, 2));
  return output;
}

export async function updateCurrentWardElectionState(options = {}) {
  const forceAllCurrent = Boolean(options.forceAllCurrent);
  const context = await loadBaseContext();
  const rowsByWardCode = new Map(context.rows.map((row) => [row.ward_code, row]));
  const progress = await readWardElectionProgress();
  const eligibleCurrentWardCodes = context.rows
    .filter((row) => row.current_ballot_paper_id)
    .map((row) => row.ward_code);
  const pendingWardCodes = new Set(
    context.rows
      .filter((row) => row.current_ballot_paper_id && !row.winner_party)
      .map((row) => row.ward_code)
  );

  if (!forceAllCurrent && eligibleCurrentWardCodes.length > 0 && pendingWardCodes.size === 0) {
    await updateSourceManifest("ward_election_current", {
      source_url: `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?election_date=${encodeURIComponent(ELECTION_DATE)}`,
      last_fetch_utc: new Date().toISOString(),
      version_key: ELECTION_DATE,
      fetch_mode: "pending_only",
      completion_status: "complete",
      output_files: [OUTPUT_JSON_PATH]
    });
    await writeWardElectionProgress({
      ...progress,
      current: {
        current_election_date: ELECTION_DATE,
        last_checked_utc: new Date().toISOString(),
        fetch_mode: "pending_only",
        completion_status: "complete",
        eligible_ward_count: eligibleCurrentWardCodes.length,
        pending_ward_codes: [],
        pending_count: 0
      }
    });
    const payload = await writeElectionState(context.rows);
    return { payload, skipped: true };
  }

  const currentBallotsByWardCode = await fetchBallotSummariesForDate(ELECTION_DATE, context.wardCodeSet);
  for (const [wardCode, currentBallot] of currentBallotsByWardCode.entries()) {
    const row = rowsByWardCode.get(wardCode);
    if (!row) continue;
    const shouldMerge = forceAllCurrent
      || pendingWardCodes.has(wardCode)
      || !row.current_ballot_paper_id
      || row.current_total_candidate_votes === null;
    if (!shouldMerge) continue;
    row.winner_party = currentBallot.winner_party || row.winner_party || null;
    row.winner_status = row.winner_party ? "declared" : "pending";
    row.winner_source = currentBallot.winner_party ? "democracy_club_ballots_api" : row.winner_source;
    row.current_ballot_paper_id = getMetricOrExisting(currentBallot.ballot_paper_id, row.current_ballot_paper_id);
    row.current_election_date = getMetricOrExisting(currentBallot.election_date, row.current_election_date);
    row.current_election_id = getMetricOrExisting(currentBallot.election_id, row.current_election_id);
    row.current_turnout_percentage = getMetricOrExisting(currentBallot.turnout_percentage, row.current_turnout_percentage);
    row.current_total_electorate = getMetricOrExisting(currentBallot.total_electorate, row.current_total_electorate);
    row.current_num_turnout_reported = getMetricOrExisting(currentBallot.num_turnout_reported, row.current_num_turnout_reported);
    row.current_num_spoilt_ballots = getMetricOrExisting(currentBallot.num_spoilt_ballots, row.current_num_spoilt_ballots);
    row.current_total_candidate_votes = getMetricOrExisting(currentBallot.total_candidate_votes, row.current_total_candidate_votes);
    row.current_winner_votes = getMetricOrExisting(currentBallot.winner_votes, row.current_winner_votes);
    row.current_results_source = getMetricOrExisting(currentBallot.source, row.current_results_source);
  }

  const payload = await writeElectionState(context.rows);
  const currentEligibleWardCodes = payload.wards
    .filter((row) => row.current_ballot_paper_id)
    .map((row) => row.ward_code);
  const nextPendingWardCodes = payload.wards
    .filter((row) => row.current_ballot_paper_id && !row.winner_party)
    .map((row) => row.ward_code);
  await updateSourceManifest("ward_election_current", {
    source_url: `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?election_date=${encodeURIComponent(ELECTION_DATE)}`,
    last_fetch_utc: new Date().toISOString(),
    version_key: ELECTION_DATE,
    fetch_mode: forceAllCurrent ? "force_all_current" : "pending_only",
    completion_status: nextPendingWardCodes.length ? "pending" : "complete",
    output_files: [OUTPUT_JSON_PATH]
  });
  await writeWardElectionProgress({
    ...progress,
    current: {
      current_election_date: ELECTION_DATE,
      last_checked_utc: new Date().toISOString(),
      fetch_mode: forceAllCurrent ? "force_all_current" : "pending_only",
      completion_status: nextPendingWardCodes.length ? "pending" : "complete",
      eligible_ward_count: currentEligibleWardCodes.length,
      pending_ward_codes: nextPendingWardCodes,
      pending_count: nextPendingWardCodes.length,
      declared_count: payload.summary.wards_declared
    }
  });
  return { payload, skipped: false };
}

export async function updateHistoricalWardElectionState(options = {}) {
  const forceHistory = Boolean(options.forceHistory);
  const context = await loadBaseContext();
  const rowsByWardCode = new Map(context.rows.map((row) => [row.ward_code, row]));
  const progress = await readWardElectionProgress();
  const historyState = progress.history || {};
  const frozenDates = forceHistory ? new Set() : new Set(historyState.frozen_election_dates || []);
  const eligibleWardCodes = new Set(
    context.rows
      .filter((row) => row.current_ballot_paper_id)
      .map((row) => row.ward_code)
  );

  if (forceHistory) {
    for (const row of context.rows) clearHistoricalFields(row);
  }

  const missingPreviousByCode = new Set(
    context.rows
      .filter((row) => eligibleWardCodes.has(row.ward_code) && !row.previous_ballot_paper_id)
      .map((row) => row.ward_code)
  );

  const dateResults = [];
  for (const previousDate of PRIOR_LOCAL_ELECTION_DATES) {
    if (!forceHistory && frozenDates.has(previousDate)) {
      dateResults.push({ election_date: previousDate, fetch_mode: "frozen_skip", matched_count: 0, frozen: true });
      continue;
    }
    if (!forceHistory && missingPreviousByCode.size === 0) {
      dateResults.push({ election_date: previousDate, fetch_mode: "not_needed", matched_count: 0, frozen: true });
      frozenDates.add(previousDate);
      continue;
    }
    const targetWardCodes = forceHistory ? eligibleWardCodes : missingPreviousByCode;
    const previousBallotsByWardCode = await fetchBallotSummariesForDate(previousDate, context.wardCodeSet, targetWardCodes);
    for (const [wardCode, previousBallot] of previousBallotsByWardCode.entries()) {
      const row = rowsByWardCode.get(wardCode);
      if (!row) continue;
      row.previous_ballot_paper_id = getMetricOrExisting(previousBallot.ballot_paper_id, row.previous_ballot_paper_id);
      row.previous_election_date = getMetricOrExisting(previousBallot.election_date, row.previous_election_date);
      row.previous_election_id = getMetricOrExisting(previousBallot.election_id, row.previous_election_id);
      row.previous_turnout_percentage = getMetricOrExisting(previousBallot.turnout_percentage, row.previous_turnout_percentage);
      row.previous_total_electorate = getMetricOrExisting(previousBallot.total_electorate, row.previous_total_electorate);
      row.previous_num_turnout_reported = getMetricOrExisting(previousBallot.num_turnout_reported, row.previous_num_turnout_reported);
      row.previous_num_spoilt_ballots = getMetricOrExisting(previousBallot.num_spoilt_ballots, row.previous_num_spoilt_ballots);
      row.previous_total_candidate_votes = getMetricOrExisting(previousBallot.total_candidate_votes, row.previous_total_candidate_votes);
      row.previous_winner_votes = getMetricOrExisting(previousBallot.winner_votes, row.previous_winner_votes);
      row.previous_results_source = getMetricOrExisting(previousBallot.source, row.previous_results_source);
      missingPreviousByCode.delete(wardCode);
    }
    frozenDates.add(previousDate);
    dateResults.push({
      election_date: previousDate,
      fetch_mode: forceHistory ? "force_rebuild_history" : "missing_only",
      matched_count: previousBallotsByWardCode.size,
      frozen: true
    });
  }

  const payload = await writeElectionState(context.rows);
  const unresolvedWardCodes = payload.wards
    .filter((row) => eligibleWardCodes.has(row.ward_code) && !row.previous_ballot_paper_id)
    .map((row) => row.ward_code);
  await updateSourceManifest("ward_election_history", {
    source_url: PRIOR_LOCAL_ELECTION_DATES.map((date) => `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?election_date=${encodeURIComponent(date)}`),
    last_fetch_utc: new Date().toISOString(),
    version_key: PRIOR_LOCAL_ELECTION_DATES.join(","),
    fetch_mode: forceHistory ? "force_rebuild_history" : "missing_only",
    completion_status: unresolvedWardCodes.length ? "partial" : "complete",
    output_files: [OUTPUT_JSON_PATH]
  });
  await writeWardElectionProgress({
    ...progress,
    history: {
      comparator_dates: dateResults,
      frozen_election_dates: [...frozenDates],
      eligible_current_ward_count: eligibleWardCodes.size,
      missing_previous_ward_codes: unresolvedWardCodes,
      completion_status: unresolvedWardCodes.length ? "partial" : "complete",
      last_checked_utc: new Date().toISOString()
    }
  });
  return { payload, skipped: false };
}
