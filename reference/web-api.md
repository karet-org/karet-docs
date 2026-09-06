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
| `POST /api/auth/login` | public, rate-limited | Body `{ password }`. Sets the session cookie on success; `429` + `Retry-After` when throttled. |
| `POST /api/auth/logout` | session | Clears the session cookie. |
| `GET /api/auth/me` | session | Returns `{ authenticated: true }`. |

The admin credential is provisioned via `KARET_ADMIN_PASSWORD_HASH`;
there is no setup or password-change endpoint. See
[Authentication](/guide/authentication).

## Pipelines

| Endpoint | Purpose |
|----------|---------|
| `GET /api/pipelines` | List pipeline slugs. |
| `POST /api/pipelines` | Body `{ slug, template }`. Provisions a new pipeline from a template. |
| `POST /api/pipelines/import` | Multipart upload of a `.zip` exported from another instance. |
| `DELETE /api/pipelines/[slug]` | Delete every object under `pipelines/<slug>/` across all three buckets. |
| `PATCH /api/pipelines/[slug]` | Body `{ newSlug }`. Renames by copy-then-delete across all three buckets. |

## Workspace

| Endpoint | Purpose |
|----------|---------|
| `GET /api/settings` | Workspace UI settings (display name, workspace name, starred pipelines). |
| `PUT /api/settings` | Replace the settings document (input sanitized). |
| `GET /api/lake?prefix=` | One level of the lake bucket: folders and files. |
| `PUT /api/lake?key=` | Upload one file (validated key, 100 MB cap). CSVs under a pipeline prefix trigger a debounced run. |
| `POST /api/lake` | Body `{ from, to }`. Move an object (copy then delete). |
| `DELETE /api/lake?key=` | Delete an object. |
| `GET /api/lake/object?key=` | Download an object as an attachment. |

## Per-pipeline

| Endpoint | Purpose |
|----------|---------|
| `GET /api/p/[pipeline]/config` | Fetch `pipeline.json`. Returns the parsed body and the S3 ETag in a `Last-Modified` style header. |
| `PUT /api/p/[pipeline]/config` | Replace `pipeline.json`. Honors `If-Match: <etag>` for optimistic concurrency. |
| `POST /api/p/[pipeline]/validate` | Forward to the worker's `/config/validate`. |
| `GET /api/p/[pipeline]/dashboards` | List published dashboards and drafts. |
| `POST /api/p/[pipeline]/dashboards` | Create a draft from the v2 YAML template. |
| `GET /api/p/[pipeline]/dashboards/[name]` | Fetch a dashboard's YAML (`?draft=1` for the draft). |
| `PUT /api/p/[pipeline]/dashboards/[name]` | Save YAML. Published saves run the full gate; `?draft=1` saves without validation. |
| `POST /api/p/[pipeline]/dashboards/[name]/validate` | Advisory full-gate validation (editor live feedback); always 200 with the verdict. |
| `DELETE /api/p/[pipeline]/dashboards/[name]` | Delete draft and published objects. |
| `POST /api/p/[pipeline]/dashboards/[name]/publish` | Validate a draft (schema, bindings, SQL) and publish it. |
| `POST /api/p/[pipeline]/dashboards/[name]/data` | Run all panel queries with filter params; returns per-panel results. |
| `GET /api/p/[pipeline]/tables` | Per-table metadata: name, schema, file count. |
| `GET /api/p/[pipeline]/tables/[table]/rows` | The table's rows, read from the warehouse with DuckDB `read_parquet`. |
| `POST /api/p/[pipeline]/query` | Body `{ sql }`. Runs SQL against the pipeline's warehouse tables (each exposed as a DuckDB relation over its Parquet). Returns `{ columns, rows }`. |
| `GET /api/p/[pipeline]/queries` | List saved queries (`{ queries: SavedQuery[] }`). |
| `POST /api/p/[pipeline]/queries` | Body `{ name, sql }`. Save a query under a unique name. `409` if the name is taken. |
| `GET /api/p/[pipeline]/queries/[id]` | Fetch a single saved query. |
| `DELETE /api/p/[pipeline]/queries/[id]` | Delete a saved query. |
| `GET /api/p/[pipeline]/jobs` | Job history (S3) merged with live queue state from Valkey. Active jobs carry a `progress` object (stage, file/mapping counters). Statuses: `queued`, `running`, `completed`, `failed`. |
| `POST /api/p/[pipeline]/jobs?clean=true` | Trigger a manual run. Enqueues onto the job stream and returns the initial `queued` record immediately; a worker claims and executes it. |
| `GET /api/p/[pipeline]/export` | Stream a `.zip` of every object under the slug (across all three buckets). |

## Webhooks

The S3-event receiver lives on the **worker** (`POST /events/s3`), not
the web service. See [Auto-runs](/guide/webhooks) and the
[Worker API](./worker-api).

## Auth shape

The middleware (`middleware.ts`) accepts requests authenticated by the
`karet_session` cookie set by `/api/auth/login`.

Only `/api/auth/*` bypasses the middleware; everything else requires a
valid session cookie.

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
