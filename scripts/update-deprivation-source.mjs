import path from "node:path";
import { projectRoot, updateSourceManifest, runCommand } from "./lib/pipeline-tools.mjs";

const CATCHMENT_SCRIPT = path.resolve(projectRoot, "deprivation/build_catchment_subset.py");
const TILES_SCRIPT = path.resolve(projectRoot, "deprivation/build_deprivation_tiles.py");
const OUTPUT_GEOJSON = path.resolve(projectRoot, "deprivation/output/england-lsoa-imd-2025.geojson");
const OUTPUT_SUMMARY = path.resolve(projectRoot, "deprivation/output/england-lsoa-imd-2025_summary.json");
const OUTPUT_TILE_MANIFEST = path.resolve(projectRoot, "public/data/england-lsoa-imd-2025_tiles/manifest.json");

await runCommand("python3", [CATCHMENT_SCRIPT], { label: "build deprivation catchment subset" });
await runCommand("python3", [TILES_SCRIPT], { label: "build deprivation tiles" });
await updateSourceManifest("deprivation_source", {
  source_url: [
    "https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025"
  ],
  last_fetch_utc: new Date().toISOString(),
  version_key: "imd-2025",
  fetch_mode: "local_python_build",
  completion_status: "complete",
  output_files: [OUTPUT_GEOJSON, OUTPUT_SUMMARY, OUTPUT_TILE_MANIFEST]
});

console.log("Updated deprivation source datasets.");
