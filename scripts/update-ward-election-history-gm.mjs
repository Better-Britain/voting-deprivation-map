import { updateHistoricalWardElectionState } from "./lib/ward-election-pipeline.mjs";

const forceHistory = /^(1|true|yes)$/i.test(String(process.env.FORCE_REBUILD_HISTORY || ""));
const result = await updateHistoricalWardElectionState({ forceHistory });

console.log(
  forceHistory
    ? `Rebuilt historical ward comparators for ${result.payload.summary.wards_with_previous_local_ballot} wards.`
    : `Checked historical ward comparators; ${result.payload.summary.wards_with_previous_local_ballot} wards have prior locals.`
);
