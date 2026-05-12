import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const RESULTS_URL = process.env.RESULTS_URL || "https://www.bbc.co.uk/news/election/2026/england/results";
const ENGINE = String(process.env.BROWSER_ENGINE || "firefox").toLowerCase();
const PROFILE_PATH = process.env.BROWSER_PROFILE_PATH || "";

const ELECTION_STATE_PATH = path.resolve(projectRoot, "src/data/england-ward-election-state.json");
const CAPTURE_DEBUG_PATH = path.resolve(projectRoot, "src/data/manual-election-capture.json");

const PARTY_LOOKUP = {
  lab: "Labour",
  labour: "Labour",
  con: "Conservative and Unionist",
  conservative: "Conservative and Unionist",
  libdem: "Liberal Democrats",
  "lib dem": "Liberal Democrats",
  liberal: "Liberal Democrats",
  green: "Green Party",
  reform: "Reform UK",
  ukip: "UK Independence Party (UKIP)",
  independent: "Independent"
};

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeParty(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  for (const [key, party] of Object.entries(PARTY_LOOKUP)) {
    if (normalized === key || normalized.includes(key)) return party;
  }
  return raw;
}

function extractWinnerCandidatesFromJsonObject(node, bucket) {
  if (!node || typeof node !== "object") return;

  const wardName =
    node.wardName || node.ward_name || node.ward || node.division || node.post_name || node.postName;
  const winnerPartyRaw =
    node.winnerParty ||
    node.winningParty ||
    node.winner_party ||
    node.leadingParty ||
    node.leading_party ||
    null;
  const declared =
    node.declared === true ||
    node.isDeclared === true ||
    node.resultStatus === "declared" ||
    node.status === "declared";

  if (wardName && winnerPartyRaw && declared) {
    bucket.push({
      wardName: String(wardName).trim(),
      winnerParty: normalizeParty(winnerPartyRaw),
      source: "json"
    });
  }

  if (Array.isArray(node)) {
    for (const item of node) extractWinnerCandidatesFromJsonObject(item, bucket);
    return;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      extractWinnerCandidatesFromJsonObject(value, bucket);
    }
  }
}

function extractWinnerCandidatesFromDomRows(rows) {
  const out = [];
  const winnerRegexes = [
    /winner[:\s-]+([a-z][a-z\s&-]{2,})/i,
    /\bwon by\s+([a-z][a-z\s&-]{2,})/i,
    /\b([a-z][a-z\s&-]{2,})\s+hold\b/i,
    /\b([a-z][a-z\s&-]{2,})\s+gain\b/i
  ];
  for (const row of rows) {
    const text = String(row || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const wardMatch = text.match(/^([A-Za-z0-9][A-Za-z0-9 '&().-]{3,50})\s+[|:-]/);
    if (!wardMatch) continue;
    let party = null;
    for (const rx of winnerRegexes) {
      const m = text.match(rx);
      if (m?.[1]) {
        party = normalizeParty(m[1]);
        break;
      }
    }
    if (!party) continue;
    out.push({
      wardName: wardMatch[1].trim(),
      winnerParty: party,
      source: "dom"
    });
  }
  return out;
}

function dedupeCandidates(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const wardKey = normalizeName(candidate.wardName);
    const partyKey = normalizeName(candidate.winnerParty);
    if (!wardKey || !partyKey) continue;
    byKey.set(`${wardKey}::${partyKey}`, candidate);
  }
  return Array.from(byKey.values());
}

function matchWinnerCandidatesToState(wardStatePayload, candidates) {
  const wards = Array.isArray(wardStatePayload?.wards) ? wardStatePayload.wards : [];
  const wardNameIndex = new Map();
  for (const ward of wards) {
    const key = normalizeName(ward.ward_name);
    if (!key) continue;
    if (!wardNameIndex.has(key)) wardNameIndex.set(key, []);
    wardNameIndex.get(key).push(ward);
  }

  let updates = 0;
  for (const candidate of candidates) {
    const wardMatches = wardNameIndex.get(normalizeName(candidate.wardName)) || [];
    if (wardMatches.length !== 1) continue;
    const target = wardMatches[0];
    target.winner_party = candidate.winnerParty;
    target.winner_status = "declared";
    target.winner_source = candidate.source;
    updates += 1;
  }
  return updates;
}

const browserType = ENGINE === "chromium" ? chromium : firefox;
const profileDir = PROFILE_PATH || (await fs.mkdtemp(path.join(os.tmpdir(), "voter-deprivation-profile-")));
const useTempProfile = !PROFILE_PATH;

const context = await browserType.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 960 }
});

const page = context.pages()[0] || (await context.newPage());
const capturedPayloads = [];
const capturedEndpoints = new Map();

context.on("response", async (response) => {
  try {
    const url = response.url();
    const lowerUrl = url.toLowerCase();
    const contentType = String(response.headers()["content-type"] || "").toLowerCase();
    const looksInterestingUrl =
      lowerUrl.includes("election") ||
      lowerUrl.includes("result") ||
      lowerUrl.includes("ward") ||
      lowerUrl.includes("constituency") ||
      lowerUrl.includes("map") ||
      lowerUrl.includes("graphql");
    const isLikelyDataPayload =
      contentType.includes("json") ||
      contentType.includes("javascript") ||
      contentType.includes("geojson");
    if (!looksInterestingUrl && !isLikelyDataPayload) return;
    const bodyText = await response.text();
    if (!bodyText || bodyText.length > 3_000_000) return;
    capturedPayloads.push({
      url,
      status: response.status(),
      contentType,
      bodyText
    });
    capturedEndpoints.set(url, {
      url,
      status: response.status(),
      contentType
    });
  } catch (_error) {
    // Ignore parse issues from cross-origin/protocol anomalies.
  }
});

async function nudgeDynamicLoading(targetPage) {
  await targetPage.waitForTimeout(1200);
  await targetPage.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxScroll = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const steps = 10;
    for (let i = 0; i < steps; i += 1) {
      const y = Math.floor((maxScroll * i) / Math.max(steps - 1, 1));
      window.scrollTo({ top: y, behavior: "instant" });
      await wait(180);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await targetPage.waitForTimeout(1200);
}

await page.goto(RESULTS_URL, { waitUntil: "domcontentloaded" });
await nudgeDynamicLoading(page);
console.log(`Opened ${RESULTS_URL}`);
console.log("Auto-scrolled to trigger dynamic loading. Manually navigate/filter to ward results, then return here.");

const rl = readline.createInterface({ input, output });
await rl.question("Press Enter when the page is showing current declared winners... ");
rl.close();

const domRows = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll("li, tr, article, section, div"));
  const texts = [];
  for (const node of candidates) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 20 || text.length > 240) continue;
    if (!/(winner|won|gain|hold|declared|ward)/i.test(text)) continue;
    texts.push(text);
  }
  return texts.slice(0, 5000);
});

const jsonCandidates = [];
for (const payload of capturedPayloads) {
  try {
    const parsed = JSON.parse(payload.bodyText);
    extractWinnerCandidatesFromJsonObject(parsed, jsonCandidates);
  } catch (_error) {
    const possibleJsonBlocks = payload.bodyText.match(/\{[\s\S]{250,}\}/g) || [];
    for (const block of possibleJsonBlocks.slice(0, 30)) {
      try {
        const parsed = JSON.parse(block);
        extractWinnerCandidatesFromJsonObject(parsed, jsonCandidates);
      } catch (_innerError) {
        // Ignore non-JSON block.
      }
    }
  }
}

const embeddedScriptCandidates = await page.evaluate(() => {
  const scriptTexts = [];
  const scripts = Array.from(document.querySelectorAll("script"));
  for (const script of scripts) {
    const text = (script.textContent || "").trim();
    if (!text || text.length < 200 || text.length > 2_000_000) continue;
    if (!/(winner|declared|ward|result)/i.test(text)) continue;
    scriptTexts.push(text);
  }
  return scriptTexts.slice(0, 120);
});
for (const scriptText of embeddedScriptCandidates) {
  try {
    const parsed = JSON.parse(scriptText);
    extractWinnerCandidatesFromJsonObject(parsed, jsonCandidates);
  } catch (_error) {
    // Ignore.
  }
}
const domCandidates = extractWinnerCandidatesFromDomRows(domRows);
const winnerCandidates = dedupeCandidates([...jsonCandidates, ...domCandidates]);

const wardStateRaw = await fs.readFile(ELECTION_STATE_PATH, "utf8");
const wardStatePayload = JSON.parse(wardStateRaw);
const updatedCount = matchWinnerCandidatesToState(wardStatePayload, winnerCandidates);

await fs.writeFile(ELECTION_STATE_PATH, JSON.stringify(wardStatePayload, null, 2));
await fs.writeFile(
  CAPTURE_DEBUG_PATH,
  JSON.stringify(
    {
      captured_at_utc: new Date().toISOString(),
      source_url: RESULTS_URL,
      engine: ENGINE,
      payload_capture_count: capturedPayloads.length,
      discovered_endpoints: Array.from(capturedEndpoints.values()).slice(0, 200),
      candidate_count: winnerCandidates.length,
      updated_wards: updatedCount,
      candidates: winnerCandidates
    },
    null,
    2
  )
);

console.log(`Captured candidates: ${winnerCandidates.length}`);
console.log(`Updated declared winners: ${updatedCount}`);
console.log(`Debug capture written to: ${CAPTURE_DEBUG_PATH}`);

await context.close();
if (useTempProfile) {
  await fs.rm(profileDir, { recursive: true, force: true });
}
