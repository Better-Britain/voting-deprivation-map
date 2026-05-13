import path from "node:path";
import { projectRoot, snapshotFiles, snapshotsDiffer, runCommand, updateBuildState } from "./lib/pipeline-tools.mjs";

function script(relativePath) {
  return path.resolve(projectRoot, relativePath);
}

async function runNodeStep(id, relativePath, outputs, env = {}) {
  const before = await snapshotFiles(outputs);
  await runCommand(process.execPath, [script(relativePath)], {
    cwd: projectRoot,
    env,
    label: id
  });
  const after = await snapshotFiles(outputs);
  const changed = snapshotsDiffer(before, after);
  console.log(`[maintenance] ${id}: ${changed ? "changed" : "unchanged"}`);
  return changed;
}

const wardsChanged = await runNodeStep("ward boundaries", "scripts/update-wards-gm.mjs", [
  path.resolve(projectRoot, "src/data/england-wards.geojson"),
  path.resolve(projectRoot, "src/data/england-wards.summary.json")
]);

const councilsChanged = await runNodeStep("councils", "scripts/update-councils-gm.mjs", [
  path.resolve(projectRoot, "src/data/england-councils.geojson"),
  path.resolve(projectRoot, "src/data/england-councils.summary.json")
]);

const electionCurrentChanged = await runNodeStep("current ward election state", "scripts/update-ward-election-current-gm.mjs", [
  path.resolve(projectRoot, "src/data/england-ward-election-state.json")
], /^(1|true|yes)$/i.test(String(process.env.FORCE_REFRESH_ALL_CURRENT || "")) ? { FORCE_REFRESH_ALL_CURRENT: "1" } : {});

const electionHistoryChanged = await runNodeStep("historical ward election state", "scripts/update-ward-election-history-gm.mjs", [
  path.resolve(projectRoot, "src/data/england-ward-election-state.json")
], /^(1|true|yes)$/i.test(String(process.env.FORCE_REBUILD_HISTORY || "")) ? { FORCE_REBUILD_HISTORY: "1" } : {});

const deprivationSourceChanged = await runNodeStep("deprivation source", "scripts/update-deprivation-source.mjs", [
  path.resolve(projectRoot, "deprivation/output/england-lsoa-imd-2025.geojson"),
  path.resolve(projectRoot, "deprivation/output/england-lsoa-imd-2025_summary.json"),
  path.resolve(projectRoot, "public/data/england-lsoa-imd-2025_tiles/manifest.json")
]);

const censusSourceChanged = await runNodeStep("census source", "scripts/update-census-source.mjs", [
  path.resolve(projectRoot, "src/data/england-census-lsoa-summary.json"),
  path.resolve(projectRoot, "src/data/england-census-lsoa-summary.meta.json")
]);

const shouldRunDeprivationDerivatives = wardsChanged || electionCurrentChanged || electionHistoryChanged || deprivationSourceChanged;
if (shouldRunDeprivationDerivatives) {
  await runNodeStep("deprivation derivatives", "scripts/run-deprivation-derivatives.mjs", [
    path.resolve(projectRoot, "src/data/ward-deprivation-vote-index.json"),
    path.resolve(projectRoot, "src/data/ward-deprivation-groups.json")
  ]);
} else {
  await updateBuildState("deprivation_derivatives", {
    last_run_utc: new Date().toISOString(),
    fetch_mode: "derived_skip",
    completion_status: "skipped_unchanged_inputs",
    dependencies: ["ward_boundaries", "ward_election_current", "ward_election_history", "deprivation_source"]
  });
  console.log("[maintenance] deprivation derivatives: skipped");
}

const shouldRunCensusDerivatives = wardsChanged || electionCurrentChanged || electionHistoryChanged || deprivationSourceChanged || censusSourceChanged;
if (shouldRunCensusDerivatives) {
  await runNodeStep("census derivatives", "scripts/run-census-derivatives.mjs", [
    path.resolve(projectRoot, "src/data/ward-census-demographics.json")
  ]);
} else {
  await updateBuildState("census_derivatives", {
    last_run_utc: new Date().toISOString(),
    fetch_mode: "derived_skip",
    completion_status: "skipped_unchanged_inputs",
    dependencies: ["ward_boundaries", "ward_election_current", "ward_election_history", "census_source", "deprivation_source"]
  });
  console.log("[maintenance] census derivatives: skipped");
}

const shouldRunGpImport = wardsChanged || electionCurrentChanged || electionHistoryChanged;
if (shouldRunGpImport) {
  await runNodeStep("gp import", "scripts/run-gp-import.mjs", [
    path.resolve(projectRoot, "src/data/england-gp-practices.json"),
    path.resolve(projectRoot, "src/data/ward-gp-ratings.json")
  ]);
} else {
  await updateBuildState("gp_import", {
    last_run_utc: new Date().toISOString(),
    fetch_mode: "derived_skip",
    completion_status: "skipped_unchanged_inputs",
    dependencies: ["ward_boundaries", "ward_election_current", "ward_election_history"]
  });
  console.log("[maintenance] gp import: skipped");
}

console.log("Maintenance source updates complete.");
