# Versions and history

Karet versions two things independently: the **config** that describes a
pipeline, and the **data** each run publishes.

## Config history

Every save inserts a numbered row in Postgres, and a pointer says which one is
live:

```text
config_versions      (pipeline, version, config, author, note, created_at)
pipelines_current    (pipeline, config_version_id)
```

Nothing is updated in place, so the trail cannot be rewritten, and a run carries
the version id it should use rather than reading whatever the head says when it
starts.

The **History** page lists versions newest first with the author, and shows the
diff between the version you are inspecting and the one that is live, the way you
would read a `git diff`. Layout is ignored when deciding whether anything changed:
moving a node on the graph is saved, but the diff leaves it out so it does not
hide real edits.

Restoring writes the chosen config forward as a new version rather than winding
history back, so the trail stays append-only and a restore you regret is just
another restore. The restored config is re-validated first, since an old version
can predate a schema change.

Every version is kept until the pipeline is deleted.

### Two editors, one pipeline

A save carries the version the editor loaded, in an `X-Karet-Config-Version`
header. If the live version has moved on, the save is refused with `412` and the
editor keeps your changes and tells you to reload, rather than overwriting
whatever the other person did.

## Data versions

A run never writes over what readers are scanning. Output lands under a new
version prefix, and the run publishes by replacing one small pointer object:

```text
pipelines/<slug>/<table>/_current.json          {"version": 7}
pipelines/<slug>/<table>/_manifests/7.json      the file list for version 7
pipelines/<slug>/<table>/_sources/7.json        the source files version 7 was built from
pipelines/<slug>/<table>/v7/<hive segments>/<mapping>.parquet
```

An [incremental run](/reference/pipeline-config#incremental-runs) rewrites only
the partitions that get new rows, so a manifest can list files from several
`v<n>/` prefixes.

A single-object write is atomic, so a dashboard query either sees the whole
previous version or the whole new one, never a half-written table. A run that
fails partway publishes nothing, leaving the previous version live and the
orphaned files for the vacuum to collect.

The last 10 versions of each table are retained. On each publish the worker
deletes manifests and source records past that window and any object no
retained manifest references, which bounds storage and collects a dead run's
leftovers.

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
