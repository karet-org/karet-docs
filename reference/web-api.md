# Web HTTP API

The web service (`karet`) hosts both the UI and the JSON API the UI
talks to. The `/api/*` routes exist solely to back the browser UI and
require a session cookie, they are not a stable public surface and
not intended for scripting. For machine-driven workflows, talk
directly to the S3 store: pipelines, dashboards, and jobs all live as
JSON / Parquet objects under `pipelines/<slug>/`.

Every `/api/*` route enforces auth except the explicitly-public ones
below.

## Auth

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/auth/setup` | public | Returns `{ needsSetup: boolean }` so the login page knows which form to show. |
| `POST /api/auth/setup` | public, single-shot | Body `{ password }`. Refuses if an admin already exists. |
| `POST /api/auth/login` | public | Body `{ password }`. Sets the session cookie on success. |
| `POST /api/auth/logout` | session | Clears the session cookie. |
| `GET /api/auth/me` | session | Returns `{ authenticated: true }`. |
| `PATCH /api/auth/me` | session | Body `{ currentPassword, newPassword }`. Re-issues the cookie. |

## Pipelines

| Endpoint | Purpose |
|----------|---------|
| `GET /api/pipelines` | List pipeline slugs. |
| `POST /api/pipelines` | Body `{ slug, template }`. Provisions a new pipeline from a template. |
| `POST /api/pipelines/import` | Multipart upload of a `.zip` exported from another instance. |
| `DELETE /api/pipelines/[slug]` | Delete every object under `pipelines/<slug>/` across all three buckets. |
| `PATCH /api/pipelines/[slug]` | Body `{ newSlug }`. Renames by copy-then-delete across all three buckets. |

## Per-pipeline

| Endpoint | Purpose |
|----------|---------|
| `GET /api/p/[pipeline]/config` | Fetch `pipeline.json`. Returns the parsed body and the S3 ETag in a `Last-Modified` style header. |
| `PUT /api/p/[pipeline]/config` | Replace `pipeline.json`. Honors `If-Match: <etag>` for optimistic concurrency. |
| `POST /api/p/[pipeline]/validate` | Forward to the worker's `/config/validate`. |
| `GET /api/p/[pipeline]/dashboards` | List dashboard names. |
| `GET /api/p/[pipeline]/dashboards/[name]` | Fetch a single dashboard config. |
| `GET /api/p/[pipeline]/tables` | Per-table metadata: name, schema, file count. |
| `GET /api/p/[pipeline]/tables/[table]/rows` | The table's rows, read from the warehouse with DuckDB `read_parquet`. |
| `POST /api/p/[pipeline]/query` | Body `{ sql }`. Runs SQL against the pipeline's warehouse tables (each exposed as a DuckDB relation over its Parquet). Returns `{ columns, rows }`. |
| `GET /api/p/[pipeline]/queries` | List saved queries (`{ queries: SavedQuery[] }`). |
| `POST /api/p/[pipeline]/queries` | Body `{ name, sql }`. Save a query under a unique name. `409` if the name is taken. |
| `GET /api/p/[pipeline]/queries/[id]` | Fetch a single saved query. |
| `DELETE /api/p/[pipeline]/queries/[id]` | Delete a saved query. |
| `GET /api/p/[pipeline]/jobs` | Job history with orphan reconciliation (`running` jobs older than 10 min get marked `failed`). |
| `POST /api/p/[pipeline]/jobs?clean=true` | Trigger a manual run. Returns the initial `running` record immediately; the worker call happens in the background. |
| `GET /api/p/[pipeline]/export` | Stream a `.zip` of every object under the slug (across all three buckets). |

## Webhooks

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/events/s3` | shared secret | RustFS S3-event receiver. See [Auto-runs](/guide/webhooks). |

## Auth shape

The middleware (`middleware.ts`) accepts requests authenticated by the
`karet_session` cookie set by `/api/auth/login` or `/api/auth/setup`.

`/api/auth/*` and `/api/events/*` bypass the middleware and handle
their own auth: the auth routes are public, and the events route checks
a shared webhook secret.

## Error shape

Most routes return a JSON error body on 4xx/5xx:

```json
{ "error": "<machine_code>", "message": "Human-readable detail" }
```

Common codes:

| Code | Meaning |
|------|---------|
| `unauthorized` | Missing/invalid session cookie. |
| `bucket_not_found` | An S3 bucket doesn't exist. Most-common cause: an `S3_BUCKET_*` mistype. |
| `s3_error` | Catch-all for everything else from the S3 SDK. |
| `pipeline_config_not_found` | The slug exists but its `pipeline.json` is missing. |
| `dashboard_not_found` | The slug exists but no dashboard at the given name. |
| `invalid_slug` | The slug failed sanitization. |
| `already_exists` | Trying to create or rename onto an existing slug. |
