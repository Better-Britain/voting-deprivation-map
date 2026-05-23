function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function collectSearchableStrings(value, out, seen) {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    out.push(normalizeText(value));
    return;
  }
  if (Array.isArray(value)) return;
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) {
    collectSearchableStrings(child, out, seen);
  }
}

export function rowMatchesSearch(row, query) {
  const needle = normalizeText(query);
  if (!needle) return true;
  const searchable = [];
  collectSearchableStrings(row, searchable, new Set());
  return searchable.some((value) => value.includes(needle));
}
