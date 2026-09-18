---
layout: home

hero:
  name: Karet
  text: Self-hosted ETL and dashboards
  tagline: Ingest CSV and JSON logs, build pipelines in a visual graph, and chart the results with DuckDB.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/karet-org/karet

features:
  - title: Four small services
    details: A Next.js web UI, a Rust/Axum worker, an S3-compatible object store, and a Valkey job queue. No database server, every byte of durable state lives in the buckets.
  - title: SQL-driven dashboards
    details: Every panel is a DuckDB query in a YAML config, edited in-app with autocomplete and inline validation. Click a chart to filter the rest.
  - title: CSV and JSON logs
    details: Point a source at a bucket prefix. NDJSON reads log shippers' native output, with dotted paths, record filters and epoch timestamps.
  - title: Enrich and filter at ingest
    details: Dimensions join small reference tables onto rows, exact or by keyword; row filters drop what you don't want stored.
  - title: Auto-runs on upload
    details: Drop a file into the bucket and a webhook kicks off a debounced pipeline run.
  - title: Accounts and roles
    details: Named accounts with viewer, editor and admin. A password or role change signs that person out, nobody else.
  - title: Versioned, atomically
    details: Every run publishes by flipping a pointer, so a query never sees a half-written table. Query a table as of an earlier version, or roll it back.
  - title: Attributed config changes
    details: Every save records who made it and what changed, with a diff that ignores layout noise and a one-click restore.
---
