import { buildConstituencyView } from "./lib/ge-adjustment.js";
import { partyFamilyName } from "./lib/ge-adjustment.js";
import { initBackToTopButton } from "./lib/back-to-top.js";
import { rowMatchesSearch } from "./lib/list-search.js";

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
const constituencySearchInput = document.getElementById("constituency-search");
const wardTableToggle = document.getElementById("ward-table-toggle");
const wardTableToggleLabel = document.getElementById("ward-table-toggle-label");
const wardSearchInput = document.getElementById("ward-search");
const forecastMetrics = document.getElementById("forecast-metrics");
const forecastSeatBars = document.getElementById("forecast-seat-bars");
const currentSeatBars = document.getElementById("current-seat-bars");
const forecastAssumptions = document.getElementById("forecast-assumptions");
const forecastUpdated = document.getElementById("forecast-updated");
const modelNotes = document.getElementById("model-notes");
const geAdjustmentToggle = document.getElementById("ge-adjustment-toggle");
const geAdjustmentState = document.getElementById("ge-adjustment-state");
const backToTopButton = document.getElementById("back-to-top");

let forecastData = null;
let forecastViewData = null;
let selectedConstituencyParty = "All";
let selectedWardParty = "All";
let geAdjustedMode = false;
let constituencyTableExpanded = false;
let wardTableExpanded = false;
let forecastSeatSmallerExpanded = false;
let currentSeatSmallerExpanded = false;
let constituencySort = { key: "lead", direction: "desc" };
let wardSort = { key: "lead", direction: "desc" };
let backToTopInitialized = false;
let constituencySearchQuery = "";
let wardSearchQuery = "";

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

function formatLead(value, digits = 1) {
  const prob = Number(value);
  if (!Number.isFinite(prob)) return "n/a";
  return `${Math.abs(prob * 100).toFixed(digits)}-point lead`;
}

function partyColor(party) {
  return PARTY_COLORS[partyFamilyName(party)] || "#9aa0a6";
}

function getSortedPartyEntries(mapLike) {
  return Object.entries(mapLike || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
}

function getSeatPartyUniverse(forecastTotals, currentTotals) {
  const currentEntries = getSortedPartyEntries(currentTotals);
  const currentOrder = currentEntries.map(([party]) => party);
  const forecastExtras = getSortedPartyEntries(forecastTotals)
    .map(([party]) => party)
    .filter((party) => !currentOrder.includes(party));
  return [...currentOrder, ...forecastExtras];
}

function buildSeatBarEntries(totals, partyUniverse) {
  const entries = partyUniverse.map((party) => [party, Number(totals?.[party] || 0)]);
  return entries.sort((a, b) => Number(b[1]) - Number(a[1]));
}

function compareValues(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum) return aNum - bNum;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function renderMetrics(data) {
  if (!forecastMetrics) return;
  const constituencies = Array.isArray(data?.constituency_forecasts) ? data.constituency_forecasts : [];
  const leadingPartyEntry = getSortedPartyEntries(data?.party_seat_totals || {})[0] || ["n/a", 0];
  const medianLead = constituencies.length
    ? [...constituencies]
      .map((row) => Number(row?.forecast?.confidence || 0))
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
      label: "Median constituency lead",
      value: medianLead === null ? "n/a" : formatLead(medianLead, 1),
      note: "difference between the top two model scores"
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
  const currentTotals = getCurrentSeatTotals(forecastData);
  const partyUniverse = getSeatPartyUniverse(totals, currentTotals);
  const entries = buildSeatBarEntries(totals, partyUniverse);
  renderPartyBarPanel(forecastSeatBars, entries, {
    expanded: forecastSeatSmallerExpanded,
    toggleId: "forecast-seat-more-toggle",
    moreId: "forecast-seat-more",
    buttonLabel: "smaller parties",
    note: geAdjustedMode
      ? "This is the GE-adjusted seat total, using the same party set as the current seat split so the two views compare like for like."
      : "These are total forecast winners across all 543 constituencies, using the same party set as the current seat split.",
    emptyMessage: "No forecast seat totals available."
  });
}

function renderCurrentSeatBars(data) {
  if (!currentSeatBars) return;
  const totals = getCurrentSeatTotals(data);
  const partyUniverse = getSeatPartyUniverse(data?.party_seat_totals || {}, totals);
  const entries = buildSeatBarEntries(totals, partyUniverse);
  renderPartyBarPanel(currentSeatBars, entries, {
    expanded: currentSeatSmallerExpanded,
    toggleId: "current-seat-more-toggle",
    moreId: "current-seat-more",
    buttonLabel: "smaller parties",
    note: "This is the current seat distribution from the existing MP data. Labour (Co-op) is shown separately because it is a distinct current label in the source data.",
    emptyMessage: "No current seat split available."
  });
}

function getCurrentSeatTotals(data) {
  const rows = Array.isArray(data?.constituency_forecasts) ? data.constituency_forecasts : [];
  const totals = {};
  for (const row of rows) {
    const party = row?.current_party || "Unknown";
    totals[party] = (totals[party] || 0) + 1;
  }
  return totals;
}

function renderPartyBarPanel(container, entries, options) {
  if (!container) return;
  const topN = 10;
  const sum = entries.reduce((acc, [, value]) => acc + Number(value || 0), 0) || 1;
  const visible = entries.slice(0, topN);
  const hidden = entries.slice(topN);
  const hiddenCount = hidden.length;
  const showHidden = Boolean(options?.expanded && hiddenCount);
  if (!entries.length) {
    container.innerHTML = `<p class="panel-note">${options?.emptyMessage || "No data available."}</p>`;
    return;
  }

  container.innerHTML = `
    <p class="panel-note">${options?.note || ""}</p>
    <p class="panel-note">Showing the top ${formatNumber(Math.min(topN, entries.length))} parties by seats. All rows are included in the total.</p>
    <div class="seat-bars seat-bars--single">
      ${visible.map(([party, value]) => renderStackedSegment(party, value, sum, false, options)).join("")}
      ${showHidden ? hidden.map(([party, value]) => renderStackedSegment(party, value, sum, true, options)).join("") : ""}
    </div>
    ${hiddenCount ? `
      <button type="button" class="inline-toggle-button party-bar-toggle" id="${options.toggleId}" aria-expanded="${showHidden ? "true" : "false"}">
        ${showHidden ? "Hide smaller parties" : `Show ${formatNumber(hiddenCount)} smaller parties`}
      </button>
    ` : ""}
  `;

  const toggle = container.querySelector(`#${options.toggleId}`);
  const moreSegments = container.querySelectorAll(`[data-hidden-group="${options?.moreId || ""}"]`);
  if (toggle && hiddenCount) {
    toggle.addEventListener("click", () => {
      const next = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", next ? "true" : "false");
      toggle.textContent = next
        ? "Hide smaller parties"
        : `Show ${formatNumber(hiddenCount)} smaller parties`;
      moreSegments.forEach((segment) => {
        segment.hidden = !next;
      });
    });
  }
}

function renderStackedSegment(party, value, sum, hidden, options) {
  const width = (Number(value || 0) / sum) * 100;
  return `
    <button
      type="button"
      class="seat-segment"
      data-hidden-group="${options?.moreId || ""}"
      aria-label="${party}: ${formatNumber(value)} seats, ${formatPercent(Number(value || 0) / sum, 1)} of the total"
      title="${party}: ${formatNumber(value)} seats"
      style="width:${width}%; background:${partyColor(party)}"
      ${hidden ? "hidden" : ""}
    >
      <span class="seat-segment-label">${party}</span>
      <span class="seat-segment-count">${formatNumber(value)}</span>
    </button>
  `;
}

function populatePartySelect(selectEl, entries, currentValue) {
  if (!selectEl) return;
  const options = ["All", ...entries.map(([party]) => party)];
  selectEl.innerHTML = options.map((value) => `
    <option value="${value}" ${value === currentValue ? "selected" : ""}>${value}</option>
  `).join("");
}

function renderTable(container, rows, columns, emptyMessage, sortState, onSortChange) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<p class="panel-note">${emptyMessage}</p>`;
    return;
  }

  const sortedRows = sortState?.key
    ? [...rows].sort((left, right) => {
      const column = columns.find((item) => item.key === sortState.key);
      const leftValue = column?.sortValue ? column.sortValue(left) : left?.[sortState.key];
      const rightValue = column?.sortValue ? column.sortValue(right) : right?.[sortState.key];
      const result = compareValues(leftValue, rightValue);
      return sortState.direction === "asc" ? result : -result;
    })
    : rows;

  const header = columns.map((column) => {
    const active = sortState?.key === column.key;
    const indicator = active ? (sortState.direction === "asc" ? "▲" : "▼") : "↕";
    return `
      <th>
        <button type="button" class="table-sort-button ${active ? "is-active" : ""}" data-sort-key="${column.key}">
          <span>${column.label}</span>
          <span class="table-sort-indicator">${indicator}</span>
        </button>
      </th>
    `;
  }).join("");

  const body = sortedRows.map((row) => `
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

  container.querySelectorAll(".table-sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      const sortKey = button.getAttribute("data-sort-key");
      if (!sortKey || !onSortChange) return;
      if (sortState?.key === sortKey) {
        onSortChange({
          key: sortKey,
          direction: sortState.direction === "asc" ? "desc" : "asc"
        });
      } else {
        onSortChange({
          key: sortKey,
          direction: "desc"
        });
      }
    });
  });
}

function getConstituencyRows() {
  const rows = Array.isArray(forecastViewData?.constituency_forecasts) ? [...forecastViewData.constituency_forecasts] : [];
  const filtered = selectedConstituencyParty === "All"
    ? rows
    : rows.filter((row) => row?.forecast?.winner === selectedConstituencyParty);
  return filtered.filter((row) => rowMatchesSearch(row, constituencySearchQuery));
}

function getWardRows() {
  const rows = Array.isArray(forecastData?.ward_forecasts) ? [...forecastData.ward_forecasts] : [];
  const filtered = selectedWardParty === "All"
    ? rows
    : rows.filter((row) => row?.winner === selectedWardParty);
  return filtered.filter((row) => rowMatchesSearch(row, wardSearchQuery));
}

function renderConstituencyTable() {
  const rows = getConstituencyRows();
  const holdCount = rows.filter((row) => row?.seat_status === "hold").length;
  const changeCount = rows.filter((row) => row?.seat_status === "change").length;
  const tightCount = rows.filter((row) => Number(row?.forecast?.confidence || 0) <= 0.12).length;
  constituencySummary.textContent = constituencyTableExpanded
    ? `${formatNumber(rows.length)} constituencies shown, sorted by lead.${geAdjustedMode ? " GE-adjusted view." : " Raw local view."}`
    : `${formatNumber(rows.length)} constituencies match the current filter${constituencySearchQuery ? ` and search "${constituencySearchQuery}"` : ""}. ${formatNumber(holdCount)} holds, ${formatNumber(changeCount)} changes, and ${formatNumber(tightCount)} tight seats. Use the button to show the full constituency list.`;
  if (constituencyTableToggle) {
    constituencyTableToggle.hidden = rows.length === 0;
  }
  if (constituencyTableToggleLabel) {
    constituencyTableToggleLabel.textContent = constituencyTableExpanded
      ? "Hide list"
      : `Show all ${formatNumber(rows.length)} constituencies`;
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
        key: "constituency_name",
        label: "Constituency",
        sortValue: (row) => row?.constituency_name || "",
        render: (row) => `<strong>${row.constituency_name}</strong><br><span class="forecast-subtle">${row.constituency_code}</span>`
      },
      {
        key: "current_mp",
        label: "Current MP",
        sortValue: (row) => row?.current_member_name || row?.current_party || "",
        render: (row) => {
          const party = row?.current_party || "n/a";
          const member = row?.current_member_name || party;
          return `<strong>${member}</strong><br><span class="forecast-party" style="--forecast-party:${partyColor(party)}">${party}</span>`;
        }
      },
      {
        key: "forecast",
        label: "Forecast",
        sortValue: (row) => row?.forecast?.winner || "",
        render: (row) => `<span class="forecast-party" style="--forecast-party:${partyColor(row?.forecast?.winner)}">${row?.forecast?.winner || "n/a"}</span>`
      },
      {
        key: "status",
        label: "Status",
        sortValue: (row) => row?.seat_status || "",
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
        key: "runner_up",
        label: "Runner-up",
        sortValue: (row) => row?.forecast?.runner_up || "",
        render: (row) => row?.forecast?.runner_up || "n/a"
      },
      {
        key: "lead",
        label: "Lead",
        sortValue: (row) => Number(row?.forecast?.confidence || 0),
        render: (row) => formatLead(row?.forecast?.confidence || 0, 1)
      },
      {
        key: "ward_mix",
        label: "Ward mix",
        sortValue: (row) => {
          const tallies = row?.forecast?.ward_winner_tally || {};
          const first = getSortedPartyEntries(tallies)[0] || ["", 0];
          return `${first[0]} ${first[1]}`;
        },
        render: (row) => {
          const tallies = row?.forecast?.ward_winner_tally || {};
          return getSortedPartyEntries(tallies)
            .slice(0, 3)
            .map(([party, count]) => `${party} ${formatNumber(count)}`)
            .join("<br>");
        }
      }
    ],
    "No constituencies match the selected filter.",
    constituencySort,
    (nextSort) => {
      constituencySort = nextSort;
      renderConstituencyTable();
    }
  );
}

function renderWardTable() {
  const rows = getWardRows();
  const holdCount = rows.filter((row) => row?.current_winner_party && row?.winner && partyFamilyName(row.current_winner_party) === partyFamilyName(row.winner)).length;
  const changeCount = rows.length - holdCount;
  const tightCount = rows.filter((row) => Number(row?.confidence || 0) <= 0.12).length;
  wardSummary.textContent = wardTableExpanded
    ? `${formatNumber(rows.length)} wards shown, sorted by lead.`
    : `${formatNumber(rows.length)} wards match the current filter${wardSearchQuery ? ` and search "${wardSearchQuery}"` : ""}. ${formatNumber(holdCount)} holds, ${formatNumber(changeCount)} changes, and ${formatNumber(tightCount)} tight wards. Use the button to show the full ward list.`;
  if (wardTableToggle) {
    wardTableToggle.hidden = rows.length === 0;
  }
  if (wardTableToggleLabel) {
    wardTableToggleLabel.textContent = wardTableExpanded
      ? "Hide list"
      : `Show all ${formatNumber(rows.length)} wards`;
  }
  if (!wardTableExpanded) {
    if (wardTable) wardTable.innerHTML = "";
    return;
  }
  renderTable(
    wardTable,
    rows,
    [
      {
        key: "ward",
        label: "Ward",
        sortValue: (row) => row?.ward_name || "",
        render: (row) => `<strong>${row.ward_name || "Unknown ward"}</strong><br><span class="forecast-subtle">${row.ward_code}</span>`
      },
      {
        key: "forecast",
        label: "Forecast",
        sortValue: (row) => row?.winner || "",
        render: (row) => `<span class="forecast-party" style="--forecast-party:${partyColor(row?.winner)}">${row?.winner || "n/a"}</span>`
      },
      {
        key: "runner_up",
        label: "Runner-up",
        sortValue: (row) => row?.runner_up || "",
        render: (row) => row?.runner_up || "n/a"
      },
      {
        key: "lead",
        label: "Lead",
        sortValue: (row) => Number(row?.confidence || 0),
        render: (row) => formatLead(row?.confidence || 0, 1)
      },
      {
        key: "current_base",
        label: "Current base",
        sortValue: (row) => row?.current_winner_party || "",
        render: (row) => row?.current_winner_party || "n/a"
      }
    ],
    "No wards match the selected filter.",
    wardSort,
    (nextSort) => {
      wardSort = nextSort;
      renderWardTable();
    }
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
      The lead shown in tables is the difference between the top two model scores for that seat.
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

  constituencySearchInput?.addEventListener("input", () => {
    constituencySearchQuery = constituencySearchInput.value.trim();
    renderConstituencyTable();
  });

  wardSearchInput?.addEventListener("input", () => {
    wardSearchQuery = wardSearchInput.value.trim();
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
      constituencyTableExpanded = !constituencyTableExpanded;
      renderConstituencyTable();
    });
  }

  if (wardTableToggle) {
    wardTableToggle.addEventListener("click", () => {
      wardTableExpanded = !wardTableExpanded;
      renderWardTable();
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
  if (!backToTopInitialized) {
    initBackToTopButton(backToTopButton);
    backToTopInitialized = true;
  }
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
