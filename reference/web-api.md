# Web HTTP API

The web service (`karet`) hosts both the UI and the JSON API the UI
talks to. The `/api/*` routes exist solely to back the browser UI and
require a session cookie, they are not a stable public surface and
not intended for scripting.

Every `/api/*` route enforces auth except the explicitly-public ones
below.

## Auth

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/auth/sign-in/username` | public, rate-limited | Body `{ username, password }`. Creates a session row and sets the cookie; `429` + `Retry-After` when throttled. |
| `POST /api/auth/sign-out` | session | Deletes the session row and clears the cookie. |
| `GET /api/auth/me` | session | Returns `{ authenticated, user: { username, role, service } }`. The **instance** role. |

`/api/auth/*` is [better-auth](https://better-auth.com); the routes above are the
ones the UI uses.

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
| `GET /api/p/[pipeline]/config` | The live config, with its version in `X-Karet-Config-Version`. |
| `PUT /api/p/[pipeline]/config` | Save a new version. Send back the version you loaded in `X-Karet-Config-Version`; a save against a stale version is refused with `412 stale_config`. |
| `GET /api/p/[pipeline]/config/history` | Versions newest first, with author and note. |
| `GET /api/p/[pipeline]/config/history/[version]` | One version, with its diff against the live config. |
| `POST /api/p/[pipeline]/config/history/[version]/revert` | Write that version forward as a new one. |
| `GET /api/p/[pipeline]/role` | The caller's effective role **on this pipeline**, which a membership or ownership may differ from their instance role. Presentation only. |
| `GET /api/p/[pipeline]/members` | admin here. `{ visibility, owner, members, accounts }`. |
| `PUT /api/p/[pipeline]/members` | admin here. One of `{ visibility }`, `{ username, role }` or `{ owner }`. Answers with the resulting `{ visibility, owner, members }`. |
| `DELETE /api/p/[pipeline]/members?username=` | admin here. Revoke a grant. |
| `POST /api/p/[pipeline]/validate` | Forward to the worker's `/config/validate`. |
| `GET /api/p/[pipeline]/dashboards` | List published dashboards and drafts. |
| `POST /api/p/[pipeline]/dashboards` | Create a draft from the v2 YAML template. |
| `GET /api/p/[pipeline]/dashboards/[name]` | Fetch a dashboard's YAML (`?draft=1` for the draft). |
| `PUT /api/p/[pipeline]/dashboards/[name]` | Save YAML. Published saves run the full gate; `?draft=1` saves without validation. |
| `POST /api/p/[pipeline]/dashboards/[name]/validate` | Advisory full-gate validation (editor live feedback); always 200 with the verdict. |
| `DELETE /api/p/[pipeline]/dashboards/[name]` | Delete draft and published objects. |
| `POST /api/p/[pipeline]/dashboards/[name]/publish` | Validate a draft (schema, bindings, SQL) and publish it. |
| `POST /api/p/[pipeline]/dashboards/[name]/data` | Run all panel queries with filter params; returns per-panel results. |
| `GET /api/p/[pipeline]/tables` | Per-table metadata: name, schema, file count, live version. `version: 0` means no run has published the table yet, so it is not queryable. |
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

The middleware (`middleware.ts`) checks only that a session cookie is present.
Every route then resolves the caller against the pipeline it addresses, because a
membership or ownership can change the answer and the edge cannot read the
database. See [per-pipeline access](/guide/authentication#per-pipeline-access).

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
| `not_found` | Also returned instead of `403` for a members-only pipeline the caller is not on, so its existence is not leaked. |
| `stale_config` | `412`. The config moved on since the editor loaded it. |
| `owner_access_is_permanent` | `422`. The owner cannot be removed from the member list or set below admin; transfer the pipeline instead. |
| `not_owner` | `403`. Only the owner or an instance admin may transfer a pipeline. |
| `query_error` | `400`. SQL failed. A table the pipeline configures but has never run reads "has no data yet. Run the pipeline to load it." |
