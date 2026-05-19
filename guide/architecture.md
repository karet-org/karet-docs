# Architecture

Karet is three services orchestrated by Docker Compose.

| Service | Stack | Role |
|---------|-------|------|
| **rustfs** | [RustFS](https://rustfs.com) | S3-compatible object store. Holds raw CSVs, pipeline configs, dashboards, and Parquet output. |
| **karet-worker** | Rust / Axum / Polars | Reads a pipeline config from S3, ingests CSVs, applies AST-JSON mapping expressions, writes partitioned Parquet. |
| **karet** | Next.js / React Flow / Chart.js | Renders the UI: pipeline list, graph editor, jobs, tables, dashboards. Also owns auth. |

```
                          ┌─────────────────┐
                          │  karet          │
                          │   (Next.js)     │ :3000
                          └─┬─────────┬─────┘
                            │         │
                  HTTP POST │         │ S3 read/write
                            ▼         ▼
                   ┌─────────────┐  ┌────────────┐
                   │ karet-worker│  │  rustfs    │ :9000
                   │ (Rust/Axum) │◀─│  (S3 API)  │
                   └─────────────┘  └────────────┘
                          ▲                │
                          │  S3 events     │
                          └────────────────┘
                          (object-put webhook)
```

## Why the split

- **All persistent state lives in S3.** No database to back up. Pipeline
  configs, dashboards, raw CSVs, Parquet output, job records, and the
  admin password hash are all S3 objects.
- **The web service holds the session cookie machinery and the UI.** It
  also hosts the webhook receiver for RustFS object events.
- **The worker is stateless.** It accepts a `pipeline_prefix`, reads the
  config and raw CSVs from S3, runs Polars, writes Parquet, returns a
  result.

## What lives where in S3

For a pipeline at slug `<slug>`:

```
pipelines/<slug>/
├── pipeline.json              # source containers + mappings + analytic tables
├── raw/                       # raw inputs you upload
│   └── transactions/*.csv
├── clean/                     # worker output (partitioned Parquet)
│   └── transactions/year=YYYY/month=MM/data.parquet
├── dashboards/
│   └── *.json                 # one per dashboard
├── jobs/
│   └── job-<ts>-<rand>.json   # pipeline-run history
└── preview.png                # thumbnail used on the home page

_auth/
└── admin.json                 # scrypt-hashed admin password
```

## Trust boundaries

- The web service binds publicly (port 3000 on the host).
- The worker is reachable only over the compose network.
- RustFS is exposed for local dev convenience but doesn't need to be.
  The web and worker services reach it over the compose network.
- The webhook from RustFS to web carries a shared secret
  (`KARET_WEBHOOK_SECRET`), so the receiver still rejects unauthorized
  traffic if you do expose port 3000 to the internet.

See [Authentication](./authentication) for details on the admin password
flow and session cookies.
