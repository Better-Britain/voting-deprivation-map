#!/usr/bin/env python3
from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
CACHE_DIR = BASE_DIR / "cache"
DOWNLOADS_DIR = CACHE_DIR / "downloads"
OUTPUT_JSON = REPO_ROOT / "src" / "data" / "england-census-lsoa-summary.json"
OUTPUT_META_JSON = REPO_ROOT / "src" / "data" / "england-census-lsoa-summary.meta.json"

TABLES = {
    "ethnicity": {
        "url": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts021.zip",
        "lsoa_file": "census2021-ts021-lsoa.csv",
    },
    "country_of_birth": {
        "url": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts004.zip",
        "lsoa_file": "census2021-ts004-lsoa.csv",
    },
    "national_identity": {
        "url": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts027.zip",
        "lsoa_file": "census2021-ts027-lsoa.csv",
    },
    "religion": {
        "url": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts030.zip",
        "lsoa_file": "census2021-ts030-lsoa.csv",
    },
    "age": {
        "url": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts007a.zip",
        "lsoa_file": "census2021-ts007a-lsoa.csv",
    },
    "tenure": {
        "url": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts054.zip",
        "lsoa_file": "census2021-ts054-lsoa.csv",
    },
    "nssec": {
        "url": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts062.zip",
        "lsoa_file": "census2021-ts062-lsoa.csv",
    },
    "qualifications": {
        "url": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts067.zip",
        "lsoa_file": "census2021-ts067-lsoa.csv",
    },
}

FEATURE_CATALOG = [
    {
        "id": "white_british_pct",
        "label": "White British",
        "description": "Share of usual residents identifying as White British.",
    },
    {
        "id": "uk_born_pct",
        "label": "UK-born",
        "description": "Share of usual residents born in the United Kingdom.",
    },
    {
        "id": "english_only_identity_pct",
        "label": "English Identity Only",
        "description": "Share of usual residents reporting English only national identity.",
    },
    {
        "id": "english_or_british_only_identity_pct",
        "label": "English/British Identity",
        "description": "Share of usual residents reporting English only, British only, or English and British only identity.",
    },
    {
        "id": "christian_pct",
        "label": "Christian",
        "description": "Share of usual residents reporting Christian religion.",
    },
    {
        "id": "no_religion_pct",
        "label": "No Religion",
        "description": "Share of usual residents reporting no religion.",
    },
    {
        "id": "muslim_pct",
        "label": "Muslim",
        "description": "Share of usual residents reporting Muslim religion.",
    },
    {
        "id": "age_50plus_pct",
        "label": "Age 50+",
        "description": "Share of usual residents aged 50 and over.",
    },
    {
        "id": "age_65plus_pct",
        "label": "Age 65+",
        "description": "Share of usual residents aged 65 and over.",
    },
    {
        "id": "owner_occupied_pct",
        "label": "Owner Occupied",
        "description": "Share of households owner occupied.",
    },
    {
        "id": "private_rented_pct",
        "label": "Private Rented",
        "description": "Share of households privately rented.",
    },
    {
        "id": "social_rented_pct",
        "label": "Social Rented",
        "description": "Share of households socially rented.",
    },
    {
        "id": "nssec_managerial_professional_pct",
        "label": "Managerial/Professional",
        "description": "Share of residents aged 16+ in higher or lower managerial, administrative and professional NS-SeC groups.",
    },
    {
        "id": "nssec_working_class_pct",
        "label": "Semi-routine/Routine",
        "description": "Share of residents aged 16+ in semi-routine or routine NS-SeC groups.",
    },
    {
        "id": "degree_pct",
        "label": "Degree Level",
        "description": "Share of residents aged 16+ with level 4 qualifications and above.",
    },
    {
        "id": "no_qualifications_pct",
        "label": "No Qualifications",
        "description": "Share of residents aged 16+ with no qualifications.",
    },
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def download(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return destination
    with urlopen(url, timeout=180) as response:
        destination.write_bytes(response.read())
    return destination


def read_zip_csv(zip_path: Path, csv_name: str) -> list[dict[str, str]]:
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open(csv_name) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8-sig", newline="")
            return list(csv.DictReader(text))


def parse_number(value: str | None) -> float:
    raw = str(value or "").strip()
    if not raw:
        return 0.0
    return float(raw.replace(",", ""))


def select_field(row: dict[str, str], exact: str) -> float:
    return parse_number(row.get(exact))


def build_rows() -> list[dict[str, float | str]]:
    table_rows: dict[str, list[dict[str, str]]] = {}
    for key, config in TABLES.items():
        zip_name = config["url"].rsplit("/", 1)[-1]
        zip_path = download(config["url"], DOWNLOADS_DIR / zip_name)
        table_rows[key] = read_zip_csv(zip_path, config["lsoa_file"])

    rows_by_code: dict[str, dict[str, float | str]] = {}

    for row in table_rows["ethnicity"]:
        code = str(row["geography code"]).strip()
        if not code.startswith("E"):
            continue
        rows_by_code[code] = {
            "lsoa21cd": code,
            "lsoa21nm": str(row["geography"]).strip(),
            "ethnicity_total": select_field(row, "Ethnic group: Total: All usual residents"),
            "white_british": select_field(row, "Ethnic group: White: English, Welsh, Scottish, Northern Irish or British"),
        }

    for row in table_rows["country_of_birth"]:
        code = str(row["geography code"]).strip()
        if code not in rows_by_code:
            continue
        rows_by_code[code].update(
            {
                "country_of_birth_total": select_field(row, "Country of birth: Total; measures: Value"),
                "uk_born": select_field(row, "Country of birth: Europe: United Kingdom; measures: Value"),
            }
        )

    for row in table_rows["national_identity"]:
        code = str(row["geography code"]).strip()
        if code not in rows_by_code:
            continue
        rows_by_code[code].update(
            {
                "national_identity_total": select_field(row, "National identity: Total: All usual residents"),
                "british_only_identity": select_field(row, "National identity: British only identity"),
                "english_only_identity": select_field(row, "National identity: English only identity"),
                "english_and_british_only_identity": select_field(row, "National identity: English and British only identity"),
            }
        )

    for row in table_rows["religion"]:
        code = str(row["geography code"]).strip()
        if code not in rows_by_code:
            continue
        rows_by_code[code].update(
            {
                "religion_total": select_field(row, "Religion: Total: All usual residents"),
                "christian": select_field(row, "Religion: Christian"),
                "no_religion": select_field(row, "Religion: No religion"),
                "muslim": select_field(row, "Religion: Muslim"),
            }
        )

    age_50plus_columns = [
        "Age: Aged 50 to 54 years",
        "Age: Aged 55 to 59 years",
        "Age: Aged 60 to 64 years",
        "Age: Aged 65 to 69 years",
        "Age: Aged 70 to 74 years",
        "Age: Aged 75 to 79 years",
        "Age: Aged 80 to 84 years",
        "Age: Aged 85 years and over",
    ]
    age_65plus_columns = age_50plus_columns[3:]
    for row in table_rows["age"]:
        code = str(row["geography code"]).strip()
        if code not in rows_by_code:
            continue
        rows_by_code[code].update(
            {
                "age_total": select_field(row, "Age: Total"),
                "age_50plus": sum(select_field(row, column) for column in age_50plus_columns),
                "age_65plus": sum(select_field(row, column) for column in age_65plus_columns),
            }
        )

    for row in table_rows["tenure"]:
        code = str(row["geography code"]).strip()
        if code not in rows_by_code:
            continue
        rows_by_code[code].update(
            {
                "tenure_total_households": select_field(row, "Tenure of household: Total: All households"),
                "owner_occupied": select_field(row, "Tenure of household: Owned"),
                "owned_outright": select_field(row, "Tenure of household: Owned: Owns outright"),
                "owned_with_mortgage": select_field(row, "Tenure of household: Owned: Owns with a mortgage or loan"),
                "social_rented": select_field(row, "Tenure of household: Social rented"),
                "private_rented": select_field(row, "Tenure of household: Private rented"),
            }
        )

    for row in table_rows["nssec"]:
        code = str(row["geography code"]).strip()
        if code not in rows_by_code:
            continue
        higher = select_field(
            row,
            "National Statistics Socio-economic Classification (NS-SEC): L1, L2 and L3 Higher managerial, administrative and professional occupations",
        )
        lower = select_field(
            row,
            "National Statistics Socio-economic Classification (NS-SEC): L4, L5 and L6 Lower managerial, administrative and professional occupations",
        )
        semi = select_field(row, "National Statistics Socio-economic Classification (NS-SEC): L12 Semi-routine occupations")
        routine = select_field(row, "National Statistics Socio-economic Classification (NS-SEC): L13 Routine occupations")
        rows_by_code[code].update(
            {
                "nssec_total_16plus": select_field(
                    row,
                    "National Statistics Socio-economic Classification (NS-SEC): Total: All usual residents aged 16 years and over",
                ),
                "nssec_managerial_professional": higher + lower,
                "nssec_intermediate": select_field(
                    row,
                    "National Statistics Socio-economic Classification (NS-SEC): L7 Intermediate occupations",
                ),
                "nssec_small_employers": select_field(
                    row,
                    "National Statistics Socio-economic Classification (NS-SEC): L8 and L9 Small employers and own account workers",
                ),
                "nssec_semi_routine": semi,
                "nssec_routine": routine,
                "nssec_working_class": semi + routine,
                "nssec_never_worked_long_term_unemployed": select_field(
                    row,
                    "National Statistics Socio-economic Classification (NS-SEC): L14.1 and L14.2 Never worked and long-term unemployed",
                ),
            }
        )

    for row in table_rows["qualifications"]:
        code = str(row["geography code"]).strip()
        if code not in rows_by_code:
            continue
        rows_by_code[code].update(
            {
                "qualifications_total_16plus": select_field(
                    row, "Highest level of qualification: Total: All usual residents aged 16 years and over"
                ),
                "no_qualifications": select_field(row, "Highest level of qualification: No qualifications"),
                "degree_level": select_field(row, "Highest level of qualification: Level 4 qualifications and above"),
            }
        )

    output_rows = []
    for code, row in sorted(rows_by_code.items()):
        derived = dict(row)
        total_ethnicity = float(row.get("ethnicity_total", 0.0) or 0.0)
        total_birth = float(row.get("country_of_birth_total", 0.0) or 0.0)
        total_identity = float(row.get("national_identity_total", 0.0) or 0.0)
        total_religion = float(row.get("religion_total", 0.0) or 0.0)
        total_age = float(row.get("age_total", 0.0) or 0.0)
        total_tenure = float(row.get("tenure_total_households", 0.0) or 0.0)
        total_nssec = float(row.get("nssec_total_16plus", 0.0) or 0.0)
        total_qual = float(row.get("qualifications_total_16plus", 0.0) or 0.0)

        def pct(numerator: str, denominator: float) -> float | None:
            if denominator <= 0:
                return None
            return round(float(row.get(numerator, 0.0) or 0.0) / denominator, 6)

        derived["white_british_pct"] = pct("white_british", total_ethnicity)
        derived["uk_born_pct"] = pct("uk_born", total_birth)
        derived["english_only_identity_pct"] = pct("english_only_identity", total_identity)
        english_or_british_only = (
            float(row.get("english_only_identity", 0.0) or 0.0)
            + float(row.get("british_only_identity", 0.0) or 0.0)
            + float(row.get("english_and_british_only_identity", 0.0) or 0.0)
        )
        derived["english_or_british_only_identity"] = english_or_british_only
        derived["english_or_british_only_identity_pct"] = (
            round(english_or_british_only / total_identity, 6) if total_identity > 0 else None
        )
        derived["christian_pct"] = pct("christian", total_religion)
        derived["no_religion_pct"] = pct("no_religion", total_religion)
        derived["muslim_pct"] = pct("muslim", total_religion)
        derived["age_50plus_pct"] = pct("age_50plus", total_age)
        derived["age_65plus_pct"] = pct("age_65plus", total_age)
        derived["owner_occupied_pct"] = pct("owner_occupied", total_tenure)
        derived["private_rented_pct"] = pct("private_rented", total_tenure)
        derived["social_rented_pct"] = pct("social_rented", total_tenure)
        derived["nssec_managerial_professional_pct"] = pct("nssec_managerial_professional", total_nssec)
        derived["nssec_working_class_pct"] = pct("nssec_working_class", total_nssec)
        derived["degree_pct"] = pct("degree_level", total_qual)
        derived["no_qualifications_pct"] = pct("no_qualifications", total_qual)
        output_rows.append(derived)

    return output_rows


def main() -> int:
    rows = build_rows()
    payload = {
        "updated_at_utc": utc_now_iso(),
        "sources": {key: value["url"] for key, value in TABLES.items()},
        "feature_catalog": FEATURE_CATALOG,
        "rows": rows,
    }
    meta = {
        "updated_at_utc": payload["updated_at_utc"],
        "sources": payload["sources"],
        "feature_catalog": FEATURE_CATALOG,
        "counts": {
            "lsoas": len(rows),
        },
        "sample_lsoa_codes": [row["lsoa21cd"] for row in rows[:5]],
    }
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    OUTPUT_META_JSON.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "output_json": str(OUTPUT_JSON),
                "output_meta_json": str(OUTPUT_META_JSON),
                "lsoa_count": len(rows),
                "features": [feature["id"] for feature in FEATURE_CATALOG],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
