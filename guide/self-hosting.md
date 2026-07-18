# Self-hosting

To run Karet on your own hardware, pull the prebuilt container images
from GitHub Container Registry and start them with Docker Compose.

## Prerequisites

- Docker with the Compose plugin (`docker compose`), or any other
  Compose-speaking runtime (Finch, Podman with `podman-compose`).
- A working directory; the compose file creates one Docker volume for
  the S3 emulator's data.
- About 1 GB of free disk for that volume plus the three images.

The published images are:

| Image | Source |
|-------|--------|
| `ghcr.io/karet-org/karet:latest` | [`karet-org/karet`](https://github.com/karet-org/karet), Next.js UI |
| `ghcr.io/karet-org/karet-worker:latest` | [`karet-org/karet-worker`](https://github.com/karet-org/karet-worker), Rust/Axum pipeline worker |
| `rustfs/rustfs:latest` | Upstream [RustFS](https://github.com/rustfs/rustfs) S3-compatible object store |

`:latest` tracks the default branch of each repo. Pin to a versioned
tag once releases are cut for reproducible deploys.

## 1. Drop in the compose file

Save this as `compose.yml` in an empty directory:

```yaml
name: karet

services:
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
      RUSTFS_NOTIFY_WEBHOOK_ENDPOINT_PRIMARY: "http://web:3000/api/events/s3?secret=${KARET_WEBHOOK_SECRET:-}"
      RUSTFS_NOTIFY_WEBHOOK_QUEUE_DIR_PRIMARY: /tmp/rustfs-events
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
    depends_on:
      - rustfs

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
      KARET_WEBHOOK_SECRET: ${KARET_WEBHOOK_SECRET:-}
      S3_CONSOLE_URL: ${S3_CONSOLE_URL:-http://localhost:9001}
    depends_on:
      - rustfs
      - worker

volumes:
  rustfs-data:
```

The worker port is intentionally not exposed to the host, it's only
reachable through the `web` service over the compose network.

## 2. Generate the required secret

Karet refuses to start without `KARET_SESSION_SECRET` (otherwise anyone
who guessed the default would forge a session). Drop it in a
`.env` file next to the compose file:

```sh
echo "KARET_SESSION_SECRET=$(openssl rand -base64 48)" > .env
```

You can optionally add the webhook secret while you're at it:

```sh
echo "KARET_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env
```

It's off by default. Setting it enables the auto-run webhook
receiver; without it, RustFS upload events are ignored. See
[Auto-runs](./webhooks).

## 3. Start the stack

```sh
docker compose up -d
```

First boot pulls ~250 MB of images.

## 4. Create the buckets

Karet stores data in three S3 buckets and does **not** create them for
you. With the stack up, create them once against RustFS. The defaults
are `karet-pipelines`, `karet-lake`, and `karet-warehouse` (override
with the `S3_BUCKET_*` variables in the reference below).

The AWS CLI reads credentials from the environment — use the same keys
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

Now open <http://localhost:3000>. The first visit shows a "Set admin
password" form. Pick a password (≥ 8 characters) and click **Set
password**.

## 5. Tail the logs (optional)

```sh
docker compose logs -f web worker
```

Once the worker is responsive you'll see `Listening on 0.0.0.0:8080`,
and the web service prints `▲ Next.js 15.x  ✓ Ready in …ms`.

## Configuration reference

All three services share environment variables for S3 access. The
defaults (`rustfsadmin` / `rustfsadmin`, buckets `karet-pipelines` /
`karet-lake` / `karet-warehouse`) are fine for a single-node homelab;
rotate them if your network is shared.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET_PIPELINES` | `karet-pipelines` | Bucket for configs, dashboards, jobs, and auth. |
| `S3_BUCKET_LAKE` | `karet-lake` | Bucket for raw CSVs. |
| `S3_BUCKET_WAREHOUSE` | `karet-warehouse` | Bucket for partitioned Parquet output. |
| `AWS_ENDPOINT_URL` | `http://rustfs:9000` | S3 endpoint URL. Set to `https://s3.<region>.amazonaws.com` to swap out RustFS for real AWS. |
| `AWS_ACCESS_KEY_ID` | `rustfsadmin` | S3 access key. |
| `AWS_SECRET_ACCESS_KEY` | `rustfsadmin` | S3 secret key. |
| `AWS_REGION` | `us-east-1` | AWS region. |
| `KARET_SESSION_SECRET` | *(required)* | HMAC key for signing user session cookies. |
| `KARET_WEBHOOK_SECRET` | *(empty)* | Shared secret enforced by `/api/events/s3`. Empty disables the webhook receiver. |
| `S3_CONSOLE_URL` | `http://localhost:9001` | If set, the UI shows a Settings &rarr; S3 console link pointing at this URL. Empty hides the link entirely (recommended for AWS deployments). |

## Upgrading

```sh
docker compose pull
docker compose up -d
```

The `rustfs-data` volume persists across restarts and pulls, so your
pipelines, dashboards, jobs history, and admin password all survive
upgrades. To wipe state and start over:

```sh
docker compose down -v
```

## Switching off the bundled S3 emulator

For deployments backed by real AWS S3 instead of RustFS, drop the
`rustfs` service from the compose file and point the other two at
your bucket:

- Set `AWS_ENDPOINT_URL` to the regional S3 endpoint
  (`https://s3.<region>.amazonaws.com`) on both services.
- Set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
  `AWS_REGION` to credentials that can read/write the buckets.
- Set `S3_BUCKET_PIPELINES` / `S3_BUCKET_LAKE` / `S3_BUCKET_WAREHOUSE`
  to your bucket names.
- Drop `S3_FORCE_PATH_STYLE` from the web service, real S3 prefers
  virtual-hosted addressing.

## What's next?

- [Getting started](./getting-started), build a Spending Tracker pipeline
  end to end.
- [Architecture](./architecture), the three services and how they connect.
- [Authentication](./authentication), single-admin flow and password rotation.
