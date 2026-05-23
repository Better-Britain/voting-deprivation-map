import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const INPUT_PATH = path.resolve(projectRoot, "src/data/next-ge-forecast.json");
const OUTPUT_PATH = path.resolve(projectRoot, "public/voting-charts/reform-label-trap-report.md");

const STORY_LABELS = {
  Conservative: "Tory incumbent",
  Labour: "Labour incumbent",
  "Liberal Democrats": "Liberal Democrat seat",
  "Green Party": "Green seat"
};

const BIG_NAME_HINTS = new Set([
  "Angela Rayner",
  "Wendy Morton",
  "Josh Simons",
  "Linsey Farnsworth"
]);

function formatPercent(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${(number * 100).toFixed(digits)}%`;
}

function formatNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toFixed(digits);
}

function currentStoryLabel(row) {
  const baseLabel = STORY_LABELS[row.current_party] || row.current_party || "Unknown";
  if (row.current_party === "Labour" && BIG_NAME_HINTS.has(row.current_member_name || "")) {
    return "Labour big-name";
  }
  return baseLabel;
}

function reformWardShare(row) {
  const tally = row?.forecast?.ward_winner_tally || {};
  const total = Object.values(tally).reduce((sum, value) => sum + Number(value || 0), 0);
  const reform = Number(tally["Reform UK"] || 0);
  return total > 0 ? reform / total : 0;
}

function rank(row) {
  const share = reformWardShare(row);
  const confidence = Number(row?.forecast?.confidence || 0);
  return [
    -share,
    -confidence,
    row?.constituency_name || ""
  ];
}

async function main() {
  const payload = JSON.parse(await fs.readFile(INPUT_PATH, "utf8"));
  const rows = Array.isArray(payload?.constituency_forecasts) ? payload.constituency_forecasts : [];

  const matches = rows
    .filter((row) => row?.forecast?.winner === "Reform UK")
    .filter((row) => ["Liberal Democrats", "Green Party", "Conservative", "Labour"].includes(row?.current_party))
    .map((row) => ({
      ...row,
      story_label: currentStoryLabel(row),
      reform_share: reformWardShare(row)
    }))
    .filter((row) => row.reform_share >= 0.75)
    .sort((a, b) => {
      const aRank = rank(a);
      const bRank = rank(b);
      for (let index = 0; index < aRank.length; index += 1) {
        if (aRank[index] < bRank[index]) return -1;
        if (aRank[index] > bRank[index]) return 1;
      }
      return 0;
    });

  const generatedAt = new Date().toISOString();
  const report = [
    "# Where the label is wrong",
    "",
    "This is a narrow special report.",
    "",
    "It looks for constituencies where the public-facing label still reads as a Liberal Democrat, Green, Tory incumbent, or Labour incumbent / big-name seat, but the ward-level forecast is already overwhelmingly Reform.",
    "",
    `Generated from \`src/data/next-ge-forecast.json\` at \`${generatedAt}\`.`,
    "",
    `Filter used: forecast winner = \`Reform UK\`, current label in \`Conservative\` / \`Labour\` / \`Liberal Democrats\` / \`Green Party\`, and Reform takes at least \`75%\` of the weighted ward winner tally.`,
    "",
    `Matches found: \`${matches.length}\`.`,
    "",
    "## Constituencies",
    "",
    "| Constituency | Public-facing story | Current MP | Forecast winner | Reform ward mix | Reform ward tally | Forecast lead |",
    "|---|---|---|---|---:|---:|---:|"
  ];

  for (const row of matches) {
    const reformShare = formatPercent(row.reform_share, 1);
    const reformTally = formatNumber(row?.forecast?.ward_winner_tally?.["Reform UK"] || 0, 3);
    const lead = Number(row?.forecast?.confidence || 0);
    const currentMp = row.current_member_name ? `${row.current_member_name} (${row.current_party || "n/a"})` : row.current_party || "n/a";
    report.push(
      `| ${row.constituency_name} | ${row.story_label} | ${currentMp} | ${row.forecast?.winner || "n/a"} | ${reformShare} | ${reformTally} | ${formatPercent(lead, 1)} |`
    );
  }

  report.push(
    "",
    "## Read",
    "",
    "- This is not saying the constituency has no local story left.",
    "- It is saying the ward-level aggregation already behaves like a Reform seat even when the current label still points elsewhere.",
    "- The market risk is assuming the visible incumbent brand is the decisive signal when the ward mix is already telling a different story.",
    "",
    "## Notes",
    "",
    "- `Reform ward tally` is the weighted sum of ward-level wins inside the constituency forecast.",
    "- `Reform ward mix` is that tally as a share of all weighted ward wins used in the roll-up.",
    "- `Forecast lead` is the gap between the top two model scores, shown as a percentage-point style lead for readability.",
    ""
  );

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${report.join("\n")}\n`, "utf8");
  console.log(`Wrote ${matches.length} constituencies to ${OUTPUT_PATH}`);
}

await main();
