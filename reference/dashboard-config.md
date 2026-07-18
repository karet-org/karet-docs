# Dashboard config

Each dashboard is a JSON object stored at
`pipelines/<slug>/dashboards/<name>.json`. The shape:

```ts
interface DashboardConfig {
  id: string;
  name: string;
  analytic_table_id: string;     // which table this dashboard reads from
  query_id?: string;             // read from a saved query instead (see below)
  filters: DashboardFilter[];
  panels: Panel[];
  where?: AstNode[];             // optional baseline row filter (see below)
  layout?: {
    columns?: number;            // legacy fallback; ignored when gridTemplateColumns is set
    gridTemplateColumns?: string;
    gridTemplateRows?: string;
    gap?: string;                // e.g. "1rem"
  };
}
```

The page renders one CSS grid containing every panel. `gridTemplateColumns`
goes through to CSS as-is, so any valid `grid-template-columns` value
works:

- `"repeat(3, minmax(0, 1fr))"`: fixed 3 columns at every width.
- `"repeat(auto-fit, minmax(18rem, 1fr))"`: responsive, no max.
- `"repeat(auto-fit, minmax(max(18rem, calc((100% - 2rem) / 3)), 1fr))"`:
  responsive with a 3-column cap.

## Data source: table or saved query

By default a dashboard reads the Parquet of the analytic table named by
`analytic_table_id`. Set `query_id` to instead back the dashboard with a
[saved query](./web-api#saved-queries): the query runs against the warehouse
and its result rows and columns become the dashboard's data and schema.

```jsonc
{
  "id": "spend-by-merchant",
  "name": "Spend by merchant",
  "analytic_table_id": "transactions", // still required; used as a fallback label
  "query_id": "monthly_spend",         // stem of pipelines/<slug>/queries/monthly_spend.json
  "filters": [],
  "panels": [ /* ... */ ]
}
```

Save a query from the **Data** page (write SQL, click **Save**, name it); the
name is slugified into the `query_id` you reference here. This lets a
dashboard read from a join or aggregate across tables without a dedicated
analytic table.

## Filters

```ts
type FilterKind = "dropdown" | "date_range";

interface DashboardFilter {
  kind: FilterKind;
  column: string;   // analytic-table column to filter on
  label: string;    // shown above the input
}
```

`dropdown` filters auto-populate options from the distinct values in the
column. `date_range` shows two `<input type="date">` controls.

## Where clause

`config.where` is an optional array of [AstNode](./pipeline-config.md)
predicates ANDed together. Rows that fail the predicate are excluded
from every panel and from the FilterBar's dropdown options. Use it to
hardcode "always exclude these rows" rules, e.g. dropping bank-internal
entries from a spending view:

```jsonc
"where": [
  { "kind": "ne", "left": { "kind": "col", "name": "category" },
                 "right": { "kind": "str", "value": "TRANSFER" } },
  { "kind": "ne", "left": { "kind": "col", "name": "category" },
                 "right": { "kind": "str", "value": "INVESTMENT" } }
]
```

Only boolean / value-producing AST nodes are supported: `col`, `str`,
`num`, `bool`, `null`, `eq`, `ne`, `gt`, `lt`, `ge`, `le`, `contains`,
`upper`, `lower`, `trim`, `coalesce`. Arithmetic, `if`, `parse_date`,
`lookup_ref`, and `cast` throw at render time; filtering rows in a
dashboard shouldn't need expressions that produce analytic columns.

Three-valued logic on null:

- `null == X` is `false` (matches SQL).
- `null != X` is **`true`**. This intentionally diverges from SQL: a
  `category != "X"` filter shouldn't blank out fresh parquet rows whose
  category hasn't been backfilled yet.

For interactive exclusion, use a `dropdown` filter instead. `where`
runs before user-driven filtering and dropdown population.

## Panels

Every panel shares two optional sub-fields:

```ts
interface PanelGrid {
  gridColumn?: string;     // CSS grid placement, e.g. "1 / -1" or "span 2"
  gridRow?: string;
  aspect?: "square" | "video" | "auto";  // chart-area shape
  maxHeight?: string;      // CSS max-height, e.g. "20rem"
}
```

`aspect` controls how the chart fills its panel:

| Value | Effect |
|-------|--------|
| `auto` (default) | Fill the row's height. Good for line/bar charts. |
| `square` | Inscribe a 1:1 box. Good for doughnuts and gauges. |
| `video` | 16:9. Good for maps. |

`maxHeight` caps the chart so a square doughnut on a 30rem-wide column
doesn't take 30rem of vertical space. Recommended pairing for doughnuts:
`{ aspect: "square", maxHeight: "20rem" }`.

### KPI

Single icon + ALL-CAPS label + one big aggregated value.

```ts
{
  kind: "kpi",
  title: "Total Spending",
  column: "amount",
  agg: "sum" | "count" | "avg" | "min" | "max" | "mode",
  format?: "number" | "currency" | "raw",
  currency?: "USD" | "CAD" | "EUR" | …,    // ISO 4217, default USD
  icon?: "dollar" | "chart" | "shapes" | "calendar",
  value_column?: string,   // for agg: "mode", reads "Top (Sum)" style
  grid?: PanelGrid,
}
```

`agg: "mode"` returns the most-frequent value of `column`. If
`value_column` is set, the tile reads e.g. `FOOD (CA$7,632.01)`.

### Doughnut

```ts
{
  kind: "doughnut",
  title: "By Category",
  group_by: "category",
  value: "amount",
  agg: "sum" | "count" | "avg" | "min" | "max",
  grid?: PanelGrid,
}
```

### Line

```ts
{
  kind: "line",
  title: "Monthly Trend",
  x: "date",
  x_bin?: "day" | "week" | "month" | "year",
  y: "amount",
  agg: "sum" | "count" | "avg" | "min" | "max",
  grid?: PanelGrid,
}
```

`x_bin` rolls the X-axis up to the chosen granularity before plotting.

### Bar

```ts
{
  kind: "bar",
  title: "Top Merchants",
  group_by: "description",
  value: "amount",
  agg: "sum" | "count" | "avg" | "min" | "max",
  x_bin?: "day" | "week" | "month" | "year",   // optional: time-series form
  limit?: number,                              // top-N (only meaningful without x_bin)
  grid?: PanelGrid,
}
```

Without `x_bin`: horizontal bars sorted by aggregated value descending,
optional `limit` for "Top N" charts.

With `x_bin`: groups by `binDate(group_by, x_bin)`, sorts labels
chronologically, ignores `limit`, renders as **vertical** bars. Use
this for monthly-spending histograms and similar time-series.

Both forms participate in cross-filter clicks.

### Table

```ts
{
  kind: "table",
  title: "Transactions",
  columns: ["date", "description", "amount"],
  page_size?: number,   // default 50
  grid?: PanelGrid,
}
```

### Summary

A row-count plus per-column aggregate (sum for numeric, distinct count
otherwise). Less commonly used now that KPI tiles exist.

```ts
{
  kind: "summary",
  title: "Summary",
  columns: ["amount", "category"],
  grid?: PanelGrid,
}
```

### Symbol map

Plots circles on a world map at lat/lon points.

```ts
{
  kind: "symbol_map",
  title: "Stops",
  lat: "latitude",
  lon: "longitude",
  value?: "count",       // omit for count-of-rows-per-point
  agg: Aggregation,
  max_radius?: number,   // SVG units; default 20
  grid?: PanelGrid,
}
```

### Choropleth map

Colors countries by an aggregated value.

```ts
{
  kind: "choropleth_map",
  title: "Sales by country",
  country: "country_code",
  value?: "revenue",
  agg: Aggregation,
  grid?: PanelGrid,
}
```

The country column accepts ISO-3166 alpha-2, alpha-3, numeric, or common
names. They're all resolved through a built-in lookup.

### Sankey

Multi-stage flow diagram (income → account → category and similar
shapes). Renders via `d3-sankey` + SVG.

```ts
{
  kind: "sankey",
  title: "Cash Flow",
  flows: SankeyFlow[],
  labels?: Record<string, string>,   // optional pretty-name overrides
  grid?: PanelGrid,
}

interface SankeyFlow {
  from: string,                                  // categorical column
  to: string,                                    // categorical column
  value: string,                                 // numeric column
  agg?: "sum" | "abs_sum" | "count",             // default "sum"
  where?: AstNode[],                             // optional per-flow filter
}
```

Each flow groups rows by `(from, to)`, aggregates the `value` column,
and emits one ribbon per non-zero pair. Stack flows to chain stages: a
flow whose `from` matches a previous flow's `to` extends the diagram
to the right.

`agg: "abs_sum"` is useful when income rows carry negative amounts and
you want the ribbon width to reflect magnitude regardless of sign.

`where` is the same boolean AST subset as the dashboard-level `where`
clause. Use it to scope a flow to one slice of the table without
filtering the whole dashboard. The dashboard-level `where` still runs
first.

`labels` maps raw values to display labels. Useful for collapsing CSV
variants like `PAYROLL DEPOSIT` into `Payroll` without rewriting the
underlying data.

Click a node to cross-filter the rest of the dashboard by that node's
source column. Hovering shows a styled tooltip. Ribbons are
hover-only; a `(from, to)` ribbon maps to two columns, not one, so
click semantics are ambiguous.

## Cross-filtering

Doughnut, bar, choropleth, and sankey panels are click-to-filter:
clicking a slice, bar, country, or sankey node dims the others and
filters every panel except the one clicked. Click again, or click the
chip in the filter bar, to clear. Bar panels with `x_bin` emit a
date-binned filter, so clicking the `2026-01` bar narrows other panels
to rows in January 2026. Line panels are read-only.

## Worked example

```json
{
  "id": "spending_overview",
  "name": "Spending Overview",
  "analytic_table_id": "transactions",
  "filters": [
    { "kind": "dropdown", "column": "account", "label": "Account" },
    { "kind": "date_range", "column": "date", "label": "Date range" }
  ],
  "where": [
    { "kind": "ne", "left": { "kind": "col", "name": "category" },
                   "right": { "kind": "str", "value": "TRANSFER" } },
    { "kind": "ne", "left": { "kind": "col", "name": "category" },
                   "right": { "kind": "str", "value": "INVESTMENT" } },
    { "kind": "ne", "left": { "kind": "col", "name": "category" },
                   "right": { "kind": "str", "value": "INCOME" } }
  ],
  "panels": [
    { "kind": "kpi", "title": "Total Spending", "column": "amount",
      "agg": "sum", "format": "currency", "currency": "CAD",
      "icon": "dollar" },
    { "kind": "kpi", "title": "Transactions", "column": "amount",
      "agg": "count", "format": "number", "icon": "chart" },
    { "kind": "kpi", "title": "Top Category", "column": "category",
      "agg": "mode", "value_column": "amount",
      "format": "currency", "currency": "CAD", "icon": "shapes" },
    { "kind": "doughnut", "title": "By Category",
      "group_by": "category", "value": "amount", "agg": "sum",
      "grid": { "aspect": "square", "maxHeight": "20rem" } },
    { "kind": "bar", "title": "Monthly Spending", "group_by": "date",
      "x_bin": "month", "value": "amount", "agg": "sum",
      "grid": { "gridColumn": "span 2" } },
    { "kind": "bar", "title": "Top 10 Merchants", "group_by": "merchant",
      "value": "amount", "agg": "sum", "limit": 10,
      "grid": { "gridColumn": "1 / -1" } },
    { "kind": "table", "title": "Transactions",
      "columns": ["date", "description", "merchant", "amount", "account", "category"],
      "page_size": 10, "grid": { "gridColumn": "1 / -1" } }
  ],
  "layout": {
    "gridTemplateColumns": "repeat(auto-fit, minmax(max(18rem, calc((100% - 2rem) / 3)), 1fr))",
    "gap": "1rem"
  }
}
```
