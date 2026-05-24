# Templates

When you click **+ New pipeline**, you choose a template. A template is a
bundle of files that get copied under `pipelines/<slug>/` in S3.

## Built-in templates

### Blank

An empty config with no source containers, mappings, analytic tables,
or dashboards. Useful when you want to assemble everything yourself in
the graph editor.

### Spending Tracker

A worked example covering the full feature set:

- **Source container** `transactions_raw` reads CSVs from
  `pipelines/<slug>/raw/transactions/` with columns `date, description,
  amount, account`.
- **Lookup mappings**:
  - `categories` tags each row by keyword-substring match against the
    description (e.g. `STARBUCKS → FOOD`, `UBER → TRANSPORT`,
    `PAYROLL → INCOME`), with a `catch_all` of `OTHER`.
  - `merchants` maps merchant variants to canonical names
    (e.g. `STARBUCKS → Starbucks`).
- **Mapping** `transactions_mapping` parses the date, normalizes the
  description, casts `amount` to `float64`, populates `category` via
  `lookup_ref`, and populates `merchant` via
  `coalesce(lookup_ref(merchants, ...), cleaned_description)`. Rows
  the merchants lookup misses keep their cleaned description.
- **Analytic table** `transactions` writes month-partitioned Parquet to
  `pipelines/<slug>/clean/transactions/year=YYYY/month=MM/data.parquet`.
- **Dashboard** `Spending Overview` ships with three KPI tiles
  (Total Spending in CAD, Transactions count, Top Category), a category
  doughnut, a vertical Monthly Spending bar (`x_bin: "month"`), a
  horizontal Top 10 Merchants bar grouped by `merchant`, and a paginated
  transactions table. The dashboard's `where` clause excludes
  `TRANSFER`, `INVESTMENT`, and `INCOME` rows.
- **Dashboard** `Cash Flow` shows a Sankey of `description → account →
  category` (income sources flow into accounts, accounts flow out to
  spending categories) plus an Income & Transfers table. Clicking a
  node cross-filters every panel by that node's column.

## Adding your own template

Templates live in `src/karet/lib/templates/index.ts`. To add one:

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
      "dashboards/your_dashboard.json": yourDashboard,
    },
    rawFiles: {
      // optional plain-text seed data, e.g. a sample CSV.
      "raw/your_table/sample.csv": "col1,col2\n…",
    },
  },
};
```

The home-page **+ New pipeline** modal picks templates up automatically
from this map.
