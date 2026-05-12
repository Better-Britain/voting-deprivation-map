#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent.parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_GEOJSON = OUTPUT_DIR / "england-lsoa-imd-2025.geojson"
OUTPUT_SUMMARY = OUTPUT_DIR / "england-lsoa-imd-2025_summary.json"

DEPRIVATION_CSV_URL = (
    "https://assets.publishing.service.gov.uk/media/691ded56d140bbbaa59a2a7d/"
    "File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv"
)
BOUNDARY_ABOUT_URL = (
    "https://geoportal.statistics.gov.uk/datasets/ons::lower-layer-super-output-areas-december-2021-boundaries-ew-bsc-v4/about"
)
BOUNDARY_QUERY_URL = (
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/"
    "Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BSC_V4/FeatureServer/0/query"
)

PAGE_SIZE = 2000


def fetch_json(url: str) -> dict:
    with urlopen(url, timeout=180) as response:
        return json.load(response)


def fetch_deprivation_index() -> dict[str, dict[str, object]]:
    with urlopen(DEPRIVATION_CSV_URL, timeout=180) as response:
        text = response.read().decode("utf-8-sig", "ignore")
    reader = csv.DictReader(text.splitlines())
    index: dict[str, dict[str, object]] = {}
    for row in reader:
        code = row["LSOA code (2021)"].strip()
        index[code] = {
            "lsoa21cd": code,
            "lsoa21nm": row["LSOA name (2021)"].strip(),
            "lad24cd": row["Local Authority District code (2024)"].strip(),
            "lad24nm": row["Local Authority District name (2024)"].strip(),
            "imd_score": float(row["Index of Multiple Deprivation (IMD) Score"]),
            "imd_rank": int(row["Index of Multiple Deprivation (IMD) Rank (where 1 is most deprived)"]),
            "imd_decile": int(row["Index of Multiple Deprivation (IMD) Decile (where 1 is most deprived 10% of LSOAs)"]),
            "income_decile": int(row["Income Decile (where 1 is most deprived 10% of LSOAs)"]),
            "employment_decile": int(row["Employment Decile (where 1 is most deprived 10% of LSOAs)"]),
            "health_decile": int(row["Health Deprivation and Disability Decile (where 1 is most deprived 10% of LSOAs)"]),
            "population_2022": int(row["Total population: mid 2022"]),
        }
    return index


def boundary_query_url(*, offset: int) -> str:
    params = {
        "where": "LSOA21CD LIKE 'E%'",
        "outFields": "LSOA21CD,LSOA21NM",
        "outSR": "4326",
        "f": "geojson",
        "resultOffset": str(offset),
        "resultRecordCount": str(PAGE_SIZE),
    }
    return f"{BOUNDARY_QUERY_URL}?{urlencode(params)}"


def round_coords(value):
    if isinstance(value, list):
        return [round_coords(item) for item in value]
    if isinstance(value, float):
        return round(value, 6)
    return value


def fetch_boundary_features() -> list[dict]:
    features: list[dict] = []
    offset = 0
    while True:
        payload = fetch_json(boundary_query_url(offset=offset))
        page_features = payload.get("features", [])
        if not page_features:
            break
        features.extend(page_features)
        if not payload.get("properties", {}).get("exceededTransferLimit"):
            break
        offset += PAGE_SIZE
    return features


def main() -> int:
    deprivation_index = fetch_deprivation_index()
    boundary_features = fetch_boundary_features()

    kept_features: list[dict] = []
    missing_codes: list[str] = []
    for feature in boundary_features:
        props = feature.get("properties", {})
        code = props.get("LSOA21CD")
        if not code:
            continue
        deprivation = deprivation_index.get(code)
        if deprivation is None:
            missing_codes.append(code)
            continue
        kept_features.append(
            {
                "type": "Feature",
                "properties": deprivation,
                "geometry": round_coords(feature.get("geometry")),
            }
        )

    geojson = {
        "type": "FeatureCollection",
        "features": kept_features,
    }
    summary = {
        "feature_count": len(kept_features),
        "missing_deprivation_rows": len(missing_codes),
        "missing_deprivation_codes_sample": missing_codes[:20],
        "sources": {
            "deprivation_release_page": "https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025",
            "deprivation_csv": DEPRIVATION_CSV_URL,
            "boundary_about": BOUNDARY_ABOUT_URL,
            "boundary_query": BOUNDARY_QUERY_URL,
        },
        "filter": {
            "territory": "England",
            "where": "LSOA21CD LIKE 'E%'",
        },
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_GEOJSON.write_text(json.dumps(geojson, separators=(",", ":")), encoding="utf-8")
    OUTPUT_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(OUTPUT_GEOJSON)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
