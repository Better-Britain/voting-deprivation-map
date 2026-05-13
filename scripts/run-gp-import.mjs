import path from "node:path";
import { projectRoot, updateBuildState, runCommand } from "./lib/pipeline-tools.mjs";

const outputs = [
  path.resolve(projectRoot, "src/data/england-gp-practices.json"),
  path.resolve(projectRoot, "src/data/ward-gp-ratings.json")
];

await runCommand(process.execPath, [path.resolve(projectRoot, "scripts/import-gp-ratings-from-nhs.mjs")], {
  label: "import GP ratings from NHS project"
});

await updateBuildState("gp_import", {
  last_run_utc: new Date().toISOString(),
  fetch_mode: "derived_rebuild",
  completion_status: "complete",
  dependencies: ["ward_boundaries", "ward_election_current", "ward_election_history"],
  output_files: outputs
});

console.log("Updated GP import datasets.");
