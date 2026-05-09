import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { area, bbox, featureCollection, intersect } from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const WARDS_GEOJSON_PATH = path.resolve(projectRoot, "src/data/greater-manchester-wards.geojson");
const ELECTION_STATE_PATH = path.resolve(projectRoot, "src/data/greater-manchester-ward-election-state.json");
const DEPRIVATION_GEOJSON_PATH = path.resolve(projectRoot, "deprivation/output/catchment_lsoa_imd_2025.geojson");
const OUTPUT_PATH = path.resolve(projectRoot, "src/data/ward-deprivation-vote-index.json");

function bboxesOverlap(a, b) {
  return !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
}

function emptyDeciles() {
  const out = {};
  for (let d = 1; d <= 10; d += 1) out[String(d)] = 0;
  return out;
}

function rounded(value, dp = 4) {
  return Number(Number(value || 0).toFixed(dp));
}

const [wardsRaw, deprivationRaw, electionRaw] = await Promise.all([
  fs.readFile(WARDS_GEOJSON_PATH, "utf8"),
  fs.readFile(DEPRIVATION_GEOJSON_PATH, "utf8"),
  fs.readFile(ELECTION_STATE_PATH, "utf8")
]);

const wardsGeojson = JSON.parse(wardsRaw);
const deprivationGeojson = JSON.parse(deprivationRaw);
const electionState = JSON.parse(electionRaw);

const wardFeatures = Array.isArray(wardsGeojson?.features) ? wardsGeojson.features : [];
const deprivationFeatures = Array.isArray(deprivationGeojson?.features) ? deprivationGeojson.features : [];
const electionWards = Array.isArray(electionState?.wards) ? electionState.wards : [];
const electionByWardCode = new Map(electionWards.map((row) => [String(row?.ward_code || ""), row]));

const depPreindexed = deprivationFeatures
  .map((feature) => {
    const decile = Number(feature?.properties?.imd_decile);
    if (!Number.isFinite(decile) || decile < 1 || decile > 10) return null;
    return {
      feature,
      decile: String(Math.round(decile)),
      bbox: bbox(feature)
    };
  })
  .filter(Boolean);

const partyDecileArea = new Map();
const wardsOut = [];
let processed = 0;

for (const wardFeature of wardFeatures) {
  processed += 1;
  const props = wardFeature?.properties || {};
  const wardCode = String(props.WD24CD || "");
  const election = electionByWardCode.get(wardCode) || null;
  const winnerParty = election?.winner_party || null;
  const wardBox = bbox(wardFeature);
  const wardArea = area(wardFeature);
  const decileArea = emptyDeciles();

  const candidates = depPreindexed.filter((dep) => bboxesOverlap(wardBox, dep.bbox));
  for (const dep of candidates) {
    const clipped = intersect(featureCollection([wardFeature, dep.feature]));
    if (!clipped) continue;
    const overlapArea = area(clipped);
    if (overlapArea <= 0) continue;
    decileArea[dep.decile] += overlapArea;
  }

  const totalOverlapArea = Object.values(decileArea).reduce((sum, value) => sum + value, 0);
  const denominator = totalOverlapArea > 0 ? totalOverlapArea : wardArea;
  const decileShares = {};
  let weightedMeanDecile = 0;
  let dominantDecile = "n/a";
  let dominantShare = -1;

  for (let d = 1; d <= 10; d += 1) {
    const key = String(d);
    const share = denominator > 0 ? decileArea[key] / denominator : 0;
    decileShares[key] = rounded(share);
    weightedMeanDecile += d * share;
    if (share > dominantShare) {
      dominantShare = share;
      dominantDecile = key;
    }
    if (winnerParty) {
      const byDecile = partyDecileArea.get(winnerParty) || emptyDeciles();
      byDecile[key] += decileArea[key];
      partyDecileArea.set(winnerParty, byDecile);
    }
  }

  wardsOut.push({
    ward_code: wardCode,
    ward_name: props.WD24NM || null,
    authority_name: props.LAD24NM || null,
    winner_party: winnerParty,
    winner_status: election?.winner_status || "pending",
    deprivation_weighted_mean_decile: rounded(weightedMeanDecile, 3),
    deprivation_dominant_decile: dominantDecile,
    deprivation_dominant_share: rounded(dominantShare),
    deprivation_area_share_by_decile: decileShares
  });

  if (processed % 25 === 0 || processed === wardFeatures.length) {
    console.log(`Ward deprivation index progress: ${processed}/${wardFeatures.length}`);
  }
}

const partiesOut = [];
for (const [party, byDecile] of partyDecileArea.entries()) {
  const totalArea = Object.values(byDecile).reduce((sum, v) => sum + v, 0);
  const shareByDecile = {};
  let weightedMeanDecile = 0;
  for (let d = 1; d <= 10; d += 1) {
    const key = String(d);
    const share = totalArea > 0 ? byDecile[key] / totalArea : 0;
    shareByDecile[key] = rounded(share);
    weightedMeanDecile += d * share;
  }
  partiesOut.push({
    party,
    wards_won: wardsOut.filter((w) => w.winner_party === party).length,
    deprivation_weighted_mean_decile: rounded(weightedMeanDecile, 3),
    deprivation_area_share_by_decile: shareByDecile
  });
}
partiesOut.sort((a, b) => b.wards_won - a.wards_won);

const output = {
  updated_at_utc: new Date().toISOString(),
  sources: {
    wards_geojson: WARDS_GEOJSON_PATH,
    deprivation_geojson: DEPRIVATION_GEOJSON_PATH,
    ward_election_state: ELECTION_STATE_PATH
  },
  summary: {
    wards_total: wardsOut.length,
    wards_with_declared_winner: wardsOut.filter((w) => w.winner_party).length
  },
  parties: partiesOut,
  wards: wardsOut
};

await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
console.log(`Updated ward deprivation vote index: ${output.summary.wards_total} wards`);
