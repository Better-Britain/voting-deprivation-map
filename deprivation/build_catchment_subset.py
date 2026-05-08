#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent.parent
REPORT_GLOB = "gtd-greater-manchester-gp-practice-reviews-*"
REPORT_PARENT = REPO_ROOT / "datasets" / "output"
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_GEOJSON = OUTPUT_DIR / "catchment_lsoa_imd_2025.geojson"
OUTPUT_SUMMARY = OUTPUT_DIR / "catchment_lsoa_imd_2025_summary.json"

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

PAD_DEGREES = 0.08
PAGE_SIZE = 1000


def find_latest_report() -> Path:
    candidates = sorted(path for path in REPORT_PARENT.glob(REPORT_GLOB) if path.is_dir())
    if not candidates:
        raise FileNotFoundError(f"No report directories found under {REPORT_PARENT}")
    return candidates[-1]


def load_bbox() -> tuple[float, float, float, float]:
    report_dir = find_latest_report()
    rows_path = report_dir / "gtd_greater_manchester_gp_practices.json"
    rows = json.loads(rows_path.read_text(encoding="utf-8"))
    lons = [float(row["longitude"]) for row in rows if row.get("longitude") not in (None, "")]
    lats = [float(row["latitude"]) for row in rows if row.get("latitude") not in (None, "")]
    if not lons or not lats:
        raise RuntimeError(f"No practice coordinates found in {rows_path}")
    return (
        min(lons) - PAD_DEGREES,
        min(lats) - PAD_DEGREES,
        max(lons) + PAD_DEGREES,
        max(lats) + PAD_DEGREES,
    )


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


def boundary_query_url(bbox: tuple[float, float, float, float], *, offset: int) -> str:
    params = {
        "where": "1=1",
        "geometry": ",".join(f"{value:.6f}" for value in bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
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


def fetch_boundary_features(bbox: tuple[float, float, float, float]) -> list[dict]:
    features: list[dict] = []
    offset = 0
    while True:
        payload = fetch_json(boundary_query_url(bbox, offset=offset))
        page_features = payload.get("features", [])
        if not page_features:
            break
        features.extend(page_features)
        if not payload.get("properties", {}).get("exceededTransferLimit"):
            break
        offset += PAGE_SIZE
    return features


def main() -> int:
    bbox = load_bbox()
    deprivation_index = fetch_deprivation_index()
    boundary_features = fetch_boundary_features(bbox)

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
        "bbox_wgs84": [round(value, 6) for value in bbox],
        "sources": {
            "deprivation_release_page": "https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025",
            "deprivation_csv": DEPRIVATION_CSV_URL,
            "boundary_about": BOUNDARY_ABOUT_URL,
            "boundary_query": BOUNDARY_QUERY_URL,
        },
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_GEOJSON.write_text(json.dumps(geojson, separators=(",", ":")), encoding="utf-8")
    OUTPUT_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(OUTPUT_GEOJSON)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
