---
layout: home

hero:
  name: Karet
  text: Self-hostable analytics platform
  tagline: Ingest CSVs, build data pipelines, and visualize everything in configurable dashboards.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/joeyshi12/karet

features:
  - title: Three small services
    details: A Next.js web UI, a Rust/Axum worker, and an S3-compatible object store. No database to operate.
  - title: JSON-driven dashboards
    details: Panels, layouts, aggregations, and chart aspect ratios all live in S3. Edit the config, the page updates.
  - title: Auto-runs on upload
    details: Drop a CSV into the bucket and a webhook kicks off a debounced pipeline run. No cron, no manual trigger.
  - title: Single-admin auth
    details: Password-only login, scrypt-hashed at OWASP cost. No user table to manage.
---
