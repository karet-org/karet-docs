# Versions and history

Karet versions two things independently: the **config** that describes a
pipeline, and the **data** each run publishes.

## Config history

Every save writes a numbered entry beside the live config:

```text
pipelines/<slug>/pipeline.json          the live config, what the worker reads
pipelines/<slug>/_history/<n>.json      { version, saved_at, author, note, config }
```

The **History** page lists them newest first with the author and a summary of
what changed. Layout is ignored when computing that summary: dragging a node
around the graph is recorded, but it is not a change to the pipeline, and
counting it would bury the real edits.

Restoring writes the chosen config forward as a new version rather than winding
history back, so the trail stays append-only and a restore you regret is just
another restore. The restored config is re-validated first, since an old version
can predate a schema change.

The last 100 versions per pipeline are kept.

## Data versions

A run never writes over what readers are scanning. Output lands under a new
version prefix, and the run publishes by replacing one small pointer object:

```text
pipelines/<slug>/<table>/_current.json          {"version": 7}
pipelines/<slug>/<table>/_manifests/7.json      the file list for version 7
pipelines/<slug>/<table>/v7/<hive segments>/<mapping>.parquet
```

A single-object write is atomic, so a dashboard query either sees the whole
previous version or the whole new one, never a half-written table. A run that
fails partway publishes nothing, leaving the previous version live and the
orphaned files for the vacuum to collect.

The last 10 versions of each table are retained. On each publish the worker
deletes manifests past that window and any object no retained manifest
references, which bounds storage and collects a dead run's leftovers.

### Time travel

The **Versions** view in a table's panel on the Data page lists what is
retained, with sizes and which version is live. Any of them can be read
directly:

```sh
# Rows as of a version
curl ".../api/p/<slug>/tables/<table>/rows?version=17"

# Or one SQL statement reading a table as of a version
curl -X POST ".../api/p/<slug>/query" -H 'Content-Type: application/json' \
  -d '{"sql": "SELECT count(*) FROM requests", "versions": {"requests": 17}}'
```

### Rolling back

Restoring a version makes it live again for every reader at once. No Parquet is
copied: the new version names the same objects, and, like config restore, the
pointer only ever climbs, so the next run cannot collide with a number it
already used.

Restoring a table's data and restoring its config are separate actions. Rolling
back a bad config does not rewrite the data that config produced; re-run the
pipeline, or roll the table back too.

## Upgrading a pre-manifest instance

Instances that ran before this layout have unversioned Parquet sitting directly
under the table prefix, which readers no longer glob. One script describes what
is already there as version 1, so nothing moves:

```sh
DRY_RUN=1 node scripts/adopt-warehouse-manifests.mjs   # report only
node scripts/adopt-warehouse-manifests.mjs             # every pipeline
```

It skips tables that already have a pointer, so it is safe to re-run.
