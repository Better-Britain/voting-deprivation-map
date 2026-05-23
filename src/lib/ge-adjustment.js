const PARTY_PRIORS = {
  Labour: 1.02,
  Conservative: 0.94,
  "Reform UK": 1.08,
  "Liberal Democrats": 0.88,
  "Green Party": 0.84,
  Independent: 1.0
};

const GE_ADJUSTMENT_BLEND = 0.1;

function normalizePartyName(value) {
  return String(value || "").trim().toLowerCase();
}

export function partyFamilyName(value) {
  const normalized = normalizePartyName(value);
  if (
    normalized === "labour" ||
    normalized === "labour and co-operative" ||
    normalized === "labour and cooperative" ||
    normalized === "labour and cooperative party" ||
    normalized === "labour and co operative" ||
    normalized === "labour and co operative party" ||
    normalized === "labour co-operative" ||
    normalized === "labour cooperative" ||
    normalized === "labour co operative" ||
    normalized === "labour (co-op)" ||
    normalized === "labour (co-operative)"
  ) return "Labour";
  if (normalized === "conservative" || normalized === "conservative and unionist" || normalized === "conservative and unionist party") return "Conservative";
  if (normalized === "reform uk" || normalized === "reform") return "Reform UK";
  if (normalized === "liberal democrat" || normalized === "liberal democrats" || normalized === "lib dem" || normalized === "lib dems") return "Liberal Democrats";
  if (normalized === "green party" || normalized === "green") return "Green Party";
  if (normalized === "independent") return "Independent";
  return String(value || "").trim() || "Other";
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getGeAdjustmentPrior(party) {
  return PARTY_PRIORS[partyFamilyName(party)] ?? 1.0;
}

export function adjustPartyProbabilities(scoreByParty) {
  const priorAdjusted = Object.fromEntries(
    Object.entries(scoreByParty || {}).map(([party, score]) => [
      party,
      Math.max(0, safeNumber(score)) * getGeAdjustmentPrior(party)
    ])
  );

  const priorTotal = Object.values(priorAdjusted).reduce((sum, value) => sum + value, 0) || 1;
  for (const party of Object.keys(priorAdjusted)) {
    priorAdjusted[party] /= priorTotal;
  }

  const raw = Object.fromEntries(
    Object.entries(scoreByParty || {}).map(([party, score]) => [party, Math.max(0, safeNumber(score))])
  );
  const rawTotal = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  for (const party of Object.keys(raw)) raw[party] /= rawTotal;

  const adjusted = {};
  for (const party of Object.keys(raw)) {
    adjusted[party] =
      (raw[party] * (1 - GE_ADJUSTMENT_BLEND)) +
      ((priorAdjusted[party] || 0) * GE_ADJUSTMENT_BLEND);
  }

  const ranked = Object.entries(adjusted).sort((a, b) => Number(b[1]) - Number(a[1]));
  const winner = ranked[0]?.[0] || null;
  const runner_up = ranked[1]?.[0] || null;
  const winner_probability = Number(ranked[0]?.[1] || 0);
  const runner_up_probability = Number(ranked[1]?.[1] || 0);

  return {
    score_by_party: adjusted,
    winner,
    runner_up,
    winner_probability,
    runner_up_probability,
    confidence: Math.max(0, winner_probability - runner_up_probability)
  };
}

export function adjustConstituencyRow(row) {
  const rawForecast = row?.forecast || {};
  const adjustedForecast = adjustPartyProbabilities(rawForecast.score_by_party || {});
  const currentParty = row?.current_party || null;
  const currentFamily = partyFamilyName(currentParty);
  const winnerFamily = partyFamilyName(adjustedForecast.winner);
  const seatStatus = currentParty && adjustedForecast.winner
    ? (currentFamily === winnerFamily ? "hold" : "change")
    : row?.seat_status || "unknown";

  return {
    ...row,
    forecast_party: adjustedForecast.winner,
    runner_up: adjustedForecast.runner_up,
    gap: adjustedForecast.confidence,
    seat_status: seatStatus,
    forecast: {
      ...rawForecast,
      ...adjustedForecast,
      mode: "ge-adjusted"
    }
  };
}

export function buildConstituencyView(data, geAdjusted = false) {
  if (!geAdjusted) return data;

  const constituencyRows = Array.isArray(data?.constituency_forecasts)
    ? data.constituency_forecasts.map((row) => adjustConstituencyRow(row))
    : [];

  const partySeatTotals = {};
  let holds = 0;
  let changes = 0;
  let unknown = 0;

  for (const row of constituencyRows) {
    const winner = row?.forecast?.winner || null;
    if (winner) {
      partySeatTotals[winner] = (partySeatTotals[winner] || 0) + 1;
    }

    if (!row?.current_party) {
      unknown += 1;
    } else if (row.seat_status === "hold") {
      holds += 1;
    } else if (row.seat_status === "change") {
      changes += 1;
    } else {
      unknown += 1;
    }
  }

  return {
    ...data,
    constituency_forecasts: constituencyRows,
    party_seat_totals: partySeatTotals,
    summary: {
      ...(data?.summary || {}),
      constituency_holds: holds,
      constituency_changes: changes,
      constituency_unknown: unknown
    }
  };
}
