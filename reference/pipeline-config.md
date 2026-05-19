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

A bag of CSVs sharing a schema, all under one S3 prefix.

```ts
interface SourceContainer {
  id: string;             // e.g. "transactions_raw"
  name: string;           // human-readable
  path_prefix: string;    // e.g. "raw/transactions/"
  schema: ColumnSchema[]; // the columns you'll see in the raw CSVs
}

interface ColumnSchema {
  name: string;
  type: "string" | "number" | "int64" | "float64" | "bool" | "date";
}
```

The worker lists every `*.csv` under `pipelines/<slug>/<path_prefix>` and
streams them through the configured mappings.

## Lookup mappings

Reusable lookup tables that turn one input value into another. Useful
for category tagging or code-to-name expansion.

```ts
interface LookupMapping {
  id: string;
  name: string;
  match: "exact" | "keyword_substring";
  case_insensitive: boolean;
  rows: { input_patterns: string[]; output: string }[];
  children: LookupMapping[]; // hierarchical lookups; usually empty
}
```

Reference one from a mapping expression with `{ kind: "lookup_ref",
lookup_id, input }`.

## Mappings

A mapping describes how rows from a source container become rows in an
analytic table.

```ts
interface Mapping {
  id: string;
  name: string;
  source_container_id: string;
  analytic_table_id: string;
  partition_by?: { column: string; granularity: "day" | "month" | "year" };
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
| `cast` | `{ kind: "cast", input, to }` | Cast to `int64`, `float64`, `string`. |
| `upper` / `lower` | `{ kind: "upper", input }` | Case folding. |
| `mul` / `add` / `sub` / `div` | `{ kind: "mul", left, right }` | Numeric ops. |
| `lookup_ref` | `{ kind: "lookup_ref", lookup_id, input }` | Apply a lookup mapping. |

See `src/karet-worker/src/evaluator.rs` for the full set.

## Analytic tables

Where the worker writes Parquet output.

```ts
interface AnalyticTable {
  id: string;
  name: string;
  output_prefix: string;     // e.g. "clean/transactions/"
  schema: ColumnSchema[];    // the columns the dashboard / table view will see
}
```

If the matching `mapping.partition_by` is set, the worker writes Hive-style
partitioned Parquet (`year=2025/month=03/data.parquet`).

## Worked example

The Spending Tracker template ships with this shape:

```json
{
  "version": 1,
  "source_containers": [{
    "id": "transactions_raw",
    "name": "Transactions",
    "path_prefix": "raw/transactions/",
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
    "partition_by": { "column": "date", "granularity": "month" },
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
                             "input": { "kind": "col", "name": "description" } } } }
    ]
  }],
  "analytic_tables": [{
    "id": "transactions",
    "name": "Transactions",
    "output_prefix": "clean/transactions/",
    "schema": [
      { "name": "date", "type": "date" },
      { "name": "description", "type": "string" },
      { "name": "amount", "type": "float64" },
      { "name": "account", "type": "string" },
      { "name": "category", "type": "string" }
    ]
  }]
}
```
