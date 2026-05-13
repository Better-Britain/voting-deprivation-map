import path from "node:path";
import { projectRoot, updateBuildState, runCommand } from "./lib/pipeline-tools.mjs";

const output = path.resolve(projectRoot, "src/data/ward-census-demographics.json");

await runCommand(process.execPath, [path.resolve(projectRoot, "scripts/build-ward-census-demographics.mjs")], {
  label: "build ward census demographics"
});

await updateBuildState("census_derivatives", {
  last_run_utc: new Date().toISOString(),
  fetch_mode: "derived_rebuild",
  completion_status: "complete",
  dependencies: ["ward_boundaries", "ward_election_current", "ward_election_history", "census_source", "deprivation_source"],
  output_files: [output]
});

console.log("Updated census derivative datasets.");
