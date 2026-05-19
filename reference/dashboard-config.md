# Dashboard config

Each dashboard is a JSON object stored at
`pipelines/<slug>/dashboards/<name>.json`. The shape:

```ts
interface DashboardConfig {
  id: string;
  name: string;
  analytic_table_id: string;     // which table this dashboard reads from
  filters: DashboardFilter[];
  panels: Panel[];
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
  limit?: number,    // top-N
  grid?: PanelGrid,
}
```

Renders as horizontal bars sorted descending. Setting `limit: 5` shows
the top 5 only.

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

## Cross-filtering

Doughnut, bar, and choropleth panels are click-to-filter: clicking a slice
or bar dims the others and filters every panel except the source itself.
Click again to clear; or click the chip in the filter bar.

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
    { "kind": "line", "title": "Monthly Trend", "x": "date",
      "x_bin": "month", "y": "amount", "agg": "sum",
      "grid": { "gridColumn": "span 2" } },
    { "kind": "bar", "title": "Top Merchants", "group_by": "description",
      "value": "amount", "agg": "sum", "limit": 5,
      "grid": { "gridColumn": "1 / -1" } },
    { "kind": "table", "title": "Transactions",
      "columns": ["date", "description", "amount", "account", "category"],
      "page_size": 8, "grid": { "gridColumn": "1 / -1" } }
  ],
  "layout": {
    "gridTemplateColumns": "repeat(auto-fit, minmax(max(18rem, calc((100% - 2rem) / 3)), 1fr))",
    "gap": "1rem"
  }
}
```
