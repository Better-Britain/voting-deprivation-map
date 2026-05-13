import path from "node:path";
import { projectRoot, updateSourceManifest, runCommand } from "./lib/pipeline-tools.mjs";

const CENSUS_BUILD_SCRIPT = path.resolve(projectRoot, "census/build_england_census_lsoa_summary.py");
const OUTPUT_JSON = path.resolve(projectRoot, "src/data/england-census-lsoa-summary.json");
const OUTPUT_META = path.resolve(projectRoot, "src/data/england-census-lsoa-summary.meta.json");

await runCommand("python3", [CENSUS_BUILD_SCRIPT], { label: "build census source summary" });
await updateSourceManifest("census_source", {
  source_url: ["https://www.ons.gov.uk/census"],
  last_fetch_utc: new Date().toISOString(),
  version_key: "census-2021-lsoa-summary",
  fetch_mode: "local_python_build",
  completion_status: "complete",
  output_files: [OUTPUT_JSON, OUTPUT_META]
});

console.log("Updated census source datasets.");
