import { runCommand } from "./lib/pipeline-tools.mjs";

const forceAllCurrent = /^(1|true|yes)$/i.test(String(process.env.REFRESH_ALL_WARDS || ""));
const forceHistory = /^(1|true|yes)$/i.test(String(process.env.FORCE_REBUILD_HISTORY || ""));

await runCommand(process.execPath, ["./scripts/update-ward-election-current-gm.mjs"], {
  env: forceAllCurrent ? { FORCE_REFRESH_ALL_CURRENT: "1" } : {},
  label: "update current ward election state"
});
await runCommand(process.execPath, ["./scripts/update-ward-election-history-gm.mjs"], {
  env: forceHistory ? { FORCE_REBUILD_HISTORY: "1" } : {},
  label: "update historical ward election state"
});
