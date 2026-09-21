---
layout: home

hero:
  name: Karet
  text: The self-hosted analytics stack
  tagline: ETL pipelines you draw as a graph and dashboards you describe in YAML, on hardware you own, up in one Docker Compose file.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/karet-org/karet

features:
  - title: Pipeline visualization
    details: >-
      The graph is the editor. Sources, dimensions, mappings and tables are nodes;
      drag between them to say what feeds what, and the layout is saved with the
      pipeline so it looks the same to everyone.
  - title: Config-driven dashboards
    details: >-
      A dashboard is a YAML document and every panel is a DuckDB query, edited
      in-app with autocomplete and inline validation. Click a chart to filter the
      rest.
  - title: Pipeline versioning
    details: >-
      Every save is a numbered version with an author and a diff against what is
      live, and a restore writes forward rather than rewinding. Runs are pinned to
      the version that produced them, and a table can be read as of an earlier
      version or rolled back to one.
  - title: Docker Compose and go
    details: >-
      One compose file brings up the web app, the worker, Postgres, Valkey and an
      S3-compatible store, from prebuilt images. Generate two secrets and an admin
      password hash, create three buckets, and that is the install.
---
