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

The analytic tables are [DuckLake](https://ducklake.select) tables. The catalog
is a separate Postgres database, `karet_lake`, and the Parquet files are in the
warehouse bucket under `lake/`. Each pipeline is a DuckLake schema named after
its slug, and each table is a DuckLake table.

A run writes each table in one transaction, so a dashboard query sees either the
whole previous version or the whole new one, never a half-written table. A run
that fails partway commits nothing for that table and leaves the previous
version live. A table version is a DuckLake snapshot that changed the table's
rows, and its number is the snapshot id, so the numbers of one table are not
consecutive.

Each table has one extra column, `_karet_mapping`, naming the mapping that wrote
the row. A mapping's full run replaces only its own rows, and an
[incremental run](/reference/pipeline-config#incremental-runs) only adds rows.
Queries from the web app do not show the column.

The last 10 versions of each table are retained. The files of a deleted
pipeline, or of a table a clean run recreated, are deleted once no retained
version of any table still reads them, which can take up to 10 more runs of
the other tables. After each commit the worker
merges the table's small files, expires older snapshots, and deletes data files
no retained snapshot reads once they are an hour old.

### Time travel

On the Data page, a table's **Properties** tab lists the versions that are
retained, with sizes and which version is live. Any of them can be read
directly:

```sh
# Rows as of a version
curl ".../api/p/<slug>/tables/<table>/rows?version=17"

# Or one SQL statement reading a table as of a version
curl -X POST ".../api/p/<slug>/query" -H 'Content-Type: application/json' \
  -d '{"sql": "SELECT count(*) FROM requests", "versions": {"requests": 17}}'
```

SQL you write cannot use `AT` or the DuckLake functions (`table_changes`,
`snapshots`, `ducklake_*`) itself. Older snapshots still hold the tables of
deleted pipelines until they expire, so reading versions goes through the
`versions` option, which only names this pipeline's tables.

### Rolling back

Restoring a version makes it live again for every reader at once. The worker
copies that version's rows into a new version, so a restore can itself be
undone, and the next run of each mapping is a full run. The worker holds the
pipeline's run lock while it restores, so a restore answers `409` while a run
is in progress.

Restoring a table's data and restoring its config are separate actions. Rolling
back a bad config does not rewrite the data that config produced; re-run the
pipeline, or roll the table back too.
