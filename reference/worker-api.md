# Worker HTTP API

The worker (`karet-worker`) is a Rust/Axum service that runs pipeline
jobs. It binds to `:8080` inside the compose network. The web service
calls it; you usually won't.

## Endpoints

### `GET /health`

Liveness check. Returns `200 OK` with no body.

### `POST /config/validate`

Type-check a candidate `pipeline.json` body without running anything.
Used by the graph editor's "Validate" button.

**Request body**: a `PipelineConfig` JSON (see
[Pipeline config](./pipeline-config)).

**Response**: `200 OK` with `{ ok: true }` on success, or `4xx` with a
detailed error shape:

```json
{
  "error": "duplicate_id",
  "message": "Two source containers share id 'transactions_raw'",
  "details": [...]
}
```

### `POST /jobs/run`

Execute a pipeline run.

**Request body**:

```json
{
  "pipeline_prefix": "pipelines/<slug>/",
  "clean_run": false
}
```

`clean_run: true` deletes existing `<table_id>/` output before
running, so removed CSVs don't leave stale partitions behind. The default
(`false`) is incremental: re-running with the same inputs is idempotent
and overwrites partitions in place.

**Response** (synchronous; the worker doesn't return until the job finishes):

```json
{
  "partitions_written": 12,
  "files_processed": 12,
  "errors": []
}
```

Errors that don't abort the run (e.g. one bad CSV) appear in `errors[]`
as plain strings. Errors that *do* abort the run come back as a 4xx with
the same error shape as `/config/validate`.

## Runtime / scaling notes

- The worker is **stateless**. Every run reads its inputs from S3 and
  writes outputs back to S3.
- It uses Polars: source files load into a DataFrame, mapping expressions
  compile to Polars expressions, and each partition is written as Parquet.
- A 30-minute fetch timeout is enforced by the **caller** (`karet`,
  via `AbortSignal.timeout`). The worker itself doesn't time out.

## Required env vars

| Variable | Purpose |
|----------|---------|
| `S3_BUCKET_PIPELINES` | Bucket for pipeline configs (default `karet-pipelines`). |
| `S3_BUCKET_LAKE` | Bucket for raw CSVs (default `karet-lake`). |
| `S3_BUCKET_WAREHOUSE` | Bucket for Parquet output (default `karet-warehouse`). |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | S3 credentials. |
| `AWS_ENDPOINT_URL` | S3 endpoint URL (e.g. `http://rustfs:9000` for local dev, `https://s3.<region>.amazonaws.com` for real AWS). |
| `PORT` | Optional HTTP listen port (default `8080`). |
