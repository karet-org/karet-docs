# Worker HTTP API

The worker (`karet-worker`) is a Rust/Axum service that runs pipeline
jobs. It binds to `:8080` inside the compose network.

Jobs do not arrive over HTTP. The worker consumes them from the Valkey
stream `karet:jobs:stream` via a consumer group; see
[Architecture](/guide/architecture#the-job-queue). The HTTP surface is
three endpoints:

## Endpoints

### `GET /health`

Liveness and readiness. Reports Redis connectivity, stream length, and
in-flight job count; returns `503` when Valkey is unreachable.

```json
{ "redis": "ok", "queue_depth": 0, "in_flight": 1 }
```

`GET /` also answers `200`. RustFS probes the webhook origin's root
before delivering events.

### `POST /config/validate`

Type-check a candidate `pipeline.json` body without running anything.
Used by the graph editor's "Validate" button.

**Auth**: `Authorization: Bearer <KARET_WORKER_TOKEN>`.

**Request body**: a `PipelineConfig` JSON (see
[Pipeline config](./pipeline-config)).

**Response**: always `200`, with `{ "ok": true }` or
`{ "ok": false, "errors": [{ "kind", "message", "path" }] }` where
`path` is a JSON Pointer to the offending config node.

### `POST /events/s3`

RustFS object-created notifications; drives [auto-runs](/guide/webhooks).

**Auth**: the webhook secret, as `X-Karet-Webhook-Secret: <secret>` or an
`Authorization` header, bare or `Bearer`-prefixed. RustFS's
`WEBHOOK_AUTH_TOKEN` sends whichever form it's configured with.

Accepts the standard S3 event envelope (`Records[].eventName`,
`Records[].s3.bucket.name`, `Records[].s3.object.key`). Only
`s3:ObjectCreated:*` events for the lake bucket are acted on; each
matching `pipelines/<slug>/...` key extends that slug's debounce window.

## Job lifecycle (queue, not HTTP)

A stream message carries `{ job_id, pipeline, prefix, clean_run,
trigger, enqueued_at }`. For each claimed job the worker:

1. Takes the per-pipeline run lock (at most one run per pipeline,
   cluster-wide; lock-busy jobs defer and retry).
2. Validates the config; an invalid config fails the job without retry.
3. With `clean_run: true`, deletes existing table output first so
   removed CSVs don't leave stale partitions. The default is
   incremental: re-runs overwrite partitions in place (idempotent).
4. Streams progress into `karet:jobs:live:<id>` (stage, file and
   mapping counters, partitions written).
5. Writes the terminal record to
   `pipelines/<slug>/jobs/<job_id>.json` in S3, then acks.

Transient failures (e.g. S3 unreachable) retry with exponential backoff
up to `MAX_ATTEMPTS`. Jobs whose worker died are reclaimed by another
worker after ~2 minutes of pending-idle. On SIGTERM the worker stops
claiming, finishes in-flight jobs, and exits.

## Required env vars

All required unless noted; the worker fails fast if any is missing.

| Variable | Purpose |
|----------|---------|
| `S3_BUCKET_PIPELINES` | Bucket for pipeline configs (default `karet-pipelines`). |
| `S3_BUCKET_LAKE` | Bucket for raw CSVs (default `karet-lake`). |
| `S3_BUCKET_WAREHOUSE` | Bucket for Parquet output (default `karet-warehouse`). |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | S3 credentials. |
| `AWS_ENDPOINT_URL` | S3 endpoint URL (e.g. `http://rustfs:9000` for local dev). |
| `REDIS_URL` | Valkey/Redis connection string (e.g. `redis://valkey:6379`). |
| `KARET_WORKER_TOKEN` | Bearer token for `POST /config/validate`; the web service sends the same value. |
| `KARET_WEBHOOK_SECRET` | Shared secret for `POST /events/s3`. |
| `WORKER_CONCURRENCY` | Optional. Jobs processed concurrently per worker (default `1`). |
| `MAX_ATTEMPTS` | Optional. Delivery attempts before a job is terminally failed (default `3`). |
| `JOB_LOCK_TTL_MS` / `HEARTBEAT_MS` | Optional. Per-pipeline lock TTL and heartbeat interval (defaults `90000` / `30000`). |
| `PORT` | Optional HTTP listen port (default `8080`). |

## Scaling

Run more workers (`docker compose up --scale worker=N` or more
replicas): the consumer group distributes jobs, and per-pipeline locks
keep each pipeline serialized. Each run currently materializes its CSVs
in memory, so size worker memory to your largest pipeline's raw data.
