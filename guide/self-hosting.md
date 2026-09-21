# Self-hosting

To run Karet on your own hardware, pull the prebuilt container images
from GitHub Container Registry and start them with Docker Compose.

## Prerequisites

- Docker with the Compose plugin (`docker compose`), or any other
  Compose-speaking runtime (Finch, Podman with `podman-compose`).
- A working directory; the compose file creates Docker volumes for the
  S3 emulator's data and the Valkey queue.
- About 1 GB of free disk for those volumes plus the four images.

The published images are:

| Image | Source |
|-------|--------|
| `ghcr.io/karet-org/karet:latest` | [`karet-org/karet`](https://github.com/karet-org/karet), Next.js UI |
| `ghcr.io/karet-org/karet-worker:latest` | [`karet-org/karet-worker`](https://github.com/karet-org/karet-worker), Rust/Axum pipeline worker |
| `rustfs/rustfs:latest` | Upstream [RustFS](https://github.com/rustfs/rustfs) S3-compatible object store |
| `valkey/valkey:8-alpine` | Upstream [Valkey](https://valkey.io), job queue and live state |

`:latest` tracks the default branch of each repo. Pin to a versioned
tag (e.g. `0.2.0`) for reproducible deploys.

## 1. Drop in the compose file

Save this as `compose.yml` in an empty directory (it's the same file
shipped at the root of the `karet` repo):

```yaml
name: karet

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-karet}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD (e.g. openssl rand -hex 24)}
      POSTGRES_DB: ${POSTGRES_DB:-karet}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-karet} -d ${POSTGRES_DB:-karet}"]
      interval: 5s
      timeout: 3s
      retries: 20

  valkey:
    image: valkey/valkey:8-alpine
    restart: unless-stopped
    # AOF with everysec fsync: at most ~1s of queue/debounce state lost on
    # crash. Job history is durable in S3 regardless.
    command: ["valkey-server", "--appendonly", "yes", "--appendfsync", "everysec", "--maxclients", "1024"]
    volumes:
      - valkey-data:/data
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  rustfs:
    image: rustfs/rustfs:latest
    restart: unless-stopped
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      RUSTFS_VOLUMES: /data
      RUSTFS_ADDRESS: 0.0.0.0:9000
      RUSTFS_CONSOLE_ADDRESS: 0.0.0.0:9001
      RUSTFS_CONSOLE_ENABLE: "true"
      RUSTFS_ACCESS_KEY: ${AWS_ACCESS_KEY_ID:-rustfsadmin}
      RUSTFS_SECRET_KEY: ${AWS_SECRET_ACCESS_KEY:-rustfsadmin}
      RUSTFS_CORS_ALLOWED_ORIGINS: "*"
      RUSTFS_CONSOLE_CORS_ALLOWED_ORIGINS: "*"
      RUSTFS_NOTIFY_ENABLE: "true"
      RUSTFS_NOTIFY_WEBHOOK_ENABLE_PRIMARY: "on"
      # Upload events go to the worker, which owns debounce + enqueue.
      # The secret rides in a header, not the URL.
      RUSTFS_NOTIFY_WEBHOOK_ENDPOINT_PRIMARY: "http://worker:8080/events/s3"
      RUSTFS_NOTIFY_WEBHOOK_AUTH_TOKEN_PRIMARY: ${KARET_WEBHOOK_SECRET:?set KARET_WEBHOOK_SECRET (e.g. openssl rand -hex 32)}
      RUSTFS_NOTIFY_WEBHOOK_QUEUE_DIR_PRIMARY: /tmp/rustfs-events
      # RustFS only makes outbound requests to allow-listed origins.
      RUSTFS_OUTBOUND_ALLOW_ORIGINS: "http://worker:8080"
    volumes:
      - rustfs-data:/data

  worker:
    image: ghcr.io/karet-org/karet-worker:latest
    restart: unless-stopped
    environment:
      PORT: "8080"
      S3_BUCKET_PIPELINES: ${S3_BUCKET_PIPELINES:-karet-pipelines}
      S3_BUCKET_LAKE: ${S3_BUCKET_LAKE:-karet-lake}
      S3_BUCKET_WAREHOUSE: ${S3_BUCKET_WAREHOUSE:-karet-warehouse}
      AWS_ENDPOINT_URL: ${AWS_ENDPOINT_URL:-http://rustfs:9000}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-rustfsadmin}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-rustfsadmin}
      AWS_REGION: ${AWS_REGION:-us-east-1}
      KARET_WORKER_TOKEN: ${KARET_WORKER_TOKEN:?set KARET_WORKER_TOKEN (e.g. openssl rand -hex 32)}
      REDIS_URL: redis://valkey:6379
      KARET_WEBHOOK_SECRET: ${KARET_WEBHOOK_SECRET:?set KARET_WEBHOOK_SECRET (e.g. openssl rand -hex 32)}
      WORKER_CONCURRENCY: ${WORKER_CONCURRENCY:-1}
      DATABASE_URL: ${DATABASE_URL:-postgres://karet:${POSTGRES_PASSWORD}@postgres:5432/karet}
    depends_on:
      rustfs:
        condition: service_started
      valkey:
        condition: service_healthy
      postgres:
        condition: service_healthy

  web:
    image: ghcr.io/karet-org/karet:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      S3_BUCKET_PIPELINES: ${S3_BUCKET_PIPELINES:-karet-pipelines}
      S3_BUCKET_LAKE: ${S3_BUCKET_LAKE:-karet-lake}
      S3_BUCKET_WAREHOUSE: ${S3_BUCKET_WAREHOUSE:-karet-warehouse}
      AWS_ENDPOINT_URL: ${AWS_ENDPOINT_URL:-http://rustfs:9000}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-rustfsadmin}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-rustfsadmin}
      AWS_REGION: ${AWS_REGION:-us-east-1}
      S3_FORCE_PATH_STYLE: "true"
      KARET_SESSION_SECRET: ${KARET_SESSION_SECRET:?set KARET_SESSION_SECRET (e.g. openssl rand -base64 48)}
      KARET_ADMIN_USERNAME: ${KARET_ADMIN_USERNAME:-admin}
      KARET_ADMIN_PASSWORD_HASH: ${KARET_ADMIN_PASSWORD_HASH:?generate with `npm run hash-password`}
      KARET_WORKER_TOKEN: ${KARET_WORKER_TOKEN:?set KARET_WORKER_TOKEN (e.g. openssl rand -hex 32)}
      REDIS_URL: redis://valkey:6379
      DATABASE_URL: ${DATABASE_URL:-postgres://karet:${POSTGRES_PASSWORD}@postgres:5432/karet}
      KARET_PUBLIC_URL: ${KARET_PUBLIC_URL:-http://localhost:3000}
    depends_on:
      rustfs:
        condition: service_started
      worker:
        condition: service_started
      valkey:
        condition: service_healthy
      postgres:
        condition: service_healthy

volumes:
  rustfs-data:
  valkey-data:
  postgres-data:
```

The worker and Valkey ports are not exposed to the host. They are only
reachable over the compose network.

## 2. Generate the secrets

Karet refuses to start without five secrets. Four are random strings; the
fifth is your admin password, hashed:

```sh
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
KARET_SESSION_SECRET=$(openssl rand -base64 48)
KARET_WORKER_TOKEN=$(openssl rand -hex 32)
KARET_WEBHOOK_SECRET=$(openssl rand -hex 32)
EOF
```

`POSTGRES_PASSWORD` is what the bundled Postgres starts with and what the
default `DATABASE_URL` uses to reach it, so changing it later means changing
both.

For the admin password hash, run `npm run hash-password` in a checkout
of the [`karet`](https://github.com/karet-org/karet) repo. It prompts
for a password (≥ 8 characters) and prints a ready-to-paste
`KARET_ADMIN_PASSWORD_HASH=...` line for `.env`. See
[Authentication](./authentication) for why compose needs the
`$$`-escaped variant.

## 3. Start the stack

```sh
docker compose up -d
```

First boot pulls ~300 MB of images.

## 4. Create the buckets

Karet stores data in three S3 buckets and does **not** create them for
you. With the stack up, create them once against RustFS. The defaults
are `karet-pipelines`, `karet-lake`, and `karet-warehouse` (override
with the `S3_BUCKET_*` variables in the reference below).

The AWS CLI reads credentials from the environment. Use the same keys
RustFS was started with (defaults `rustfsadmin` / `rustfsadmin`):

```sh
export AWS_ACCESS_KEY_ID=rustfsadmin
export AWS_SECRET_ACCESS_KEY=rustfsadmin

for b in karet-pipelines karet-lake karet-warehouse; do
  aws --endpoint-url http://localhost:9000 --region us-east-1 \
    s3api create-bucket --bucket "$b"
done
```

No CLI handy? Create the three buckets from the RustFS console at
<http://localhost:9001> instead.

Now open <http://localhost:3000> and sign in with the password you
hashed in step 2.

To wire up auto-runs (uploads triggering pipeline jobs), one more
one-time step is needed: see [Auto-runs](./webhooks#setup).

## 5. Tail the logs (optional)

```sh
docker compose logs -f web worker
```

Once the worker is up you'll see `queue enabled: consumer=worker-…`,
and the web service prints `▲ Next.js 15.x  ✓ Ready in …ms`.

## Configuration reference

All services share environment variables for S3 access. The defaults
(`rustfsadmin` / `rustfsadmin`, buckets `karet-pipelines` / `karet-lake`
/ `karet-warehouse`) are fine for a single-node homelab; rotate them if
your network is shared.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET_PIPELINES` | `karet-pipelines` | Bucket for dashboards and saved queries. |
| `S3_BUCKET_LAKE` | `karet-lake` | Bucket for raw source files. |
| `S3_BUCKET_WAREHOUSE` | `karet-warehouse` | Bucket for partitioned Parquet output. |
| `AWS_ENDPOINT_URL` | `http://rustfs:9000` | S3 endpoint URL. Set to `https://s3.<region>.amazonaws.com` to swap out RustFS for real AWS. |
| `AWS_ACCESS_KEY_ID` | `rustfsadmin` | S3 access key. |
| `AWS_SECRET_ACCESS_KEY` | `rustfsadmin` | S3 secret key. |
| `AWS_REGION` | `us-east-1` | AWS region. |
| `REDIS_URL` | `redis://valkey:6379` | Valkey/Redis connection string (web + worker). |
| `DATABASE_URL` | *(required)* | Postgres connection string (web + worker). Accounts, pipelines, config versions, job history, access. |
| `POSTGRES_PASSWORD` | *(required)* | Password for the bundled Postgres, which the default `DATABASE_URL` interpolates. |
| `POSTGRES_USER` / `POSTGRES_DB` | `karet` | Role and database name for that Postgres. |
| `KARET_SESSION_SECRET` | *(required)* | Signs session cookies. `openssl rand -base64 48`. |
| `KARET_ADMIN_PASSWORD_HASH` | *(required)* | scrypt hash of the bootstrap admin's password, re-asserted on every start (`npm run hash-password`). |
| `KARET_ADMIN_USERNAME` | `admin` | Username of that bootstrap admin. |
| `KARET_WORKER_TOKEN` | *(required)* | Bearer token the web service sends on worker `/config/validate` calls. |
| `KARET_WEBHOOK_SECRET` | *(required)* | Shared secret RustFS sends with upload events; verified by the worker. |
| `KARET_PUBLIC_URL` | `http://localhost:3000` | The URL people reach this instance on. An `https:` value turns on secure cookies, so set it when you put Karet behind a proxy. |
| `S3_FORCE_PATH_STYLE` | unset | `true` for S3 implementations without virtual-host addressing, RustFS included. |
| `WORKER_CONCURRENCY` | `1` | Jobs processed concurrently per worker. |
| `DUCKDB_MEMORY_LIMIT` | `512MB` | Memory cap for the web service's DuckDB session. |
| `DUCKDB_THREADS` | `2` | Thread cap for that session. |
| `DATABASE_POOL_MAX` | `8` web, `4` worker | Postgres connections each service opens. |

## Upgrading

```sh
docker compose pull
docker compose up -d
```

The `postgres-data`, `rustfs-data` and `valkey-data` volumes persist across
restarts and pulls, so your accounts, pipelines, dashboards, job history and
queued jobs all survive upgrades. `postgres-data` is the one to back up: it holds
everything that is not a file. The web image runs `scripts/db-setup.mjs` before
it serves, so the schema migrates itself; several containers starting together is
safe, because the first takes an advisory lock and the rest find nothing to do.

::: warning Upgrading from ≤ 0.9.x
0.10.0 moves the control plane into Postgres: pipelines, config versions, job
history and accounts are rows now, not objects in the pipelines bucket. Nothing
is deleted from S3 by the upgrade, so it is reversible by putting the old images
back.

1. **Back up the buckets.** They are the only copy of your pipelines until the
   import has run:
   ```sh
   docker run --rm -v karet_rustfs-data:/src:ro -v "$PWD":/dst alpine:3 \
     tar -C /src -czf /dst/karet-buckets.tar.gz karet-pipelines karet-lake karet-warehouse
   ```
2. **Add Postgres and the new variables.** Take the `postgres` service from the
   compose file above, add `POSTGRES_PASSWORD` to `.env`, and give both `web` and
   `worker` the same `DATABASE_URL`. If you set `BETTER_AUTH_SECRET` or
   `BETTER_AUTH_URL` by hand, they are `KARET_SESSION_SECRET` and
   `KARET_PUBLIC_URL`; `S3_CONSOLE_URL` is gone.
3. **Start the database and apply the schema.**
   ```sh
   docker compose pull
   docker compose up -d postgres
   docker compose run --rm --no-deps web node scripts/db-setup.mjs
   ```
   That also creates the bootstrap admin from `KARET_ADMIN_PASSWORD_HASH`, so
   your existing password still works. Other people are accounts you create in
   Settings afterwards.
4. **Import what is in S3.** Report first, then do it:
   ```sh
   docker compose run --rm --no-deps -e DRY_RUN=1 web node scripts/import-s3-to-postgres.mjs
   docker compose run --rm --no-deps web node scripts/import-s3-to-postgres.mjs
   ```
   Each `pipeline.json` becomes config version 1 with its `_history/*.json`
   folded in ahead of it, and each `jobs/*.json` becomes a job row. Dashboards,
   saved queries, lake files and Parquet stay where they are.
5. **Adopt tables written before manifests**, or they read as empty:
   ```sh
   docker compose run --rm --no-deps web node scripts/adopt-warehouse-manifests.mjs
   ```
6. **Bring the rest up:** `docker compose up -d`.
7. **Leave `pipelines/<slug>/pipeline.json` in place.** The worker builds its
   upload-routing table by listing those objects, so deleting them stops
   upload-triggered runs. Manual runs are unaffected.

Both scripts are idempotent and only insert what is missing, so a partial run can
be repeated.
:::

::: warning Upgrading from ≤ 0.1.x
0.2.0 changed the architecture: jobs now travel over a Valkey queue, the
webhook receiver moved from the web service to the worker, and the admin
password moved from S3 to `KARET_ADMIN_PASSWORD_HASH`. To migrate:

1. Replace your compose file with the one above (adds `valkey`, new env).
2. Generate `KARET_WORKER_TOKEN` and `KARET_WEBHOOK_SECRET`.
3. Carry your password over: copy `password_hash` out of
   `_auth/admin.json` in the pipelines bucket into
   `KARET_ADMIN_PASSWORD_HASH` (double every `$` for compose), then
   delete the S3 object. Or just hash a fresh password.
4. Re-point the RustFS webhook at the worker and re-apply the bucket
   notification rule ([Auto-runs](./webhooks#setup)).
:::

To wipe state and start over:

```sh
docker compose down -v
```

## Switching off the bundled S3 emulator

For deployments backed by real AWS S3 instead of RustFS, drop the
`rustfs` service from the compose file and point the web and worker at
your buckets:

- Set `AWS_ENDPOINT_URL` to the regional S3 endpoint
  (`https://s3.<region>.amazonaws.com`) on both services.
- Set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
  `AWS_REGION` to credentials that can read/write the buckets.
- Set `S3_BUCKET_PIPELINES` / `S3_BUCKET_LAKE` / `S3_BUCKET_WAREHOUSE`
  to your bucket names.
- Drop `S3_FORCE_PATH_STYLE` from the web service, real S3 prefers
  virtual-hosted addressing.
- Auto-runs need an event source that can POST to the worker's
  `/events/s3`; on AWS, wire S3 Event Notifications through a small
  forwarder (Lambda) or skip webhooks and trigger runs manually.

Keep the `valkey` service (or point `REDIS_URL` at a managed
Redis-compatible endpoint such as ElastiCache for Valkey).

## What's next?

- [Getting started](./getting-started), build a Spending Tracker pipeline
  end to end.
- [Architecture](./architecture), the services and how they connect.
- [Authentication](./authentication), env-based credential and password rotation.
