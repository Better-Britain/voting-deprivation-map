import path from "node:path";
import { projectRoot, updateBuildState, runCommand } from "./lib/pipeline-tools.mjs";

const outputs = [
  path.resolve(projectRoot, "src/data/ward-deprivation-vote-index.json"),
  path.resolve(projectRoot, "src/data/ward-deprivation-groups.json")
];

await runCommand(process.execPath, [path.resolve(projectRoot, "scripts/build-ward-deprivation-vote-index.mjs")], {
  label: "build ward deprivation vote index"
});
await runCommand(process.execPath, [path.resolve(projectRoot, "scripts/build-ward-deprivation-groups.mjs")], {
  label: "build ward deprivation groups"
});

await updateBuildState("deprivation_derivatives", {
  last_run_utc: new Date().toISOString(),
  fetch_mode: "derived_rebuild",
  completion_status: "complete",
  dependencies: ["ward_boundaries", "ward_election_current", "ward_election_history", "deprivation_source"],
  output_files: outputs
});

console.log("Updated deprivation derivative datasets.");
