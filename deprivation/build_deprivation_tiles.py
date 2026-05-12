#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import shutil
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
SOURCE_GEOJSON = OUTPUT_DIR / "england-lsoa-imd-2025.geojson"
SOURCE_SUMMARY = OUTPUT_DIR / "england-lsoa-imd-2025_summary.json"
CENSUS_SUMMARY = REPO_ROOT / "src" / "data" / "england-census-lsoa-summary.json"
TILES_DIR = REPO_ROOT / "public" / "data" / "england-lsoa-imd-2025_tiles"
MANIFEST_JSON = TILES_DIR / "manifest.json"
TILE_ZOOM = 8
CENSUS_TILE_FIELDS = [
    "white_british_pct",
    "uk_born_pct",
    "english_only_identity_pct",
    "english_or_british_only_identity_pct",
    "christian_pct",
    "no_religion_pct",
    "muslim_pct",
    "age_50plus_pct",
    "age_65plus_pct",
    "owner_occupied_pct",
    "private_rented_pct",
    "social_rented_pct",
    "nssec_managerial_professional_pct",
    "nssec_working_class_pct",
    "degree_pct",
    "no_qualifications_pct",
]


def mercator_x(lon: float) -> float:
    return (lon + 180.0) / 360.0


def mercator_y(lat: float) -> float:
    bounded_lat = max(min(lat, 85.05112878), -85.05112878)
    radians_lat = math.radians(bounded_lat)
    return (1.0 - math.log(math.tan((math.pi / 4.0) + (radians_lat / 2.0))) / math.pi) / 2.0


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    scale = 2**zoom
    x = int(min(max(math.floor(mercator_x(lon) * scale), 0), scale - 1))
    y = int(min(max(math.floor(mercator_y(lat) * scale), 0), scale - 1))
    return x, y


def walk_bbox(node: Any, bounds: list[float]) -> None:
    if isinstance(node, (list, tuple)):
        if len(node) >= 2 and all(isinstance(value, (int, float)) for value in node[:2]):
            lon = float(node[0])
            lat = float(node[1])
            bounds[0] = min(bounds[0], lon)
            bounds[1] = min(bounds[1], lat)
            bounds[2] = max(bounds[2], lon)
            bounds[3] = max(bounds[3], lat)
            return
        for item in node:
            walk_bbox(item, bounds)


def bbox_from_geometry(geometry: dict[str, Any]) -> list[float] | None:
    coordinates = geometry.get("coordinates")
    if coordinates is None:
        return None
    bounds = [math.inf, math.inf, -math.inf, -math.inf]
    walk_bbox(coordinates, bounds)
    if not math.isfinite(bounds[0]):
        return None
    return [round(value, 6) for value in bounds]


def centroid_from_bbox(bbox: list[float]) -> tuple[float, float]:
    return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)


def main() -> int:
    if not SOURCE_GEOJSON.exists():
        raise FileNotFoundError(f"Missing source GeoJSON: {SOURCE_GEOJSON}")

    payload = json.loads(SOURCE_GEOJSON.read_text(encoding="utf-8"))
    source_summary = {}
    if SOURCE_SUMMARY.exists():
        source_summary = json.loads(SOURCE_SUMMARY.read_text(encoding="utf-8"))
    census_by_lsoa: dict[str, dict[str, Any]] = {}
    if CENSUS_SUMMARY.exists():
        census_payload = json.loads(CENSUS_SUMMARY.read_text(encoding="utf-8"))
        for row in census_payload.get("rows", []):
            code = str(row.get("lsoa21cd", "")).strip()
            if code:
                census_by_lsoa[code] = row

    features = payload.get("features", [])
    tiles: dict[tuple[int, int], list[dict[str, Any]]] = {}

    for feature in features:
        geometry = feature.get("geometry") or {}
        bbox = bbox_from_geometry(geometry)
        if not bbox:
            continue
        centroid_lon, centroid_lat = centroid_from_bbox(bbox)
        tile_x, tile_y = lonlat_to_tile(centroid_lon, centroid_lat, TILE_ZOOM)
        properties = dict(feature.get("properties") or {})
        census_row = census_by_lsoa.get(str(properties.get("lsoa21cd", "")).strip())
        if census_row:
            for field in CENSUS_TILE_FIELDS:
                if field in census_row:
                    properties[field] = census_row[field]
        properties["tile_z"] = TILE_ZOOM
        properties["tile_x"] = tile_x
        properties["tile_y"] = tile_y
        properties["bbox"] = bbox
        tile_key = (tile_x, tile_y)
        tiles.setdefault(tile_key, []).append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": geometry,
            }
        )

    if TILES_DIR.exists():
        shutil.rmtree(TILES_DIR)
    TILES_DIR.mkdir(parents=True, exist_ok=True)

    manifest_tiles = []
    total_bytes = 0
    for (tile_x, tile_y), tile_features in sorted(tiles.items()):
        tile_dir = TILES_DIR / str(TILE_ZOOM) / str(tile_x)
        tile_dir.mkdir(parents=True, exist_ok=True)
        tile_path = tile_dir / f"{tile_y}.geojson"
        tile_bbox = [
            min(feature["properties"]["bbox"][0] for feature in tile_features),
            min(feature["properties"]["bbox"][1] for feature in tile_features),
            max(feature["properties"]["bbox"][2] for feature in tile_features),
            max(feature["properties"]["bbox"][3] for feature in tile_features),
        ]
        tile_payload = {
            "type": "FeatureCollection",
            "metadata": {
                "tile_z": TILE_ZOOM,
                "tile_x": tile_x,
                "tile_y": tile_y,
                "feature_count": len(tile_features),
                "bbox": [round(value, 6) for value in tile_bbox],
            },
            "features": tile_features,
        }
        serialized = json.dumps(tile_payload, ensure_ascii=False, separators=(",", ":"))
        tile_path.write_text(serialized, encoding="utf-8")
        file_size = tile_path.stat().st_size
        total_bytes += file_size
        manifest_tiles.append(
            {
                "z": TILE_ZOOM,
                "x": tile_x,
                "y": tile_y,
                "file": f"{TILE_ZOOM}/{tile_x}/{tile_y}.geojson",
                "feature_count": len(tile_features),
                "bbox": [round(value, 6) for value in tile_bbox],
                "file_size_bytes": file_size,
            }
        )

    manifest = {
        "type": "deprivation-tile-index",
        "version": "2026-05-12",
        "tile_zoom": TILE_ZOOM,
        "source_geojson": str(SOURCE_GEOJSON),
        "source_summary": source_summary,
        "census_summary": str(CENSUS_SUMMARY) if CENSUS_SUMMARY.exists() else None,
        "census_tile_fields": CENSUS_TILE_FIELDS,
        "tile_count": len(manifest_tiles),
        "feature_count": sum(tile["feature_count"] for tile in manifest_tiles),
        "total_file_size_bytes": total_bytes,
        "tiles": manifest_tiles,
    }
    MANIFEST_JSON.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "tiles_dir": str(TILES_DIR),
        "manifest_json": str(MANIFEST_JSON),
        "tile_count": manifest["tile_count"],
        "feature_count": manifest["feature_count"],
        "total_file_size_bytes": total_bytes,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
