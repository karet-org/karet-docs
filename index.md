---
layout: home

hero:
  name: Karet
  text: Self-hostable analytics platform
  tagline: Ingest CSVs, build pipelines, and chart the results in configurable dashboards.
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
  - title: Auto-runs on upload
    details: Drop a CSV into the bucket and a webhook kicks off a debounced pipeline run.
  - title: Single-admin auth
    details: Password-only login, scrypt-hashed at OWASP cost. No user table to manage.
---
