import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const COUNCILLORS_CSV_URL = "https://opencouncildata.co.uk/csv2.php?y=2025";
const BBC_COUNCILS_URL = "https://static.files.bbci.co.uk/elections/data/news/election/2026/england/councils";
const DEMOCRACY_CLUB_RESULTS_BASE_URL = "https://candidates.democracyclub.org.uk/api/next/results/";
const DEMOCRACY_CLUB_BALLOTS_BASE_URL = "https://candidates.democracyclub.org.uk/api/next/ballots/";
const ELECTION_DATE = process.env.ELECTION_DATE || "2026-05-07";
const REFRESH_ALL_WARDS = /^(1|true|yes)$/i.test(String(process.env.REFRESH_ALL_WARDS || ""));
const CHECK_PENDING_WARDS = /^(1|true|yes)$/i.test(String(process.env.CHECK_PENDING_WARDS || "1"));
const WARDS_GEOJSON_PATH = path.resolve(projectRoot, ".vite-src/data/greater-manchester-wards.geojson");
const OUTPUT_JSON_PATH = path.resolve(projectRoot, ".vite-src/data/greater-manchester-ward-election-state.json");

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

function extractWinnerPartyFromCandidateResults(candidateResults) {
  const rows = Array.isArray(candidateResults) ? candidateResults : [];
  const electedRows = rows.filter((row) => row?.elected === true);
  const chosen = electedRows[0] || null;
  const partyName = chosen?.party?.name || null;
  return partyName ? String(partyName).trim() : null;
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

async function fetchDemocracyClubBallotWardCodeMap(allowedWardCodes) {
  const byBallotPaperId = new Map();
  let nextUrl = `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?${new URLSearchParams({
    election_date: ELECTION_DATE,
    page_size: "200"
  }).toString()}`;
  let safetyCounter = 0;
  let matchedWardCodes = 0;
  console.log("[ward-refresh] Fetching Democracy Club ballots...");

  while (nextUrl && safetyCounter < 100) {
    safetyCounter += 1;
    const payload = await fetchJsonWithRetry(nextUrl, "Democracy Club ballots");
    const results = Array.isArray(payload?.results) ? payload.results : [];

    for (const ballot of results) {
      const ballotPaperId = String(ballot?.ballot_paper_id || "");
      const wardCode = String(ballot?.post?.id || "").replace(/^gss:/i, "");
      if (!ballotPaperId || !wardCode || !allowedWardCodes.has(wardCode)) continue;
      if (!byBallotPaperId.has(ballotPaperId)) matchedWardCodes += 1;
      byBallotPaperId.set(ballotPaperId, wardCode);
    }
    console.log(
      `[ward-refresh] Ballots page ${safetyCounter}: scanned ${results.length}, matched GM ballots ${matchedWardCodes}`
    );
    nextUrl = payload?.next || null;
  }
  console.log(`[ward-refresh] Ballot scan complete: ${byBallotPaperId.size} GM ballot mappings`);

  return byBallotPaperId;
}

async function fetchDemocracyClubWardWinnersByWardCode(allowedWardCodes) {
  let ballotToWardCode = new Map();
  try {
    ballotToWardCode = await fetchDemocracyClubBallotWardCodeMap(allowedWardCodes);
  } catch (error) {
    console.warn(`Warning: ${error.message}. Continuing without Democracy Club ward winners.`);
    return new Map();
  }
  const byWardCode = new Map();
  let nextUrl = `${DEMOCRACY_CLUB_RESULTS_BASE_URL}?${new URLSearchParams({
    election_date: ELECTION_DATE,
    page_size: "200"
  }).toString()}`;
  let safetyCounter = 0;
  let candidateWinnersSeen = 0;
  console.log("[ward-refresh] Fetching Democracy Club results...");

  while (nextUrl && safetyCounter < 100) {
    safetyCounter += 1;
    const payload = await fetchJsonWithRetry(nextUrl, "Democracy Club results");
    const results = Array.isArray(payload?.results) ? payload.results : [];
    for (const result of results) {
      const ballotPaperId = String(result?.ballot?.ballot_paper_id || "");
      const wardCode = ballotToWardCode.get(ballotPaperId);
      if (!wardCode) continue;
      const winnerParty = extractWinnerPartyFromCandidateResults(result?.candidate_results);
      if (!winnerParty) continue;
      candidateWinnersSeen += 1;
      byWardCode.set(wardCode, winnerParty);
    }
    console.log(
      `[ward-refresh] Results page ${safetyCounter}: scanned ${results.length}, winner rows ${candidateWinnersSeen}, unique wards ${byWardCode.size}`
    );
    nextUrl = payload?.next || null;
  }
  console.log(`[ward-refresh] Winner scan complete: ${byWardCode.size} wards with declared winners`);

  return byWardCode;
}

async function fetchCouncillorsCsv() {
  const response = await fetch(COUNCILLORS_CSV_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch councillors CSV (${response.status})`);
  }
  return response.text();
}

async function fetchBbcCouncilResults() {
  const response = await fetch(BBC_COUNCILS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch BBC councils feed (${response.status})`);
  }
  const payload = await response.json();
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  const byLadCode = new Map();

  for (const group of groups) {
    const cards = Array.isArray(group?.cards) ? group.cards : [];
    for (const card of cards) {
      const href = String(card?.href || "");
      const codeMatch = href.match(/\/councils\/([A-Z0-9]+)$/i);
      if (!codeMatch) continue;
      const ladCode = codeMatch[1].toUpperCase();
      const winnerFlash = card?.winnerFlash || null;
      const winnerPartyName = winnerFlash?.partyName || null;
      const winnerPartyCode = winnerFlash?.winnerPartyCode || null;
      const isDeclared = Boolean(winnerFlash && winnerPartyCode);
      byLadCode.set(ladCode, {
        council_name: card?.title || null,
        council_href: href || null,
        council_winner_party: winnerPartyName,
        council_winner_party_code: winnerPartyCode,
        council_result_declared: isDeclared
      });
    }
  }

  return byLadCode;
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
  const shouldFetchDemocracyClubWinners = REFRESH_ALL_WARDS || CHECK_PENDING_WARDS;
  const [councillorsCsv, bbcCouncilResults, democracyClubWardWinnersByCode] = await Promise.all([
    fetchCouncillorsCsv(),
    fetchBbcCouncilResults(),
    shouldFetchDemocracyClubWinners
      ? fetchDemocracyClubWardWinnersByWardCode(wardCodeSet)
      : Promise.resolve(new Map())
  ]);
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
    if (!GM_AUTHORITIES.has(council)) continue;
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
  let matched = 0;
  const declaredCouncilCodes = new Set();
  let declaredWardWinners = 0;
  for (const feature of wardFeatures) {
    const props = feature?.properties || {};
    const wardCode = props.WD24CD;
    const wardName = props.WD24NM;
    const authorityName = props.LAD24NM;
    const authorityCode = props.LAD24CD;
    const key = `${normalizeName(authorityName)}::${normalizeName(wardName)}`;
    const incumbent = byAuthorityWard.get(key);
    const dcWinnerParty = democracyClubWardWinnersByCode.get(String(wardCode || "")) || null;
    const councilResult = bbcCouncilResults.get(String(authorityCode || "").toUpperCase()) || null;
    if (councilResult?.council_result_declared && authorityCode) {
      declaredCouncilCodes.add(String(authorityCode).toUpperCase());
    }
    const existing = existingWardsByCode.get(wardCode) || null;
    if (incumbent) matched += 1;
    const shouldApplyDcWinner = Boolean(dcWinnerParty) && (REFRESH_ALL_WARDS || !existing?.winner_party);
    const finalWinnerParty = shouldApplyDcWinner ? dcWinnerParty : (existing?.winner_party ?? null);
    wards.push({
      ward_code: wardCode,
      ward_name: wardName,
      authority_name: authorityName,
      authority_code: authorityCode,
      incumbent_party: incumbent ? chooseIncumbentParty(incumbent.partyCounts) : "Unknown",
      incumbent_councillors: incumbent ? incumbent.councillors : [],
      winner_party: finalWinnerParty,
      winner_status: finalWinnerParty
        ? "declared"
        : "pending",
      winner_source: shouldApplyDcWinner ? "democracy_club_results_api" : (existing?.winner_source ?? null),
      council_winner_party: councilResult?.council_winner_party ?? null,
      council_winner_party_code: councilResult?.council_winner_party_code ?? null,
      council_result_declared: councilResult?.council_result_declared ?? false,
      council_result_source: councilResult ? "bbc_councils_feed" : null
    });
    if (finalWinnerParty) declaredWardWinners += 1;
  }

  const output = {
    updated_at_utc: new Date().toISOString(),
    sources: {
      wards_geojson: WARDS_GEOJSON_PATH,
      incumbents_csv: COUNCILLORS_CSV_URL,
      bbc_england_councils: BBC_COUNCILS_URL,
      democracy_club_results: shouldFetchDemocracyClubWinners
        ? `${DEMOCRACY_CLUB_RESULTS_BASE_URL}?election_date=${encodeURIComponent(ELECTION_DATE)}`
        : null,
      democracy_club_ballots: shouldFetchDemocracyClubWinners
        ? `${DEMOCRACY_CLUB_BALLOTS_BASE_URL}?election_date=${encodeURIComponent(ELECTION_DATE)}`
        : null
    },
    summary: {
      wards_total: wards.length,
      incumbents_matched: matched,
      incumbents_unmatched: wards.length - matched,
      councils_declared: declaredCouncilCodes.size,
      wards_declared: declaredWardWinners
    },
    wards
  };

  await fs.writeFile(OUTPUT_JSON_PATH, JSON.stringify(output, null, 2));
  return output;
}

const result = await buildElectionState();
console.log(
  `Updated GM ward election state: ${result.summary.incumbents_matched}/${result.summary.wards_total} incumbents matched`
);
console.log(
  REFRESH_ALL_WARDS
    ? `Refreshed ward winners from Democracy Club (${result.summary.wards_declared} declared wards).`
    : `Checked pending wards via Democracy Club (${result.summary.wards_declared} declared wards).`
);
