import { buildConstituencyView } from "./lib/ge-adjustment.js";
import { partyFamilyName } from "./lib/ge-adjustment.js";

const FORECAST_URL = new URL("./data/next-ge-forecast.json", import.meta.url).href;

const PARTY_COLORS = {
  Labour: "#e4003b",
  Conservative: "#0087dc",
  "Reform UK": "#12b6cf",
  "Liberal Democrats": "#faa61a",
  "Green Party": "#6ab023",
  Independent: "#9ca3af"
};

const METRIC_DEFINITIONS = [
  {
    label: "Constituencies",
    getValue: (data) => Number(data?.summary?.constituencies_total || 0)
  },
  {
    label: "Wards",
    getValue: (data) => Number(data?.summary?.wards_total || 0)
  },
  {
    label: "Leading party",
    getValue: (data) => {
      const entries = Object.entries(data?.party_seat_totals || {});
      return entries.sort((a, b) => Number(b[1]) - Number(a[1]))[0] || null;
    }
  },
  {
    label: "Tight seats",
    getValue: (data) => {
      const rows = Array.isArray(data?.constituency_forecasts) ? data.constituency_forecasts : [];
      return rows.filter((row) => Number(row?.forecast?.confidence || 0) <= 0.12).length;
    }
  }
];

const constituencyPartySelect = document.getElementById("constituency-party-select");
const wardPartySelect = document.getElementById("ward-party-select");
const constituencyTable = document.getElementById("constituency-table");
const wardTable = document.getElementById("ward-table");
const constituencySummary = document.getElementById("constituency-summary");
const wardSummary = document.getElementById("ward-summary");
const constituencyTableToggle = document.getElementById("constituency-table-toggle");
const constituencyTableToggleLabel = document.getElementById("constituency-table-toggle-label");
const forecastMetrics = document.getElementById("forecast-metrics");
const forecastSeatBars = document.getElementById("forecast-seat-bars");
const currentSeatBars = document.getElementById("current-seat-bars");
const forecastAssumptions = document.getElementById("forecast-assumptions");
const forecastUpdated = document.getElementById("forecast-updated");
const modelNotes = document.getElementById("model-notes");
const geAdjustmentToggle = document.getElementById("ge-adjustment-toggle");
const geAdjustmentState = document.getElementById("ge-adjustment-state");

let forecastData = null;
let forecastViewData = null;
let selectedConstituencyParty = "All";
let selectedWardParty = "All";
let geAdjustedMode = false;
let constituencyTableExpanded = false;

function formatNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  return `${(num * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(digits)}pp`;
}

function formatOdds(value, digits = 1) {
  const prob = Number(value);
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return "n/a";
  const ratio = prob >= 0.5 ? prob / (1 - prob) : (1 - prob) / prob;
  if (Math.abs(ratio - 1) < 0.15) return "evens";
  const rounded = Math.max(0.5, Math.round(ratio * 2) / 2);
  const display = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(digits);
  return prob >= 0.5 ? `${display}:1` : `1:${display}`;
}

function partyColor(party) {
  return PARTY_COLORS[partyFamilyName(party)] || "#9aa0a6";
}

function getSortedPartyEntries(mapLike) {
  return Object.entries(mapLike || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
}

function renderMetrics(data) {
  if (!forecastMetrics) return;
  const constituencies = Array.isArray(data?.constituency_forecasts) ? data.constituency_forecasts : [];
  const leadingPartyEntry = getSortedPartyEntries(data?.party_seat_totals || {})[0] || ["n/a", 0];
  const medianConfidence = constituencies.length
    ? [...constituencies]
      .map((row) => Number(row?.forecast?.winner_probability || 0))
      .sort((a, b) => a - b)[Math.floor(constituencies.length / 2)]
    : null;
  const tightSeats = constituencies.filter((row) => Number(row?.forecast?.confidence || 0) <= 0.12).length;
  const contestedWards = (Array.isArray(data?.ward_forecasts) ? data.ward_forecasts : []).filter(
    (row) => Number(row?.confidence || 0) <= 0.12
  ).length;
  const holdSeats = Number(data?.summary?.constituency_holds || 0);
  const changeSeats = Number(data?.summary?.constituency_changes || 0);

  const metrics = [
    {
      label: geAdjustedMode ? "GE-adjusted seats" : "Projected seats",
      value: formatNumber(leadingPartyEntry[1]),
      note: leadingPartyEntry[0]
    },
    {
      label: "Holds",
      value: formatNumber(holdSeats),
      note: "stay with current party"
    },
    {
      label: "Changes",
      value: formatNumber(changeSeats),
      note: "flip vs current party"
    },
    {
      label: "Tight constituencies",
      value: formatNumber(tightSeats),
      note: "confidence <= 0.12"
    },
    {
      label: "Median constituency odds",
      value: medianConfidence === null ? "n/a" : formatOdds(medianConfidence, 1),
      note: "simple odds for the forecast winner"
    }
  ];

  forecastMetrics.innerHTML = metrics.map((metric) => `
    <article class="metric-card">
      <div class="metric-label">${metric.label}</div>
      <div class="metric-value">${metric.value}</div>
      <div class="metric-note">${metric.note}</div>
    </article>
  `).join("");
}

function renderSeatBars(data) {
  if (!forecastSeatBars) return;
  const totals = data?.party_seat_totals || {};
  const entries = getSortedPartyEntries(totals);
  const sum = entries.reduce((acc, [, value]) => acc + Number(value || 0), 0) || 1;
  forecastSeatBars.innerHTML = `
    <p class="panel-note">${geAdjustedMode
      ? "This is the GE-adjusted seat total, after a small party-level correction for the different electorate at general elections."
      : "These are total forecast winners across all 543 constituencies, not net gains or losses."}</p>
    <div class="stacked-bars">
      ${entries.map(([party, value]) => {
        const width = (Number(value || 0) / sum) * 100;
        return `
          <div class="stacked-row">
            <div class="stacked-label">${party} (${formatNumber(value)})</div>
            <div class="stacked-track" aria-label="${party} seat share ${formatPercent(Number(value || 0) / sum, 1)}">
              <div class="stacked-segment" style="width:${width}%; background:${partyColor(party)}"></div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCurrentSeatBars(data) {
  if (!currentSeatBars) return;
  const rows = Array.isArray(data?.constituency_forecasts) ? data.constituency_forecasts : [];
  const totals = {};
  for (const row of rows) {
    const party = row?.current_party || "Unknown";
    totals[party] = (totals[party] || 0) + 1;
  }
  const entries = getSortedPartyEntries(totals);
  const sum = entries.reduce((acc, [, value]) => acc + Number(value || 0), 0) || 1;
  currentSeatBars.innerHTML = `
    <p class="panel-note">This is the current seat distribution from the existing MP data. Labour (Co-op) is shown separately because it is a distinct current label in the source data.</p>
    <div class="stacked-bars">
      ${entries.map(([party, value]) => {
        const width = (Number(value || 0) / sum) * 100;
        return `
          <div class="stacked-row">
            <div class="stacked-label">${party} (${formatNumber(value)})</div>
            <div class="stacked-track" aria-label="${party} current seats ${formatPercent(Number(value || 0) / sum, 1)}">
              <div class="stacked-segment" style="width:${width}%; background:${partyColor(party)}"></div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function populatePartySelect(selectEl, entries, currentValue) {
  if (!selectEl) return;
  const options = ["All", ...entries.map(([party]) => party)];
  selectEl.innerHTML = options.map((value) => `
    <option value="${value}" ${value === currentValue ? "selected" : ""}>${value}</option>
  `).join("");
}

function renderTable(container, rows, columns, emptyMessage) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<p class="panel-note">${emptyMessage}</p>`;
    return;
  }

  const header = columns.map((column) => `<th>${column.label}</th>`).join("");
  const body = rows.map((row) => `
    <tr>
      ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
    </tr>
  `).join("");

  container.innerHTML = `
    <table class="simple-table forecast-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function getConstituencyRows() {
  const rows = Array.isArray(forecastViewData?.constituency_forecasts) ? [...forecastViewData.constituency_forecasts] : [];
  const filtered = selectedConstituencyParty === "All"
    ? rows
    : rows.filter((row) => row?.forecast?.winner === selectedConstituencyParty);
  return filtered.sort((a, b) => Number(b?.forecast?.winner_probability || 0) - Number(a?.forecast?.winner_probability || 0));
}

function getWardRows() {
  const rows = Array.isArray(forecastData?.ward_forecasts) ? [...forecastData.ward_forecasts] : [];
  const filtered = selectedWardParty === "All"
    ? rows
    : rows.filter((row) => row?.winner === selectedWardParty);
  return filtered.sort((a, b) => Number(b?.winner_probability || 0) - Number(a?.winner_probability || 0));
}

function renderConstituencyTable() {
  const rows = getConstituencyRows();
  const holdCount = rows.filter((row) => row?.seat_status === "hold").length;
  const changeCount = rows.filter((row) => row?.seat_status === "change").length;
  const tightCount = rows.filter((row) => Number(row?.forecast?.confidence || 0) <= 0.12).length;
  constituencySummary.textContent = constituencyTableExpanded
    ? `${formatNumber(rows.length)} constituencies shown, sorted by odds.${geAdjustedMode ? " GE-adjusted view." : " Raw local view."}`
    : `${formatNumber(rows.length)} constituencies match the filter. ${formatNumber(holdCount)} holds, ${formatNumber(changeCount)} changes, and ${formatNumber(tightCount)} tight seats. Use the button to show the full constituency list.`;
  if (constituencyTableToggle) {
    constituencyTableToggle.hidden = constituencyTableExpanded || rows.length === 0;
  }
  if (constituencyTableToggleLabel) {
    constituencyTableToggleLabel.textContent = `Show all ${formatNumber(rows.length)} constituencies`;
  }
  if (!constituencyTableExpanded) {
    if (constituencyTable) constituencyTable.innerHTML = "";
    return;
  }
  renderTable(
    constituencyTable,
    rows,
    [
      {
        label: "Constituency",
        render: (row) => `<strong>${row.constituency_name}</strong><br><span class="forecast-subtle">${row.constituency_code}</span>`
      },
      {
        label: "Current MP",
        render: (row) => {
          const party = row?.current_party || "n/a";
          const member = row?.current_member_name || party;
          return `<strong>${member}</strong><br><span class="forecast-party" style="--forecast-party:${partyColor(party)}">${party}</span>`;
        }
      },
      {
        label: "Forecast",
        render: (row) => `<span class="forecast-party" style="--forecast-party:${partyColor(row?.forecast?.winner)}">${row?.forecast?.winner || "n/a"}</span>`
      },
      {
        label: "Status",
        render: (row) => {
          if (row?.seat_status === "hold") {
            return `<span class="delta-positive">Hold</span>`;
          }
          if (row?.seat_status === "change") {
            return `<span class="delta-negative">Change from ${row?.current_party || "unknown"}</span>`;
          }
          return `<span class="delta-neutral">Unknown</span>`;
        }
      },
      {
        label: "Runner-up",
        render: (row) => row?.forecast?.runner_up || "n/a"
      },
      {
        label: "Odds",
        render: (row) => formatOdds(row?.forecast?.winner_probability || 0, 1)
      },
      {
        label: "Ward mix",
        render: (row) => {
          const tallies = row?.forecast?.ward_winner_tally || {};
          return getSortedPartyEntries(tallies)
            .slice(0, 3)
            .map(([party, count]) => `${party} ${formatNumber(count)}`)
            .join("<br>");
        }
      }
    ],
    "No constituencies match the selected filter."
  );
}

function renderWardTable() {
  const rows = getWardRows().slice(0, 80);
  wardSummary.textContent = `${formatNumber(rows.length)} wards shown, sorted by odds.`;
  renderTable(
    wardTable,
    rows,
    [
      {
        label: "Ward",
        render: (row) => `<strong>${row.ward_name || "Unknown ward"}</strong><br><span class="forecast-subtle">${row.ward_code}</span>`
      },
      {
        label: "Forecast",
        render: (row) => `<span class="forecast-party" style="--forecast-party:${partyColor(row?.winner)}">${row?.winner || "n/a"}</span>`
      },
      {
        label: "Runner-up",
        render: (row) => row?.runner_up || "n/a"
      },
      {
        label: "Odds",
        render: (row) => formatOdds(row?.winner_probability || 0, 1)
      },
      {
        label: "Current base",
        render: (row) => row?.current_winner_party || "n/a"
      }
    ],
    "No wards match the selected filter."
  );
}

function renderAssumptions(data) {
  if (!forecastAssumptions) return;
  const assumptions = Array.isArray(data?.assumptions) ? data.assumptions : [];
  forecastAssumptions.innerHTML = `
    <ul class="forecast-assumption-list">
      ${assumptions.map((item) => `<li>${item}</li>`).join("")}
    </ul>
  `;
}

function renderModelNotes(data) {
  if (!modelNotes) return;
  const features = data?.feature_stats || {};
  const featureRows = Object.entries(features)
    .sort((a, b) => Math.abs(Number(b[1]?.mean || 0)) - Math.abs(Number(a[1]?.mean || 0)))
    .slice(0, 8);
  modelNotes.innerHTML = `
    <p class="panel-note">
      Ward forecasts are scored from the census and deprivation signals, then nudged by current ward winners and incumbency before being rolled up to constituencies.
      Constituency forecasts blend the constituency-level score with the average of the ward forecasts assigned to that seat, then compare the result to the current MP's party to mark a hold or change.
      The odds shown in tables are simple odds for the forecast winner of that seat.
    </p>
    <p class="panel-note">
      ${geAdjustedMode
        ? "GE-adjusted view applies a small current-era local-vs-Westminster correction that includes Reform UK, so the forecast is closer to a general-election electorate rather than just the local-election electorate."
        : "Raw view shows the constituency roll-up exactly as it falls out of the local-election and signal model."}
    </p>
    <p class="panel-note">
      Current seat control comes from the UK Parliament Members API, which exposes the sitting MP and party for each constituency.
    </p>
    <table class="simple-table forecast-table">
      <thead>
        <tr><th>Signal</th><th>Mean</th><th>Std dev</th></tr>
      </thead>
      <tbody>
        ${featureRows.map(([featureId, stats]) => `
          <tr>
            <td>${featureId}</td>
            <td>${formatNumber(stats?.mean, 3)}</td>
            <td>${formatNumber(stats?.stddev, 3)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function attachControls(data) {
  const partyEntries = getSortedPartyEntries(data?.party_seat_totals || {});
  populatePartySelect(constituencyPartySelect, partyEntries, selectedConstituencyParty);
  populatePartySelect(wardPartySelect, partyEntries, selectedWardParty);

  constituencyPartySelect?.addEventListener("change", () => {
    selectedConstituencyParty = constituencyPartySelect.value;
    renderConstituencyTable();
  });

  wardPartySelect?.addEventListener("change", () => {
    selectedWardParty = wardPartySelect.value;
    renderWardTable();
  });

  if (geAdjustmentToggle) {
    geAdjustmentToggle.checked = geAdjustedMode;
    geAdjustmentToggle.addEventListener("change", () => {
      geAdjustedMode = geAdjustmentToggle.checked;
      updateForecastView();
    });
  }

  if (constituencyTableToggle) {
    constituencyTableToggle.addEventListener("click", () => {
      constituencyTableExpanded = true;
      renderConstituencyTable();
    });
  }
}

function updateGeAdjustmentState() {
  if (geAdjustmentState) {
    geAdjustmentState.textContent = geAdjustedMode ? "GE-adjusted" : "Raw local";
  }
}

function updateForecastView() {
  forecastViewData = buildConstituencyView(forecastData, geAdjustedMode);
  updateGeAdjustmentState();
  renderMetrics(forecastViewData);
  renderSeatBars(forecastViewData);
  renderCurrentSeatBars(forecastData);
  renderConstituencyTable();
  renderWardTable();
  renderModelNotes(forecastViewData);
}

async function boot() {
  const response = await fetch(FORECAST_URL);
  if (!response.ok) {
    throw new Error(`Forecast dataset failed to load: ${response.status}`);
  }

  forecastData = await response.json();
  forecastUpdated.textContent = forecastData?.updated_at_utc
    ? `Updated ${new Date(forecastData.updated_at_utc).toLocaleString()}`
    : "";

  forecastViewData = buildConstituencyView(forecastData, geAdjustedMode);
  renderAssumptions(forecastData);
  attachControls(forecastData);
  updateForecastView();
}

boot().catch((error) => {
  console.error(error);
  const message = "Forecast data could not be loaded.";
  if (forecastMetrics) forecastMetrics.innerHTML = `<p class="panel-note">${message}</p>`;
  if (forecastSeatBars) forecastSeatBars.innerHTML = `<p class="panel-note">${message}</p>`;
  if (constituencyTable) constituencyTable.innerHTML = `<p class="panel-note">${message}</p>`;
  if (wardTable) wardTable.innerHTML = `<p class="panel-note">${message}</p>`;
  if (modelNotes) modelNotes.innerHTML = `<p class="panel-note">${message}</p>`;
});
