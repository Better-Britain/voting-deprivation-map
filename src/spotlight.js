import { buildConstituencyView } from "./lib/ge-adjustment.js";
import { partyFamilyName } from "./lib/ge-adjustment.js";
import { initBackToTopButton } from "./lib/back-to-top.js";
import { rowMatchesSearch } from "./lib/list-search.js";

const DATA_URL = new URL("./data/spotlight-focus.json", import.meta.url).href;
const FORECAST_URL = new URL("./data/next-ge-forecast.json", import.meta.url).href;

const PARTY_COLORS = {
  Labour: "#e4003b",
  Conservative: "#0087dc",
  "Reform UK": "#12b6cf",
  "Liberal Democrats": "#faa61a",
  "Green Party": "#6ab023",
  Independent: "#9ca3af"
};

const FEATURE_LABELS = {
  white_british_pct: "White British",
  uk_born_pct: "UK-born",
  english_only_identity_pct: "English only identity",
  english_or_british_only_identity_pct: "English or British only identity",
  christian_pct: "Christian",
  no_religion_pct: "No religion",
  muslim_pct: "Muslim",
  age_50plus_pct: "Age 50+",
  age_65plus_pct: "Age 65+",
  owner_occupied_pct: "Owner occupied",
  private_rented_pct: "Private rented",
  social_rented_pct: "Social rented",
  nssec_managerial_professional_pct: "Managerial/professional",
  nssec_working_class_pct: "Working class",
  degree_pct: "Degree",
  no_qualifications_pct: "No qualifications",
  imd_score: "Deprivation score"
};

const spotlightUpdated = document.getElementById("spotlight-updated");
const spotlightNotes = document.getElementById("spotlight-notes");
const spotlightMetrics = document.getElementById("spotlight-metrics");
const makerfieldSummary = document.getElementById("makerfield-summary");
const makerfieldCards = document.getElementById("makerfield-cards");
const makerfieldSignals = document.getElementById("makerfield-signals");
const makerfieldCouncils = document.getElementById("makerfield-councils");
const makerfieldWards = document.getElementById("makerfield-wards");
const gmSummary = document.getElementById("gm-summary");
const gmCards = document.getElementById("gm-cards");
const gmSignals = document.getElementById("gm-signals");
const gmCouncils = document.getElementById("gm-councils");
const gmWards = document.getElementById("gm-wards");
const makerfieldWardsSummary = document.getElementById("makerfield-wards-summary");
const makerfieldWardsToggle = document.getElementById("makerfield-wards-toggle");
const makerfieldWardsToggleLabel = document.getElementById("makerfield-wards-toggle-label");
const makerfieldWardsSearch = document.getElementById("makerfield-wards-search");
const gmWardsSummary = document.getElementById("gm-wards-summary");
const gmWardsToggle = document.getElementById("gm-wards-toggle");
const gmWardsToggleLabel = document.getElementById("gm-wards-toggle-label");
const gmWardsSearch = document.getElementById("gm-wards-search");
const makerfieldGeAdjustmentToggle = document.getElementById("makerfield-ge-adjustment-toggle");
const makerfieldGeAdjustmentState = document.getElementById("makerfield-ge-adjustment-state");
const backToTopButton = document.getElementById("back-to-top");

let spotlightData = null;
let forecastData = null;
let forecastViewData = null;
let makerfieldGeAdjustedMode = true;
let makerfieldWardsExpanded = false;
let gmWardsExpanded = false;
let makerfieldWardsSearchQuery = "";
let gmWardsSearchQuery = "";
let makerfieldWardsSort = { key: "lead", direction: "desc" };
let gmWardsSort = { key: "lead", direction: "desc" };

function formatNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatGap(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  return `${Math.abs(num * 100).toFixed(digits)}pp`;
}

function formatLead(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  return `${Math.abs(num * 100).toFixed(digits)}-point lead`;
}

function formatPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a";
  return `${(num * 100).toFixed(digits)}%`;
}

function describeRace(gap) {
  const lead = Number(gap || 0);
  if (lead < 0.01) return "too close to call";
  if (lead < 0.03) return "very close";
  if (lead < 0.06) return "tight";
  return "clear";
}

function partyColor(party) {
  return PARTY_COLORS[partyFamilyName(party)] || "#9aa0a6";
}

function partyBadge(party) {
  return `<span class="forecast-party" style="--forecast-party:${partyColor(party)}">${party || "n/a"}</span>`;
}

function signalLabel(featureId) {
  return FEATURE_LABELS[featureId] || featureId;
}

function renderCardGrid(container, cards) {
  if (!container) return;
  container.innerHTML = `
    <div class="spotlight-card-grid">
      ${cards.map((card) => `
        <article class="metric-card spotlight-card">
          <div class="metric-label">${card.label}</div>
          <div class="metric-value">${card.value}</div>
          <div class="metric-note">${card.note}</div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSignalList(container, signals) {
  if (!container) return;
  if (!signals?.length) {
    container.innerHTML = `<p class="panel-note">No signal breakdown available.</p>`;
    return;
  }
  container.innerHTML = `
    <ol class="spotlight-signal-list">
      ${signals.map((signal) => `
        <li class="spotlight-signal-item">
          <span class="spotlight-signal-name">${signalLabel(signal.feature_id)}<br><span class="forecast-subtle">${signal.feature_id === "imd_score" ? formatNumber(signal.value, 2) : formatPercent(signal.value, 1)}</span></span>
          <span class="spotlight-signal-value">${Number.isFinite(Number(signal.contribution)) && Number(signal.contribution) >= 0 ? "+" : ""}${formatNumber(signal.contribution, 3)}</span>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderTagList(container, rows, emptyMessage) {
  if (!container) return;
  if (!rows?.length) {
    container.innerHTML = `<p class="panel-note">${emptyMessage}</p>`;
    return;
  }
  container.innerHTML = `
    <div class="spotlight-tag-list">
      ${rows.map((row) => `<span class="spotlight-tag">${row}</span>`).join("")}
    </div>
  `;
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
    const active = Boolean(column.key) && sortState?.key === column.key;
    const indicator = active ? (sortState.direction === "asc" ? "▲" : "▼") : "↕";
    return column.key
      ? `<th><button type="button" class="table-sort-button ${active ? "is-active" : ""}" data-sort-key="${column.key}"><span>${column.label}</span><span class="table-sort-indicator">${indicator}</span></button></th>`
      : `<th>${column.label}</th>`;
  }).join("");

  container.innerHTML = `
    <table class="simple-table forecast-table spotlight-table">
      <thead><tr>${header}</tr></thead>
      <tbody>
        ${sortedRows.map((row) => `
          <tr>
            ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
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

function getWardSummary(rows) {
  const total = rows.length;
  const holds = rows.filter((row) => {
    const currentParty = row?.current_winner_party;
    const forecastParty = row?.forecast_party;
    return currentParty && forecastParty && partyFamilyName(currentParty) === partyFamilyName(forecastParty);
  }).length;
  const changes = total - holds;
  const tight = rows.filter((row) => Number(row?.gap || 0) <= 0.12).length;
  return { total, holds, changes, tight };
}

function compareValues(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum) return aNum - bNum;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function describePlace(place, kind) {
  const forecast = place?.forecast_party || "n/a";
  const current = kind === "mayor"
    ? `${place?.current_holder_name || "n/a"} (${place?.current_party || "n/a"})`
    : `${place?.current_member_name || "n/a"} (${place?.current_party || "n/a"})`;
  if (kind === "constituency" && Number.isFinite(Number(place?.forecast?.winner_probability))) {
    return `${place?.place_type || "Place"} currently held by ${current}. The model points to ${forecast} with a ${formatLead(place?.gap || 0, 1)}.`;
  }
  return `${place?.place_type || "Place"} currently held by ${current}. The model points to ${forecast} in a ${describeRace(place?.gap)} race.`;
}

function placeCards(place, kind) {
  const currentLabel = kind === "mayor" ? "Current holder" : "Current MP";
  const forecastLabel = kind === "mayor" ? "Forecast mayor" : "Forecast MP";
  const nextLabel = kind === "mayor" ? `Next election ${place?.next_election_month || ""}` : "Authorities touched";
  return [
    {
      label: currentLabel,
      value: kind === "mayor" ? (place?.current_holder_name || "n/a") : (place?.current_member_name || "n/a"),
      note: place?.current_party || "n/a"
    },
    {
      label: forecastLabel,
      value: place?.forecast_party || "n/a",
      note: `${place?.seat_status || "unknown"} vs current`
    },
    {
      label: kind === "mayor" ? "Race" : "Lead",
      value: kind === "mayor"
        ? describeRace(place?.gap)
        : formatLead(place?.gap, 1),
      note: kind === "mayor"
        ? "very close means the gap is tiny"
        : "difference between the top two model scores"
    },
    {
      label: "Wards",
      value: formatNumber(place?.ward_count || 0),
      note: `${formatNumber(place?.authority_count || 0)} authorities`
    },
    {
      label: nextLabel,
      value: kind === "mayor" ? String(place?.next_election_year || "n/a") : formatNumber(place?.authority_count || 0),
      note: kind === "mayor" ? "scheduled contest" : "exact ward overlaps"
    }
  ];
}

function populatePlace(place, kind, selectors) {
  if (!place) return;
  if (selectors.summary) selectors.summary.textContent = describePlace(place, kind);
  if (selectors.cards) renderCardGrid(selectors.cards, placeCards(place, kind));
  if (selectors.signals) renderSignalList(selectors.signals, place.top_signals || []);
  if (selectors.councils) {
    const rows = Array.isArray(place.council_rows) ? place.council_rows : [];
    renderTable(
      selectors.councils,
      rows,
      [
        {
          label: "Council",
          render: (row) => `<strong>${row.council_name || "n/a"}</strong><br><span class="forecast-subtle">${row.council_code || ""}</span>`
        },
        {
          label: "Control",
          render: (row) => partyBadge(row.control_party)
        },
        {
          label: "Seats",
          render: (row) => `${formatNumber(row.seat_total)} / ${formatNumber(row.majority_threshold)}`
        },
        {
          label: "Basis",
          render: (row) => row.control_basis || "n/a"
        },
        {
          label: "Summary",
          render: (row) => row.party_seats_summary || "n/a"
        }
      ],
      "No council-control rows available for this place."
    );
  }
  if (selectors.wards) {
    const rows = Array.isArray(place.ward_rows) ? [...place.ward_rows] : [];
    const expanded = kind === "mayor" ? gmWardsExpanded : makerfieldWardsExpanded;
    const searchQuery = kind === "mayor" ? gmWardsSearchQuery : makerfieldWardsSearchQuery;
    const sortState = kind === "mayor" ? gmWardsSort : makerfieldWardsSort;
    const summaryEl = kind === "mayor" ? gmWardsSummary : makerfieldWardsSummary;
    const toggleEl = kind === "mayor" ? gmWardsToggle : makerfieldWardsToggle;
    const toggleLabelEl = kind === "mayor" ? gmWardsToggleLabel : makerfieldWardsToggleLabel;
    const searchEl = kind === "mayor" ? gmWardsSearch : makerfieldWardsSearch;
    const filteredRows = rows.filter((row) => rowMatchesSearch(row, searchQuery));
    const summary = getWardSummary(filteredRows);
    const hasActiveFilter = searchQuery.length > 0;
    if (summaryEl) {
      summaryEl.textContent = hasActiveFilter
        ? `${formatNumber(summary.total)} wards match search "${searchQuery}". Showing the matching set.`
        : expanded
          ? `${formatNumber(summary.total)} wards shown, sorted by lead.`
          : `${formatNumber(summary.total)} wards total. ${formatNumber(summary.holds)} forecast holds, ${formatNumber(summary.changes)} forecast changes, and ${formatNumber(summary.tight)} tight wards. Use the button to show the full ward list.`;
    }
    if (toggleEl) {
      toggleEl.hidden = filteredRows.length === 0;
    }
    if (toggleLabelEl) {
      toggleLabelEl.textContent = expanded ? "Hide list" : `Show all ${formatNumber(rows.length)} wards`;
    }
    if (searchEl) {
      searchEl.value = searchQuery;
    }
    if (!hasActiveFilter && !expanded) {
      selectors.wards.innerHTML = "";
      return;
    }
    renderTable(
      selectors.wards,
      filteredRows,
      [
        {
          key: "ward",
          label: "Ward",
          sortValue: (row) => row?.ward_name || "",
          render: (row) => `<strong>${row.ward_name || "n/a"}</strong><br><span class="forecast-subtle">${row.ward_code || ""}</span>`
        },
        {
          key: "authority",
          label: "Authority",
          sortValue: (row) => row?.authority_name || "",
          render: (row) => row.authority_name || "n/a"
        },
        {
          key: "current",
          label: "Current",
          sortValue: (row) => row?.current_winner_party || "",
          render: (row) => partyBadge(row.current_winner_party)
        },
        {
          key: "incumbent",
          label: "Incumbent",
          sortValue: (row) => row?.incumbent_party || "",
          render: (row) => partyBadge(row.incumbent_party)
        },
        {
          key: "forecast",
          label: "Forecast",
          sortValue: (row) => row?.forecast_party || "",
          render: (row) => partyBadge(row.forecast_party)
        },
        {
          key: "lead",
          label: "Lead",
          sortValue: (row) => Number(row?.gap || 0),
          render: (row) => formatLead(row.gap || 0, 2)
        },
        {
          key: "signals",
          label: "Signals",
          render: (row) => (Array.isArray(row.top_signals) ? row.top_signals : [])
            .slice(0, 3)
            .map((signal) => `<span class="spotlight-signal-inline">${signalLabel(signal.feature_id)}</span>`)
            .join("<br>")
        }
      ],
      "No ward roll-up rows available.",
      sortState,
      (nextSort) => {
        if (kind === "mayor") {
          gmWardsSort = nextSort;
        } else {
          makerfieldWardsSort = nextSort;
        }
        renderView();
      }
    );
  }
}

function getMakerfieldPlace() {
  const base = spotlightData?.makerfield || {};
  const forecastRow = Array.isArray(forecastViewData?.constituency_forecasts)
    ? forecastViewData.constituency_forecasts.find((row) => row.constituency_name === "Makerfield")
    : null;
  return forecastRow ? { ...base, ...forecastRow } : base;
}

function updateMakerfieldModeState() {
  if (makerfieldGeAdjustmentState) {
    makerfieldGeAdjustmentState.textContent = makerfieldGeAdjustedMode ? "GE-adjusted" : "Raw local";
  }
}

function buildNotes(makerfield, gm) {
  const items = [
    `Makerfield is ${makerfield.seat_status === "hold" ? "forecast to hold" : "forecast to change"} from ${makerfield.current_party || "n/a"} to ${makerfield.forecast_party || "n/a"}.`,
    `Makerfield spans ${formatNumber(makerfield.ward_count || 0)} wards across ${formatNumber(makerfield.authority_count || 0)} authorities.`,
    `The toggle above changes only the Makerfield constituency section; the mayoralty section stays on its separate model.`,
    `Greater Manchester mayoralty is currently held by ${gm.current_holder_name || "n/a"} (${gm.current_party || "n/a"}) and the race is very close.`,
    `Makerfield is shown as a lead over the runner-up; the mayoralty section uses a plain-English close-race label because that dataset does not store full win probabilities.`,
    `The mayoralty forecast uses the ten Greater Manchester authorities and the ward-level census/deprivation split rather than a single centroid-based join.`
  ];
  if (!spotlightNotes) return;
  spotlightNotes.innerHTML = `
    <ul class="forecast-assumption-list">
      ${items.map((item) => `<li>${item}</li>`).join("")}
    </ul>
  `;
}

function renderView() {
  const makerfield = getMakerfieldPlace();
  const gm = spotlightData?.greater_manchester_mayoralty || {};

  updateMakerfieldModeState();
  buildNotes(makerfield, gm);

  if (spotlightMetrics) {
    renderCardGrid(spotlightMetrics, [
      {
        label: makerfieldGeAdjustedMode ? "Makerfield GE-adjusted forecast" : "Makerfield forecast",
        value: makerfield.forecast_party || "n/a",
        note: formatLead(makerfield?.gap || 0, 1)
      },
      {
        label: "Makerfield current MP",
        value: makerfield.current_member_name || "n/a",
        note: makerfield.current_party || "n/a"
      },
      {
        label: "GM mayoral forecast",
        value: gm.forecast_party || "n/a",
        note: describeRace(gm.gap)
      },
      {
        label: "GM current mayor",
        value: gm.current_holder_name || "n/a",
        note: gm.current_party || "n/a"
      },
      {
        label: "Makerfield wards",
        value: formatNumber(makerfield.ward_count || 0),
        note: `${formatNumber(makerfield.authority_count || 0)} authorities`
      },
      {
        label: "GM wards",
        value: formatNumber(gm.ward_count || 0),
        note: `${formatNumber(gm.authority_count || 0)} authorities`
      }
    ]);
  }

  populatePlace(makerfield, "constituency", {
    summary: makerfieldSummary,
    cards: makerfieldCards,
    signals: makerfieldSignals,
    councils: makerfieldCouncils,
    wards: makerfieldWards
  });

  populatePlace(gm, "mayor", {
    summary: gmSummary,
    cards: gmCards,
    signals: gmSignals,
    councils: gmCouncils,
    wards: gmWards
  });
}

async function main() {
  const [spotlightResponse, forecastResponse] = await Promise.all([
    fetch(DATA_URL),
    fetch(FORECAST_URL)
  ]);

  if (!spotlightResponse.ok) {
    throw new Error(`Failed to load spotlight data (${spotlightResponse.status})`);
  }
  if (!forecastResponse.ok) {
    throw new Error(`Failed to load forecast data (${forecastResponse.status})`);
  }

  spotlightData = await spotlightResponse.json();
  forecastData = await forecastResponse.json();
  forecastViewData = buildConstituencyView(forecastData, makerfieldGeAdjustedMode);

  if (spotlightUpdated) {
    spotlightUpdated.textContent = spotlightData?.updated_at_utc
      ? `Updated ${new Date(spotlightData.updated_at_utc).toLocaleString()}`
      : "Updated recently";
  }

  if (makerfieldGeAdjustmentToggle) {
    makerfieldGeAdjustmentToggle.checked = makerfieldGeAdjustedMode;
    makerfieldGeAdjustmentToggle.addEventListener("change", () => {
      makerfieldGeAdjustedMode = makerfieldGeAdjustmentToggle.checked;
      forecastViewData = buildConstituencyView(forecastData, makerfieldGeAdjustedMode);
      renderView();
    });
  }

  if (makerfieldWardsToggle) {
    makerfieldWardsToggle.addEventListener("click", () => {
      makerfieldWardsExpanded = !makerfieldWardsExpanded;
      renderView();
    });
  }

  if (gmWardsToggle) {
    gmWardsToggle.addEventListener("click", () => {
      gmWardsExpanded = !gmWardsExpanded;
      renderView();
    });
  }

  if (makerfieldWardsSearch) {
    makerfieldWardsSearch.addEventListener("input", () => {
      makerfieldWardsSearchQuery = makerfieldWardsSearch.value.trim();
      renderView();
    });
  }

  if (gmWardsSearch) {
    gmWardsSearch.addEventListener("input", () => {
      gmWardsSearchQuery = gmWardsSearch.value.trim();
      renderView();
    });
  }

  renderView();
  initBackToTopButton(backToTopButton);
}

main().catch((error) => {
  console.error(error);
  if (spotlightNotes) {
    spotlightNotes.innerHTML = `<p class="panel-note">Failed to load spotlight data: ${error.message}</p>`;
  }
});
