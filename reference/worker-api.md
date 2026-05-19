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

`clean_run: true` deletes existing `clean/<table_id>/` output before
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
- It uses Polars under the hood. `POLARS_MAX_THREADS=2` is set in the
  default compose to keep memory in check on small machines; raise it
  for bigger workloads.
- A 30-minute fetch timeout is enforced by the **caller** (`karet`,
  via `AbortSignal.timeout`). The worker itself doesn't time out.

## Required env vars

| Variable | Purpose |
|----------|---------|
| `S3_BUCKET` | Bucket name. |
| `S3_ENDPOINT` / `AWS_ENDPOINT_URL` | S3 endpoint URL. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | S3 credentials. |
| `PORT` | HTTP listen port (default `8080`). |
