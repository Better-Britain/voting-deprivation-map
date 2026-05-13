# Voting Deprivation Map

I hear a lot of people say these stupid poor people should stop voting for Reform, and I wondered if it really was mainly the poor.

Thanks to the 2026 local elections, we finally have enough data to look at who actually likes Reform, and so-far (still many more results to be counted) it's mostly the middle classes.

The map is at [https://better-britain.github.io/voting-deprivation-map/](https://better-britain.github.io/voting-deprivation-map/) as I haven't ported it to [betterbritain.org.uk](https://betterbritain.org.uk/) main site yet.

## Dataset Workflow

This repo ships real dataset files from `src/data` and the website reads those files directly. There is no production-side builder. Data refreshes happen in dev or CI and the resulting JSON/GeoJSON stays repo-tracked.

## TODO

- The ward scanner now separates current and historical refreshes and tracks pending wards, but Democracy Club current polling still scans the full current election date because the API path is still broad.
  - Next step: find a reliable narrower source or request pattern so pending-current refreshes do not need a full current-election sweep.

# Agents 

### Granular update commands

- `yarn data:update:wards`: refresh ward boundaries and the ward summary snapshot.
- `yarn data:update:councils`: refresh council boundaries and council control snapshot.
- `yarn data:update:election:current`: poll the current local election date only. It keeps declared wards and only checks the current cycle.
- `yarn data:update:election:current:force-all`: force a full current-cycle ward refresh.
- `yarn data:update:election:history`: fill missing prior-local comparators from frozen historical dates only once.
- `yarn data:update:election:history:force`: rebuild historical comparators from scratch.
- `yarn data:update:deprivation:source`: rebuild the deprivation source outputs and tile manifest.
- `yarn data:update:census:source`: rebuild the census source summaries.
- `yarn data:derive:deprivation`: rebuild the deprivation derivative datasets.
- `yarn data:derive:census`: rebuild the census derivative dataset.
- `yarn data:update:gp`: rebuild the GP practice import outputs.

### Umbrella maintenance command

- `yarn updates:maintenance`: run the source refresh pipeline and only rebuild downstream derived datasets when their inputs changed in that run.
- `yarn updates:maintenance:refresh-all-current`: same pipeline, but force a full current-cycle ward refresh.
- `yarn updates:maintenance:rebuild-history`: same pipeline, but force a historical comparator rebuild.

### Pipeline metadata

The update process writes small control manifests into `src/data`:

- `source-update-manifest.json`: last fetch time, version key, fetch mode, completion status, and output files per source refresh task.
- `ward-election-progress.json`: current pending ward tracking plus frozen historical election dates and missing comparator wards.
- `build-dependency-state.json`: last run state for derived dataset tasks and whether they ran or were skipped because inputs were unchanged.

One limitation remains at the Democracy Club API layer: when there are still pending current wards, the current updater still has to scan the current election pages because the API does not appear to offer a reliable ward-specific filter for this dataset.

### Manual fallback

`scripts/update-ward-winners-manual.mjs` remains a fallback for source gaps only. Normal automated maintenance should use the direct structured sources first and only merge manual captures when needed.
