# Getting started

Run the full Karet stack on your machine.

::: tip Just want to self-host?
This guide builds from source so you can poke at the code. If you
just want a running instance, the [self-hosting guide](./self-hosting)
uses prebuilt images from GHCR and skips the source checkout.
:::

## Prerequisites

- [Docker](https://www.docker.com/) with the Compose plugin (`docker compose`).
- About 1 GB of disk for the bundled S3 emulator and clean Parquet output.

## 1. Clone and configure

```sh
git clone https://github.com/karet-org/karet
cd karet

# Generate a secret used to sign session cookies.
echo "KARET_SESSION_SECRET=$(openssl rand -base64 48)" > .env
```

The compose file refuses to start without `KARET_SESSION_SECRET`: a
default value would let anyone forge a session.

## 2. Start the stack

```sh
docker compose up -d
```

Three services come up:

| Service | Port | Purpose |
|---------|------|---------|
| `web` | `:3000` | Karet's Next.js UI |
| `worker` | `:8080` | The Rust/Axum pipeline worker |
| `rustfs` | `:9000` (`:9001` console) | S3-compatible object store |

## 3. Set the admin password

Open <http://localhost:3000>. The first visit shows a "Set admin password"
form. Pick a password (≥ 8 characters) and click **Set password**.

You're now signed in. Subsequent visits will show a normal sign-in form.

## 4. Create your first pipeline

From the home page, click **+ New pipeline** and pick the **Spending Tracker**
template. This provisions:

- A source container at `pipelines/<slug>/transactions/` that expects
  `date, description, amount, account` CSVs.
- A keyword-lookup mapping that tags each row with a category.
- An analytic table written to `pipelines/<slug>/transactions/` as
  partitioned Parquet.
- A dashboard with KPI tiles, a category doughnut, a monthly-trend line,
  a top-merchants bar, and a transactions table.

## 5. Drop in some data

Upload one or more CSVs to the source prefix:

```sh
aws --endpoint-url=http://localhost:9000 \
  s3 cp my-jan.csv s3://karet-lake/pipelines/<slug>/transactions/
```

If you've enabled the [auto-run webhook](./webhooks), the upload triggers
a pipeline run automatically (with a 5-second debounce so a batch upload
becomes one job). Otherwise click **Run Pipeline** on the **Jobs** page.

## 6. View the dashboard

Navigate to **Dashboards → Spending Overview**. KPIs, charts, and the
transactions table all populate from the Parquet output.

## What's next?

- [Architecture](./architecture): the three services and how they connect.
- [Pipeline config](/reference/pipeline-config): the JSON shape that drives ingest.
- [Dashboard config](/reference/dashboard-config): panel kinds, layout, cross-filters.
- [Auto-runs](./webhooks): wire RustFS uploads to pipeline runs.
