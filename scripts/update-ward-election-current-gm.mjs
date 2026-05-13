import { updateCurrentWardElectionState } from "./lib/ward-election-pipeline.mjs";

const forceAllCurrent = /^(1|true|yes)$/i.test(String(process.env.FORCE_REFRESH_ALL_CURRENT || ""));
const result = await updateCurrentWardElectionState({ forceAllCurrent });

if (result.skipped) {
  console.log("Current ward refresh skipped: all ward winners are already declared.");
} else {
  console.log(
    forceAllCurrent
      ? `Refreshed current ward election state for ${result.payload.summary.wards_with_current_ballot_metrics} ward ballots.`
      : `Checked current ward election state; ${result.payload.summary.wards_declared} wards declared.`
  );
}
