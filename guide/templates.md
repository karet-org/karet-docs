# Templates

When you click **+ New pipeline**, you choose a template. A template is a
bundle of files that get copied under `pipelines/<slug>/` in S3.

## Built-in templates

### Blank

An empty config with no source containers, mappings, analytic tables,
or dashboards. Useful when you want to assemble everything yourself in
the graph editor.

### Traffic Analytics

A worked example of the log-ingest path, using two request logs that
arrive in different formats and land in one table:

- **Source container** `caddy_access_raw` reads `format: "ndjson"` files,
  selects access-log entries with a `record_filter`, and pulls nested
  fields out with dotted paths (`request.headers.User-Agent[0]`).
- **Source container** `edge_access_raw` reads the same kind of traffic
  as CSV, to show two shapes unioning into one table.
- **Dimensions**, one of each shape: `services` maps a hostname to two
  value columns (`service` and `team`) with `on_miss: "passthrough"`,
  `crawlers` flags bots by user-agent substring, and `countries` is
  file-backed, reading a CSV from the lake and exposing `country_name`
  and `region` with `on_miss: { literal: "Unknown" }`.
- **Mapping** `caddy_mapping` turns the epoch timestamp into a date with
  `from_unix`, enriches rows via `dim_ref`, and uses `where` to drop bot
  traffic before it is stored. `edge_mapping` writes the same table from
  the CSV source.
- **Analytic table** `requests` is partitioned and deduped.
- **Dashboard** `Traffic Overview` has three KPI tiles, a requests-per-day
  line, two bars and a table.

### Spending Tracker

A worked example covering the full feature set:

- **Source container** `transactions_raw` reads CSVs from
  `pipelines/<slug>/transactions/` with columns `date, description,
  amount, account`.
- **Dimensions**:
  - `categories` tags each row by keyword-substring match against the
    description (e.g. `STARBUCKS → FOOD`, `UBER → TRANSPORT`,
    `PAYROLL → INCOME`), with `on_miss: { literal: "OTHER" }`.
  - `merchants` maps merchant variants to canonical names
    (e.g. `STARBUCKS → Starbucks`).
- **Mapping** `transactions_mapping` parses the date, normalizes the
  description, casts `amount` to `float64`, populates `category` via
  `dim_ref`, and populates `merchant` via
  `coalesce(dim_ref(merchants, ...), cleaned_description)`. Rows the
  merchants dimension misses keep their cleaned description.
- **Analytic table** `transactions` writes month-partitioned Parquet to
  `pipelines/<slug>/transactions/year=YYYY/month=MM/data.parquet`.
- **Dashboard** `Spending Overview` ships with three KPI tiles
  (Total Spending in CAD, Transactions count, Top Category), a category
  doughnut, a vertical Monthly Spending bar (`x_bin: "month"`), a
  horizontal Top 10 Merchants bar grouped by `merchant`, and a paginated
  transactions table. The dashboards' SQL excludes
  `TRANSFER`, `INVESTMENT`, and `INCOME` rows.
- **Dashboard** `Cash Flow` shows a Sankey of `description → account →
  category` (income sources flow into accounts, accounts flow out to
  spending categories) plus an Income & Transfers table. Clicking a
  node cross-filters every panel by that node's column.

## Adding your own template

Templates live in `src/karet/lib/templates/`, registered in `index.ts`
(larger ones, like Traffic Analytics, get their own module). To add one:

1. Define a `PipelineConfig` value with your source containers, mappings,
   and analytic tables.
2. Optionally define a `DashboardConfig` to ship alongside.
3. Add an entry to the `TEMPLATES` map keyed by your `TemplateId`.

```ts
// lib/templates/index.ts
export type TemplateId = "blank" | "spending" | "your_id";

export const TEMPLATES: Record<TemplateId, Template> = {
  // …
  your_id: {
    id: "your_id",
    name: "Your template",
    description: "What this provisions.",
    files: {
      "pipeline.json": yourPipeline,
      "dashboards/your_dashboard.yaml": yourDashboardYaml,
    },
    rawFiles: {
      // optional plain-text seed data, e.g. a sample CSV.
      "your_table/sample.csv": "col1,col2\n…",
    },
  },
};
```

The home-page **+ New pipeline** modal picks templates up automatically
from this map.
