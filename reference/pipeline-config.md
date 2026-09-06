# Pipeline config

A pipeline's behavior (what it ingests, how rows are transformed, what
it writes out) is fully described by `pipelines/<slug>/pipeline.json`.

```ts
interface PipelineConfig {
  version: 1;
  source_containers: SourceContainer[];
  lookup_mappings: LookupMapping[];
  mappings: Mapping[];
  analytic_tables: AnalyticTable[];
}
```

## Source containers

A bag of raw files sharing a schema, all under one S3 prefix in the lake.

```ts
interface SourceContainer {
  id: string;             // e.g. "transactions_raw"
  name: string;           // human-readable
  path_prefix: string;    // absolute lake key prefix, e.g. "banks/rbc/chequing/"
  schema: ColumnSchema[]; // the columns you'll see in the raw data
}

interface ColumnSchema {
  name: string;
  type: "string" | "number" | "int64" | "float64" | "bool" | "date";
}
```

Sources are CSV (header row, comma-delimited). `path_prefix` is an
absolute key prefix in the lake bucket, so a source can read any folder
in the data lake, including folders shared with other pipelines. The
worker lists every `.csv` file under it and streams them through the
configured mappings. An upload triggers a run of every pipeline with a
matching source prefix. Within one pipeline, no source's prefix may be
nested under another's.

Pipelines provisioned from a template read from their own folder
(`pipelines/<slug>/transactions/` for the spending template); that is a
convention, not a requirement.

## Lookup mappings

Reusable lookup tables that turn one input value into another. Useful
for category tagging, merchant normalization, or code-to-name expansion.

```ts
interface LookupMapping {
  id: string;
  name: string;
  match: "exact" | "keyword_substring";
  case_insensitive: boolean;
  rows: { input_patterns: string[]; output: string }[];
  children: LookupMapping[];        // hierarchical lookups; usually empty
  catch_all?: { output: string };   // optional: returned when no row matches
}
```

Reference one from a mapping expression with `{ kind: "lookup_ref",
lookup_id, input }`. Without `catch_all`, an unmatched input returns
`null`. Pair the lookup with `coalesce` to fall back to the raw input
(see "Merchant normalization" below).

## Mappings

A mapping describes how rows from a source container become rows in an
analytic table.

```ts
interface Mapping {
  id: string;
  name: string;
  source_container_id: string;
  analytic_table_id: string;
  columns: { name: string; expr: AstNode }[];
}
```

Each output column has an `expr`, a JSON AST evaluated row-by-row. The
common nodes:

| Kind | Shape | Effect |
|------|-------|--------|
| `col` | `{ kind: "col", name }` | Read a source column. |
| `num` | `{ kind: "num", value }` | Numeric literal. |
| `str` | `{ kind: "str", value }` | String literal. |
| `parse_date` | `{ kind: "parse_date", input, format }` | Parse a string with a strftime-style format. |
| `year` / `month` / `day` | `{ kind: "year", input }` | Date part of a date input, as int64 (month 1 to 12, day 1 to 31). |
| `cast` | `{ kind: "cast", input, to }` | Cast to `int64`, `float64`, `string`. |
| `upper` / `lower` / `trim` | `{ kind: "upper", input }` | Case folding / whitespace strip. |
| `mul` / `add` / `sub` / `div` | `{ kind: "mul", left, right }` | Numeric ops. |
| `lookup_ref` | `{ kind: "lookup_ref", lookup_id, input }` | Apply a lookup mapping (returns `null` on miss when there's no `catch_all`). |
| `coalesce` | `{ kind: "coalesce", args: AstNode[] }` | First non-null arg; `null` if every arg is null. |

See `src/karet-worker/src/evaluator.rs` for the full set.

### Merchant normalization

CSV descriptions for one merchant often appear under several variants
(`MARUHACHI RA MEN LIBRA`, `MARUHACHI RA MEN LIBRARY`). To collapse
them into one canonical name without losing anything for unmatched
rows:

```jsonc
{ "name": "merchant",
  "expr": { "kind": "coalesce",
    "args": [
      { "kind": "lookup_ref", "lookup_id": "merchants",
        "input": { "kind": "upper",
                   "input": { "kind": "trim",
                              "input": { "kind": "col", "name": "description" } } } },
      { "kind": "upper",
        "input": { "kind": "trim",
                   "input": { "kind": "col", "name": "description" } } }
    ] } }
```

When the `merchants` lookup matches, the column gets the canonical
name. Otherwise it falls back to the cleaned description. The Spending
Tracker template (`src/karet/lib/templates/index.ts`) uses this shape.

## Analytic tables

Where the worker writes Parquet output.

```ts
interface AnalyticTable {
  id: string;
  name: string;
  output_prefix: string;     // e.g. "transactions/"
  schema: ColumnSchema[];    // the columns the dashboard / table view will see
  partition_keys?: string[]; // hive path segments, in order; max 2, no floats
  dedup_keys?: string[];     // row identity; duplicate tuples collapse to one
}
```

### Partitioning

`partition_keys` names schema columns, and the worker writes one
Hive-style path segment per key, in order:
`transactions/year=2026/month=9/<mapping_id>.parquet`. Key columns are
not written into the Parquet payload; DuckDB re-materializes them from
the path on read. Any non-float column type is a legal key: partition
by account or category the same way as by date parts. A null in a key
column fails the mapping (wrap the expression in `coalesce` to supply a
default).

Monthly partitioning is two ordinary columns computed by the mapping:
`year: year(parse_date(date, "%Y-%m-%d"))` and `month: month(...)`,
listed as `partition_keys: ["year", "month"]`.

### Deduplication

`dedup_keys` declares which columns identify a row. After the mapping
evaluates (and assertions pass), rows sharing a key tuple collapse to
one; the first in ingest order survives, and the dropped count is
reported on the job record as `rows_deduped`. Overlapping CSV
re-exports collapse naturally because every run re-reads the whole
source prefix. Two different mappings writing one table are not
deduplicated against each other.

## Worked example

The Spending Tracker template ships with this shape:

```json
{
  "version": 1,
  "source_containers": [{
    "id": "transactions_raw",
    "name": "Transactions",
    "path_prefix": "pipelines/spending/transactions/",
    "schema": [
      { "name": "date", "type": "string" },
      { "name": "description", "type": "string" },
      { "name": "amount", "type": "number" },
      { "name": "account", "type": "string" }
    ]
  }],
  "lookup_mappings": [{
    "id": "categories",
    "name": "Categories",
    "match": "keyword_substring",
    "case_insensitive": true,
    "rows": [
      { "input_patterns": ["STARBUCKS", "CAFE"], "output": "FOOD" },
      { "input_patterns": ["UBER", "LYFT"], "output": "TRANSPORT" }
    ],
    "children": []
  }],
  "mappings": [{
    "id": "transactions_mapping",
    "name": "Transactions Mapping",
    "source_container_id": "transactions_raw",
    "analytic_table_id": "transactions",
    "columns": [
      { "name": "date",
        "expr": { "kind": "parse_date",
                  "input": { "kind": "col", "name": "date" },
                  "format": "%Y-%m-%d" } },
      { "name": "description",
        "expr": { "kind": "upper",
                  "input": { "kind": "col", "name": "description" } } },
      { "name": "amount",
        "expr": { "kind": "cast",
                  "input": { "kind": "col", "name": "amount" },
                  "to": "float64" } },
      { "name": "account",
        "expr": { "kind": "col", "name": "account" } },
      { "name": "category",
        "expr": { "kind": "lookup_ref",
                  "lookup_id": "categories",
                  "input": { "kind": "upper",
                             "input": { "kind": "col", "name": "description" } } } },
      { "name": "year",
        "expr": { "kind": "year",
                  "input": { "kind": "parse_date",
                             "input": { "kind": "col", "name": "date" },
                             "format": "%Y-%m-%d" } } },
      { "name": "month",
        "expr": { "kind": "month",
                  "input": { "kind": "parse_date",
                             "input": { "kind": "col", "name": "date" },
                             "format": "%Y-%m-%d" } } }
    ]
  }],
  "analytic_tables": [{
    "id": "transactions",
    "name": "Transactions",
    "output_prefix": "transactions/",
    "schema": [
      { "name": "date", "type": "date" },
      { "name": "description", "type": "string" },
      { "name": "amount", "type": "float64" },
      { "name": "account", "type": "string" },
      { "name": "category", "type": "string" },
      { "name": "year", "type": "int64" },
      { "name": "month", "type": "int64" }
    ],
    "partition_keys": ["year", "month"]
  }]
}
```
