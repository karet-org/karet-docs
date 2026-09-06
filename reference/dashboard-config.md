# Dashboard config (v2)

Dashboards are YAML documents stored in the pipelines bucket at
`pipelines/<slug>/dashboards/<id>.yaml`. Each panel runs its own DuckDB
SQL query against the warehouse; the config binds result columns to the
visualization's channels. The SQL does the shaping, the config only does
the binding.

Edit dashboards in the app (each dashboard's **Edit** view): drafts save
without validation, and publishing runs the full gate described below.
Direct S3 edits are not the supported path.

## Document shape

```yaml
version: 2
id: spending-overview        # must match the filename stem
name: Spending overview

filters:                     # optional; [] when omitted
  - name: account            # exposes $account to every query
    kind: dropdown
    label: Account
    options_sql: SELECT DISTINCT account FROM transactions ORDER BY 1
  - name: period             # exposes $period_from and $period_to
    kind: date_range
    label: Date range

panels:
  - kind: bar
    title: Monthly spend
    query: |
      SELECT strftime(date, '%Y-%m') AS month, sum(amount) AS total
      FROM transactions
      WHERE account = coalesce($account, account)
      GROUP BY 1 ORDER BY 1
    x: month
    y: total
    grid: { span: 2 }

layout:
  columns: 3                 # grid columns (default 3)
  gap: 1rem
```

## Queries

Every `query` (and `options_sql`) must be a single read-only `SELECT`.
Warehouse tables are addressed by their slugified display name (the
identifier shown on the Data page). A panel may instead reference a
saved query verbatim with `query_id: <stem>`; exactly one of `query` /
`query_id` is required.

### Filter parameters

Filters become named SQL parameters bound through prepared statements:

| filter kind  | parameters                | type            |
| ------------ | ------------------------- | --------------- |
| `dropdown`   | `$name`                   | string or NULL  |
| `date_range` | `$name_from`, `$name_to`  | date or NULL    |

An unselected filter binds NULL. The idiomatic optional filter is:

```sql
WHERE account = coalesce($account, account)
  AND date BETWEEN coalesce($period_from, DATE '0001-01-01')
              AND coalesce($period_to,   DATE '9999-12-31')
```

Referencing a `$param` no filter declares fails validation. `dropdown`
filters require `options_sql`, which must return exactly one column.

## Panel kinds and bindings

| kind             | required bindings              | optional                                  |
| ---------------- | ------------------------------ | ----------------------------------------- |
| `kpi`            | `value`                        | `format` (`number`/`currency`/`raw`), `currency`, `icon` (`dollar`/`chart`/`shapes`/`calendar`) |
| `bar`            | `x`, `y`                       | `series`, `horizontal`                    |
| `line`           | `x`, `y`                       | `series`                                  |
| `doughnut`       | `label`, `value`               |                                           |
| `table`          | (none: renders all columns)    | `columns`, `page_size`                    |
| `sankey`         | `source`, `target`, `value`    |                                           |
| `choropleth_map` | `region`, `value`              |                                           |
| `symbol_map`     | `lat`, `lon`, `value`          | `label`, `max_radius`                     |
| `summary`        | (none: row/column counts)      |                                           |

Every panel takes `title`, `query`/`query_id`, and optional
`grid: { span, aspect, maxHeight }` where `span` is a column count or
`full`, and `aspect` is `auto` (default), `square`, or `video`.

### KPI

One row, one bound column. Aggregation happens in SQL, including
"top by" shapes:

```yaml
- kind: kpi
  title: Top category
  query: |
    SELECT category || ' (' || round(sum(amount))::VARCHAR || ')' AS top
    FROM transactions GROUP BY 1 ORDER BY sum(amount) DESC LIMIT 1
  value: top
  format: raw
```

### Series bar / line

`series` names a column whose distinct values pivot into one dataset
each; queries stay long-format:

```yaml
- kind: line
  title: Spend by account
  query: |
    SELECT strftime(date, '%Y-%m') AS month, account, sum(amount) AS total
    FROM transactions GROUP BY 1, 2 ORDER BY 1
  x: month
  y: total
  series: account
```

### Sankey

One row per weighted edge. Multi-stage flows are unions whose stages
share node names; self-links and cycle-closing links are skipped:

```yaml
- kind: sankey
  title: Cash flow
  query: |
    SELECT account AS src, 'Budget' AS dst, sum(abs(amount)) AS total
    FROM transactions WHERE category = 'INCOME' GROUP BY 1
    UNION ALL
    SELECT 'Budget' AS src, category AS dst, sum(abs(amount)) AS total
    FROM transactions WHERE category != 'INCOME' GROUP BY 2
  source: src
  target: dst
  value: total
```

### Gap filling

`GROUP BY` skips empty buckets. To keep a month with no rows visible,
generate the spine and join onto it:

```sql
WITH bounds AS (
  SELECT date_trunc('month', min(date)) AS lo,
         date_trunc('month', max(date)) AS hi FROM transactions
),
months AS (
  SELECT unnest(generate_series(lo, hi, INTERVAL 1 MONTH)) AS m FROM bounds
)
SELECT strftime(m.m, '%Y-%m') AS month, coalesce(sum(t.amount), 0) AS total
FROM months m LEFT JOIN transactions t ON date_trunc('month', t.date) = m.m
GROUP BY 1 ORDER BY 1
```

## Lifecycle and validation

New dashboards start as drafts (`dashboards/drafts/<id>.yaml`), invisible
to navigation until published. Publishing validates:

- the YAML parses and matches this schema
- panel kinds are known and required bindings are present
- every query is a single read-only SELECT that plans against the
  warehouse (checked with `DESCRIBE`, no data read)
- every binding names a column its query returns
- every `$param` is declared by a filter; every `query_id` resolves

Invalid configs cannot be published. Published saves re-validate.

## Execution

The dashboard page fetches all panel results in one batched request;
panel queries run in parallel (bounded) and one panel's failure renders
an error card without affecting the rest. Results are capped at 10,000
rows per panel and 500 dropdown options. Filter changes re-run the batch,
debounced.
