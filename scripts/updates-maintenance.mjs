import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function runNodeScript(relativeScriptPath) {
  return runNodeScriptWithEnv(relativeScriptPath, {});
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env
      }
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
      }
    });
  });
}

function runNodeScriptWithEnv(relativeScriptPath, envOverrides) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(projectRoot, relativeScriptPath)], {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        ...envOverrides
      }
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${relativeScriptPath} failed with exit code ${code}`));
      }
    });
  });
}

const refreshAllWards = process.argv.includes("--refresh-all-wards");

// Maintenance updates source datasets only. Build remains separate.
await runNodeScript("./scripts/update-wards-gm.mjs");
await runNodeScript("./scripts/update-councils-gm.mjs");
await runNodeScriptWithEnv("./scripts/update-ward-election-state-gm.mjs", {
  REFRESH_ALL_WARDS: refreshAllWards ? "1" : "0",
  CHECK_PENDING_WARDS: "1"
});
await runCommand("python3", ["./deprivation/build_catchment_subset.py"]);
await runCommand("python3", ["./census/build_england_census_lsoa_summary.py"]);
await runCommand("python3", ["./deprivation/build_deprivation_tiles.py"]);
await runNodeScript("./scripts/build-ward-deprivation-vote-index.mjs");
await runNodeScript("./scripts/build-ward-deprivation-groups.mjs");
await runNodeScript("./scripts/build-ward-census-demographics.mjs");
await runNodeScript("./scripts/import-gp-ratings-from-nhs.mjs");
console.log("Maintenance source updates complete.");
