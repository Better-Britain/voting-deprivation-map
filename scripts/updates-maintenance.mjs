import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function runNodeScript(relativeScriptPath) {
  return runNodeScriptWithEnv(relativeScriptPath, {});
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
await runNodeScript("./scripts/build-ward-deprivation-vote-index.mjs");
console.log("Maintenance source updates complete.");
