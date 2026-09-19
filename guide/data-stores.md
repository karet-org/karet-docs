# Where data lives

Karet keeps two kinds of state, in two places, on purpose.

**Postgres** holds the control plane: accounts and sessions, the pipeline
registry, config versions, and job history. These need constraints, indexes and
transactions: a unique username, one live config version per pipeline, and "how
often did runs fail last month" as a query rather than a scan.

**S3** holds the data plane and the documents you edit: raw files in the lake,
Parquet in the warehouse with the manifests that describe it, dashboard YAML and
saved queries. These are large, or they are text you want to export, diff and
keep in git.

| | Postgres | S3 |
|---|---|---|
| Accounts, sessions | ● | |
| Pipeline registry | ● | |
| Config, current and historical | ● | |
| Job history | ● | |
| Dashboards, saved queries | | ● |
| Lake files | | ● |
| Warehouse Parquet + manifests | | ● |

## Who writes what

One writer per table, so there is never a question of who is authoritative.

- The **web** writes accounts, sessions, the registry and config versions, and it
  owns migrations.
- The **worker** writes job rows, and reads the config version a run is pinned
  to. It assumes the schema exists and fails loudly if it does not.

## Runs are pinned to a config version

A run used to read whatever the config head said at the moment it started, so
saving partway through a run left the result unattributable. Now the queue
message carries a config version id: the run uses exactly that version, and its
job row records which one. Saving during a run cannot change what the run did.

Runs triggered by an upload are the exception, because an S3 event knows a prefix
rather than a version, so those resolve whichever version is live when execution
starts.

## Migrations

Plain `.sql` files in `migrations/`, applied in filename order, each in a
transaction, recorded in `_migrations`. They run from `scripts/db-setup.mjs`
before the server starts, so the schema can never be older than the code reading
it, and an advisory lock makes several containers starting at once safe.

The same script re-asserts the bootstrap admin from the environment, which is why
a wiped or edited `user` table cannot lock you out: restart, and the account is
back with the password the environment says it has.

## Backups

Two things to copy now, not one:

```sh
# The buckets: lake, warehouse, dashboards, queries.
aws s3 sync s3://karet-warehouse /backup/warehouse
aws s3 sync s3://karet-pipelines /backup/pipelines

# The control plane.
docker compose exec -T postgres pg_dump -U karet karet | gzip > /backup/karet.sql.gz
```

Losing Postgres now loses accounts, history and job records even if every byte of
Parquet survives, so restore the dump somewhere once and check it works. An
untested backup is not a backup.

## Coming from a pre-Postgres instance

One script moves what was in the buckets:

```sh
DRY_RUN=1 node scripts/import-s3-to-postgres.mjs   # report only
node scripts/import-s3-to-postgres.mjs             # every pipeline
node scripts/manage-users.mjs import-s3            # accounts
```

Both are idempotent and insert only what is missing. Nothing in S3 is deleted:
verify the import, then remove the old `pipeline.json`, `_history/` and `jobs/`
objects yourself.
