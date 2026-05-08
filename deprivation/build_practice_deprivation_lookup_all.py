#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen


BASE_DIR = Path(__file__).resolve().parent
DATASETS_DIR = BASE_DIR.parent
GM_DATASET_DIR = DATASETS_DIR / "output" / "gtd-greater-manchester-gp-practice-reviews-2026-03-09"
GM_DATASET_JSON = GM_DATASET_DIR / "gtd_greater_manchester_gp_practices.json"
NATIONAL_DIR = DATASETS_DIR / "national-practices" / "output"
NATIONAL_INPUT_CSV = NATIONAL_DIR / "uk_gp_practices_not_in_current_dataset.csv"
NATIONAL_GOOGLE_JSON = NATIONAL_DIR / "google_maps_recent_reviews.json"
OUTPUT_JSON = BASE_DIR / "output" / "practice_deprivation_lookup_all.json"
OUTPUT_SUMMARY_JSON = BASE_DIR / "output" / "practice_deprivation_lookup_all_summary.json"

DEPRIVATION_CSV_URL = (
    "https://assets.publishing.service.gov.uk/media/691ded56d140bbbaa59a2a7d/"
    "File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv"
)
BOUNDARY_QUERY_URL = (
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/"
    "Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BSC_V4/FeatureServer/0/query"
)
BOUNDARY_ABOUT_URL = (
    "https://geoportal.statistics.gov.uk/datasets/ons::lower-layer-super-output-areas-december-2021-boundaries-ew-bsc-v4/about"
)
PAGE_SIZE = 1000
PAD_DEGREES = 0.08
GRID_SIZE_DEGREES = 0.12


@dataclass(frozen=True)
class PracticePoint:
    code: str
    name: str
    nation: str
    lat: float
    lon: float
    source_type: str


@dataclass(frozen=True)
class BoundaryPolygon:
    code: str
    name: str
    bbox: tuple[float, float, float, float]
    polygons: tuple[tuple[tuple[tuple[float, float], ...], ...], ...]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=180) as response:
        return json.load(response)


def fetch_text(url: str) -> str:
    with urlopen(url, timeout=180) as response:
        return response.read().decode("utf-8-sig", "ignore")


def parse_google_maps_coordinates(url: str) -> tuple[float, float] | None:
    if not url:
        return None
    for pattern in (
        r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)",
        r"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)",
    ):
        match = re.search(pattern, url)
        if not match:
            continue
        try:
            return float(match.group(1)), float(match.group(2))
        except ValueError:
            continue
    return None


def load_national_input_index(path: Path = NATIONAL_INPUT_CSV) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    return {
        str(row.get("canonical_code", "")).strip(): row
        for row in rows
        if str(row.get("canonical_code", "")).strip()
    }


def include_national_result(result: dict[str, Any]) -> bool:
    if bool(result.get("manual_review_required")):
        return False
    if bool(result.get("wrong_place_match")):
        return False
    if bool(result.get("blocked_place_match")):
        return False
    if bool(result.get("sponsored_place_match")) or bool(result.get("sponsored_search_results_only")):
        return False
    page_kind = str(result.get("page_kind", "")).strip()
    url = str(result.get("google_maps_url", "")).strip()
    if not page_kind:
        if "/place/" in url:
            page_kind = "place"
        elif "/search/" in url:
            page_kind = "search"
        else:
            page_kind = "other"
    return page_kind == "place"


def load_practice_points() -> list[PracticePoint]:
    points: dict[str, PracticePoint] = {}

    gm_rows = load_json(GM_DATASET_JSON)
    for row in gm_rows:
        try:
            code = str(row.get("canonical_code", "")).strip()
            lat = float(row.get("latitude"))
            lon = float(row.get("longitude"))
        except (TypeError, ValueError):
            continue
        if not code:
            continue
        points[code] = PracticePoint(
            code=code,
            name=str(row.get("practice_name", "")).strip(),
            nation="england",
            lat=lat,
            lon=lon,
            source_type="regional_dataset",
        )

    national_index = load_national_input_index()
    if NATIONAL_GOOGLE_JSON.exists():
        national_results = load_json(NATIONAL_GOOGLE_JSON)
        for result in national_results:
            if not isinstance(result, dict) or not include_national_result(result):
                continue
            code = str(result.get("canonical_code", "")).strip()
            if not code or code in points:
                continue
            coords = None
            try:
                raw_lat = result.get("latitude")
                raw_lon = result.get("longitude")
                if raw_lat not in ("", None) and raw_lon not in ("", None):
                    coords = (float(raw_lat), float(raw_lon))
            except (TypeError, ValueError):
                coords = None
            if coords is None:
                coords = parse_google_maps_coordinates(str(result.get("google_maps_url", "")))
            if coords is None:
                continue
            source_row = national_index.get(code, {})
            points[code] = PracticePoint(
                code=code,
                name=str(source_row.get("practice_name") or result.get("practice_name") or result.get("google_maps_title") or code).strip(),
                nation=str(source_row.get("nation", "")).strip().lower() or "england",
                lat=coords[0],
                lon=coords[1],
                source_type="national_google_quick_scan",
            )

    return sorted(points.values(), key=lambda point: (point.nation, point.code))


def fetch_deprivation_index() -> dict[str, dict[str, object]]:
    reader = csv.DictReader(fetch_text(DEPRIVATION_CSV_URL).splitlines())
    index: dict[str, dict[str, object]] = {}
    for row in reader:
        code = row["LSOA code (2021)"].strip()
        index[code] = {
            "lsoa_code": code,
            "lsoa_name": row["LSOA name (2021)"].strip(),
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


def boundary_query_url(bbox: tuple[float, float, float, float], offset: int) -> str:
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
        "geometryPrecision": "6",
    }
    return f"{BOUNDARY_QUERY_URL}?{urlencode(params)}"


def fetch_boundary_features(bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    offset = 0
    while True:
        payload = fetch_json(boundary_query_url(bbox, offset))
        page = payload.get("features", [])
        if not page:
            break
        features.extend(page)
        if not payload.get("properties", {}).get("exceededTransferLimit"):
            break
        offset += PAGE_SIZE
    return features


def point_bbox(points: list[PracticePoint]) -> tuple[float, float, float, float]:
    lons = [point.lon for point in points]
    lats = [point.lat for point in points]
    return (
        min(lons) - PAD_DEGREES,
        min(lats) - PAD_DEGREES,
        max(lons) + PAD_DEGREES,
        max(lats) + PAD_DEGREES,
    )


def normalize_ring(ring: list[list[float]]) -> tuple[tuple[float, float], ...]:
    return tuple((float(point[0]), float(point[1])) for point in ring if len(point) >= 2)


def geometry_to_polygons(geometry: dict[str, Any]) -> tuple[tuple[tuple[tuple[float, float], ...], ...], ...]:
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates") or []
    polygons: list[tuple[tuple[tuple[float, float], ...], ...]] = []
    if geom_type == "Polygon":
        rings = tuple(normalize_ring(ring) for ring in coords if ring)
        if rings:
            polygons.append(rings)
    elif geom_type == "MultiPolygon":
        for polygon in coords:
            rings = tuple(normalize_ring(ring) for ring in polygon if ring)
            if rings:
                polygons.append(rings)
    return tuple(polygons)


def polygon_bbox(polygons: tuple[tuple[tuple[tuple[float, float], ...], ...], ...]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for polygon in polygons:
        for ring in polygon:
            for lon, lat in ring:
                xs.append(lon)
                ys.append(lat)
    return min(xs), min(ys), max(xs), max(ys)


def build_boundary_polygons(features: list[dict[str, Any]]) -> list[BoundaryPolygon]:
    polygons: list[BoundaryPolygon] = []
    for feature in features:
        props = feature.get("properties", {}) or {}
        code = str(props.get("LSOA21CD", "")).strip()
        if not code:
            continue
        polygon_parts = geometry_to_polygons(feature.get("geometry") or {})
        if not polygon_parts:
            continue
        polygons.append(
            BoundaryPolygon(
                code=code,
                name=str(props.get("LSOA21NM", "")).strip(),
                bbox=polygon_bbox(polygon_parts),
                polygons=polygon_parts,
            )
        )
    return polygons


def grid_key(lon: float, lat: float) -> tuple[int, int]:
    return (math.floor(lon / GRID_SIZE_DEGREES), math.floor(lat / GRID_SIZE_DEGREES))


def build_grid_index(polygons: list[BoundaryPolygon]) -> dict[tuple[int, int], list[int]]:
    index: dict[tuple[int, int], list[int]] = {}
    for polygon_index, polygon in enumerate(polygons):
        min_lon, min_lat, max_lon, max_lat = polygon.bbox
        min_x, min_y = grid_key(min_lon, min_lat)
        max_x, max_y = grid_key(max_lon, max_lat)
        for grid_x in range(min_x, max_x + 1):
            for grid_y in range(min_y, max_y + 1):
                index.setdefault((grid_x, grid_y), []).append(polygon_index)
    return index


def point_in_ring(lon: float, lat: float, ring: tuple[tuple[float, float], ...]) -> bool:
    inside = False
    if len(ring) < 3:
        return False
    x1, y1 = ring[-1]
    for x2, y2 in ring:
        intersects = ((y1 > lat) != (y2 > lat))
        if intersects:
            try:
                x_at_y = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            except ZeroDivisionError:
                x_at_y = x1
            if lon < x_at_y:
                inside = not inside
        x1, y1 = x2, y2
    return inside


def point_in_polygon(lon: float, lat: float, polygon: tuple[tuple[tuple[float, float], ...], ...]) -> bool:
    outer = polygon[0]
    if not point_in_ring(lon, lat, outer):
        return False
    for hole in polygon[1:]:
        if point_in_ring(lon, lat, hole):
            return False
    return True


def locate_polygon(
    point: PracticePoint,
    polygons: list[BoundaryPolygon],
    grid_index: dict[tuple[int, int], list[int]],
) -> BoundaryPolygon | None:
    candidate_indices = grid_index.get(grid_key(point.lon, point.lat), [])
    for polygon_index in candidate_indices:
        polygon = polygons[polygon_index]
        min_lon, min_lat, max_lon, max_lat = polygon.bbox
        if point.lon < min_lon or point.lon > max_lon or point.lat < min_lat or point.lat > max_lat:
            continue
        for polygon_part in polygon.polygons:
            if point_in_polygon(point.lon, point.lat, polygon_part):
                return polygon
    return None


def load_existing_lookup(path: Path = OUTPUT_JSON) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    return {
        str(code).strip(): value
        for code, value in payload.items()
        if str(code).strip() and isinstance(value, dict)
    }


def cache_matches(point: PracticePoint, cached: dict[str, Any]) -> bool:
    try:
        return (
            str(cached.get("nation", "")).strip().lower() == point.nation
            and str(cached.get("source_type", "")).strip() == point.source_type
            and abs(float(cached.get("lat")) - point.lat) < 1e-9
            and abs(float(cached.get("lon")) - point.lon) < 1e-9
        )
    except (TypeError, ValueError):
        return False


def base_result(point: PracticePoint) -> dict[str, Any]:
    return {
        "code": point.code,
        "practice_name": point.name,
        "nation": point.nation,
        "source_type": point.source_type,
        "lat": round(point.lat, 6),
        "lon": round(point.lon, 6),
        "lookup_status": "",
        "lookup_source": "",
        "deprivation_dataset": "",
        "lsoa_code": "",
        "lsoa_name": "",
        "imd_decile": "",
        "imd_rank": "",
        "imd_score": "",
        "health_decile": "",
        "lad24cd": "",
        "lad24nm": "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Persist a reusable all-practice deprivation lookup for map builds.")
    parser.add_argument("--refresh-all", action="store_true", help="Ignore any cached lookup entries and recompute every current practice.")
    args = parser.parse_args()

    points = load_practice_points()
    existing_lookup = {} if args.refresh_all else load_existing_lookup()

    resolved: dict[str, dict[str, Any]] = {}
    pending_ew: list[PracticePoint] = []
    reused_count = 0

    for point in points:
        cached = existing_lookup.get(point.code)
        if cached and cache_matches(point, cached):
            resolved[point.code] = cached
            reused_count += 1
            continue

        if point.nation in {"england", "wales"}:
            pending_ew.append(point)
            continue

        item = base_result(point)
        item["lookup_status"] = "unsupported_nation"
        item["lookup_source"] = "no_polygon_dataset_configured"
        item["deprivation_dataset"] = "unsupported"
        resolved[point.code] = item

    if pending_ew:
        deprivation_index = fetch_deprivation_index()
        bbox = point_bbox(pending_ew)
        features = fetch_boundary_features(bbox)
        polygons = build_boundary_polygons(features)
        grid_index = build_grid_index(polygons)
        for point in pending_ew:
            item = base_result(point)
            polygon = locate_polygon(point, polygons, grid_index)
            if polygon is None:
                item["lookup_status"] = "no_polygon_match"
                item["lookup_source"] = "ons_ew_lsoa21_boundaries"
                item["deprivation_dataset"] = "none"
                resolved[point.code] = item
                continue

            item["lookup_source"] = "ons_ew_lsoa21_boundaries_point_in_polygon"
            item["lsoa_code"] = polygon.code
            item["lsoa_name"] = polygon.name
            deprivation = deprivation_index.get(polygon.code)
            if deprivation is None:
                item["lookup_status"] = "matched_polygon_no_deprivation_index"
                item["deprivation_dataset"] = "polygon_only_no_index"
                resolved[point.code] = item
                continue

            item["lookup_status"] = "matched_imd_2025_england"
            item["deprivation_dataset"] = "english_imd_2025_lsoa21"
            item["imd_decile"] = deprivation.get("imd_decile", "")
            item["imd_rank"] = deprivation.get("imd_rank", "")
            item["imd_score"] = deprivation.get("imd_score", "")
            item["health_decile"] = deprivation.get("health_decile", "")
            item["lad24cd"] = deprivation.get("lad24cd", "")
            item["lad24nm"] = deprivation.get("lad24nm", "")
            resolved[point.code] = item

    ordered = {code: resolved[code] for code in sorted(resolved)}
    status_counts: dict[str, int] = {}
    nation_counts: dict[str, int] = {}
    for item in ordered.values():
        status = str(item.get("lookup_status", "")).strip() or "unknown"
        nation = str(item.get("nation", "")).strip() or "unknown"
        status_counts[status] = status_counts.get(status, 0) + 1
        nation_counts[nation] = nation_counts.get(nation, 0) + 1

    summary = {
        "practice_count": len(ordered),
        "reused_cached_count": reused_count,
        "recomputed_count": len(ordered) - reused_count,
        "status_counts": status_counts,
        "nation_counts": nation_counts,
        "sources": {
            "deprivation_csv": DEPRIVATION_CSV_URL,
            "boundary_query": BOUNDARY_QUERY_URL,
            "boundary_about": BOUNDARY_ABOUT_URL,
            "gm_dataset_json": str(GM_DATASET_JSON),
            "national_input_csv": str(NATIONAL_INPUT_CSV),
            "national_google_json": str(NATIONAL_GOOGLE_JSON),
        },
        "notes": [
            "English IMD 2025 values are joined to ONS EW 2021 LSOA polygons by point-in-polygon using practice coordinates.",
            "Welsh matches currently retain polygon identity but do not yet have a comparable deprivation index wired in.",
            "Scotland and Northern Ireland are retained with unsupported_nation status until equivalent polygon/index sources are added.",
        ],
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(ordered, indent=2, ensure_ascii=False), encoding="utf-8")
    OUTPUT_SUMMARY_JSON.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(OUTPUT_JSON)
    print(OUTPUT_SUMMARY_JSON)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
