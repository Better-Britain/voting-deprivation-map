from __future__ import annotations

import json
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parents[1]
DEPRIVATION_LOOKUP_ALL_JSON = BASE_DIR / "deprivation" / "output" / "practice_deprivation_lookup_all.json"


def load_cached_practice_deprivation_lookup(
    path: Path = DEPRIVATION_LOOKUP_ALL_JSON,
) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    return {
        str(code).strip(): item
        for code, item in payload.items()
        if str(code).strip() and isinstance(item, dict)
    }


def build_practice_deprivation_lookup(
    rows: list[dict[str, Any]],
    *,
    cached_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """
    Filter the persisted all-practice deprivation lookup down to the supplied rows.
    """
    if cached_lookup is None:
        cached_lookup = load_cached_practice_deprivation_lookup()
    if not cached_lookup:
        return {}
    filtered: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = str(row.get("canonical_code", "")).strip()
        if not code:
            continue
        item = cached_lookup.get(code)
        if isinstance(item, dict):
            filtered[code] = item
    return filtered


def write_practice_deprivation_lookup(path: Path, rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """
    Write a filtered copy of the persisted lookup for the current map output.
    """
    lookup = build_practice_deprivation_lookup(rows)
    path.write_text(json.dumps(lookup, indent=2, ensure_ascii=False), encoding="utf-8")
    return lookup


__all__ = [
    "DEPRIVATION_LOOKUP_ALL_JSON",
    "build_practice_deprivation_lookup",
    "load_cached_practice_deprivation_lookup",
    "write_practice_deprivation_lookup",
]
