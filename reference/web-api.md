# Web HTTP API

The web service (`karet`) hosts both the UI and the JSON API the UI
talks to. Every `/api/*` route enforces auth except the explicitly-public
ones below.

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
| `DELETE /api/pipelines/[slug]` | Delete every object under `pipelines/<slug>/`. |
| `PATCH /api/pipelines/[slug]` | Body `{ newSlug }`. Renames by copy-then-delete. |

## Per-pipeline

| Endpoint | Purpose |
|----------|---------|
| `GET /api/p/[pipeline]/config` | Fetch `pipeline.json`. Returns the parsed body and the S3 ETag in a `Last-Modified` style header. |
| `PUT /api/p/[pipeline]/config` | Replace `pipeline.json`. Honors `If-Match: <etag>` for optimistic concurrency. |
| `POST /api/p/[pipeline]/validate` | Forward to the worker's `/config/validate`. |
| `GET /api/p/[pipeline]/dashboards` | List dashboard names. |
| `GET /api/p/[pipeline]/dashboards/[name]` | Fetch a single dashboard config. |
| `GET /api/p/[pipeline]/tables` | Per-table metadata: name, schema, file count. |
| `GET /api/p/[pipeline]/tables/[table]/rows` | Stream the table's rows (parses every Parquet file under the prefix). |
| `GET /api/p/[pipeline]/jobs` | Job history with orphan reconciliation (`running` jobs older than 10 min get marked `failed`). |
| `POST /api/p/[pipeline]/jobs?clean=true` | Trigger a manual run. Returns the initial `running` record immediately; the worker call happens in the background. |
| `GET /api/p/[pipeline]/export` | Stream a `.zip` of every object under the slug. |

## Webhooks

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/events/s3` | shared secret | RustFS S3-event receiver. See [Auto-runs](/guide/webhooks). |

## Auth shapes

The middleware (`middleware.ts`) accepts requests authenticated via:

1. The `karet_session` cookie set by `/api/auth/login` or `/api/auth/setup`.
2. `KARET_API_KEY` in either `X-API-Key` or `Authorization: Bearer <key>`.

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
| `unauthorized` | Missing/invalid session or API key. |
| `bucket_not_found` | The S3 bucket doesn't exist. Most-common cause: S3_BUCKET mistype. |
| `s3_error` | Catch-all for everything else from the S3 SDK. |
| `pipeline_config_not_found` | The slug exists but its `pipeline.json` is missing. |
| `dashboard_not_found` | The slug exists but no dashboard at the given name. |
| `invalid_slug` | The slug failed sanitization. |
| `already_exists` | Trying to create or rename onto an existing slug. |
