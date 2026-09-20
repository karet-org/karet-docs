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
  - title: Pipelines you can see
    details: >-
      Point a source at a bucket prefix and build the path from file to table in a
      graph. CSV or NDJSON in, dimensions to enrich rows, filters to drop what you
      will not store, and an upload can trigger the run.
  - title: Dashboards are SQL
    details: >-
      Every panel is a DuckDB query in a YAML config, edited in-app with
      autocomplete and inline validation. Click a chart to filter the rest.
  - title: Nothing overwrites anything
    details: >-
      A run publishes by flipping one pointer, so a query never sees a half-written
      table. Read a table as of an earlier version or roll it back, and every config
      save records who changed what.
  - title: Yours, and shared on purpose
    details: >-
      Runs on your machines with your data in your buckets. New pipelines are
      invite-only, and an admin manages accounts and per-pipeline access in the app.
---
