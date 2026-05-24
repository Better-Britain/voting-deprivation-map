import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.resolve(projectRoot, "src/data/next-ge-forecast.json");
const CURRENT_MEMBER_SEARCH_URL =
  "https://members-api.parliament.uk/api/Members/Search?House=Commons";

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
  if (
    normalized === "labour" ||
    normalized === "labour and co-operative" ||
    normalized === "labour and cooperative" ||
    normalized === "labour and cooperative party" ||
    normalized === "labour and co operative" ||
    normalized === "labour and co operative party" ||
    normalized === "labour co-operative" ||
    normalized === "labour cooperative" ||
    normalized === "labour co operative" ||
    normalized === "labour (co-op)" ||
    normalized === "labour (co-operative)"
  ) return "Labour";
  if (
    normalized === "conservative" ||
    normalized === "conservative and unionist" ||
    normalized === "conservative and unionist party"
  ) return "Conservative";
  if (normalized === "reform uk" || normalized === "reform") return "Reform UK";
  if (
    normalized === "liberal democrat" ||
    normalized === "liberal democrats" ||
    normalized === "lib dem" ||
    normalized === "lib dems"
  ) return "Liberal Democrats";
  if (normalized === "green party" || normalized === "green") return "Green Party";
  if (normalized === "independent") return "Independent";
  return String(value || "").trim() || "Other";
}

async function fetchAllCurrentCommonsMembers() {
  const items = [];
  let skip = 0;
  const take = 200;
  let totalResults = Infinity;

  while (skip < totalResults) {
    const url = `${CURRENT_MEMBER_SEARCH_URL}&skip=${skip}&take=${take}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Commons member request failed: ${response.status}`);
    }
    const payload = await response.json();
    const pageItems = Array.isArray(payload?.items) ? payload.items : [];
    items.push(...pageItems);
    totalResults = Number(payload?.totalResults || items.length);
    skip += pageItems.length || take;
    console.log(`Loaded Commons member page: ${items.length}/${totalResults}`);
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
        constituency_key: normalizeConstituencyName(constituencyName),
        current_member_id: member?.id || null,
        current_member_name: member?.nameDisplayAs || member?.nameFullTitle || null,
        current_party: canonicalPartyName(rawParty),
        current_party_label: rawParty
      };
    })
    .filter(Boolean);
}

const forecastRaw = await fs.readFile(OUTPUT_PATH, "utf8");
const forecast = JSON.parse(forecastRaw);
const members = await fetchAllCurrentCommonsMembers();
const memberByConstituency = new Map(members.map((row) => [row.constituency_key, row]));

let matched = 0;
let unknown = 0;
for (const row of Array.isArray(forecast.current_constituency_states) ? forecast.current_constituency_states : []) {
  const current = memberByConstituency.get(normalizeConstituencyName(row?.constituency_name));
  if (current) {
    row.current_member_id = current.current_member_id;
    row.current_member_name = current.current_member_name;
    row.current_party = current.current_party;
    row.current_party_label = current.current_party_label;
    matched += 1;
  } else {
    row.current_member_id = null;
    row.current_member_name = null;
    row.current_party = null;
    row.current_party_label = null;
    unknown += 1;
  }
}

for (const row of Array.isArray(forecast.constituency_forecasts) ? forecast.constituency_forecasts : []) {
  const current = memberByConstituency.get(normalizeConstituencyName(row?.constituency_name));
  if (current) {
    row.current_member_id = current.current_member_id;
    row.current_member_name = current.current_member_name;
    row.current_party = current.current_party;
    row.current_party_label = current.current_party_label;
    row.seat_status = row?.current_party && row?.forecast?.winner
      ? (row.current_party === row.forecast.winner ? "hold" : "change")
      : row?.seat_status || "unknown";
  } else {
    row.current_member_id = null;
    row.current_member_name = null;
    row.current_party = null;
    row.current_party_label = null;
    row.seat_status = "unknown";
  }
}

forecast.updated_at_utc = new Date().toISOString();
forecast.current_members_updated_at_utc = forecast.updated_at_utc;

await fs.writeFile(OUTPUT_PATH, JSON.stringify(forecast, null, 2));
console.log(`Updated current MP data for ${matched} constituencies; ${unknown} remain unknown.`);
