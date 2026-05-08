# Catchment Deprivation Subset

This folder holds a one-time small-area deprivation subset for the current GTD catchment map.

Files:

- `build_catchment_subset.py` - one-off prep script that fetches the official 2025 deprivation CSV and the official 2021 LSOA boundary service, then writes the local catchment subset.
- `build_practice_deprivation_lookup_all.py` - reusable dev-time script that matches current regional and national practice coordinates to official EW LSOA polygons, then persists a per-practice lookup for map builds.
- `output/catchment_lsoa_imd_2025.geojson` - the prepared polygon subset used by the map layer.
- `output/catchment_lsoa_imd_2025_summary.json` - fetch metadata, bbox, feature counts and source URLs.
- `output/practice_deprivation_lookup_all.json` - cached all-practice deprivation lookup used by the map build.
- `output/practice_deprivation_lookup_all_summary.json` - status counts and source metadata for the cached all-practice lookup.

Workflow:

- Run `yarn deprivation:lookup` after pulling in new practice coordinates, especially after national Google Maps scans have added more supplementals.
- The site/map build should only read the cached lookup; it should not recompute point-in-polygon deprivation matches.
- Current deprivation scoring is fully wired for England via IMD 2025. Wales currently retains matched EW polygon identity without a joined deprivation score, and Scotland / Northern Ireland remain explicit unsupported states until equivalent polygon/index sources are added.

TODOs:

- Find and wire the official Wales patient-count source so national supplemental patient-total views are not England-only.
- Find and wire the official Scotland patient-count source so national supplemental patient-total views can include Scottish practices.
- Find and wire the official Northern Ireland patient-count source so national supplemental patient-total views can include NI practices.
- Record each of those source URLs and update steps in this folder once added, so future reruns can refresh them the same way as England.
- Find and wire comparable deprivation-index sources for Wales, Scotland and Northern Ireland, then extend `build_practice_deprivation_lookup_all.py` so those nations no longer land in placeholder states.
- Find and wire comparable national practice-level survey completion-rate sources for Wales, Scotland and Northern Ireland, so the completion/deprivation analysis is not England-led.
- Extend the existing completion-rate chart's national scope once those non-English sources are wired, so the national completion view becomes properly UK-wide rather than mostly England plus any future equivalents.

Source data:

- English Indices of Deprivation 2025 release page:
  https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025
- Official CSV used here:
  https://assets.publishing.service.gov.uk/media/691ded56d140bbbaa59a2a7d/File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv
- Official ONS 2021 LSOA boundary service used here:
  https://geoportal.statistics.gov.uk/datasets/ons::lower-layer-super-output-areas-december-2021-boundaries-ew-bsc-v4/about

This data is deliberately prepared outside the normal site/map build. The build only reads the checked-in subset.
