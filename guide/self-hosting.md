# Self-hosting

The fastest way to run Karet on your own hardware is to pull the
prebuilt container images from GitHub Container Registry. No source
checkout, no Rust toolchain, no Node install. About 90 seconds from
nothing to a running instance.

## Prerequisites

- Docker with the Compose plugin (`docker compose`), or any other
  Compose-speaking runtime (Finch, Podman with `podman-compose`).
- A directory you don't mind being a Karet host: the compose file
  creates one Docker volume for the S3 emulator's data.
- About 1 GB of free disk for that volume plus the three images.

The published images are:

| Image | Source |
|-------|--------|
| `ghcr.io/karet-org/karet:latest` | [`karet-org/karet`](https://github.com/karet-org/karet) -- Next.js UI |
| `ghcr.io/karet-org/karet-worker:latest` | [`karet-org/karet-worker`](https://github.com/karet-org/karet-worker) -- Rust/Axum pipeline worker |
| `rustfs/rustfs:latest` | Upstream [RustFS](https://github.com/rustfs/rustfs) S3-compatible object store |

`:latest` tracks the default branch of each repo. Pin to a versioned
tag (e.g. `:v0.4.2`) once releases are cut if you want stability over
freshness.

## 1. Drop in the compose file

Save this as `docker-compose.yaml` in an empty directory:

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
      S3_BUCKET: ${S3_BUCKET:-karet-data}
      S3_ENDPOINT: ${S3_ENDPOINT:-http://rustfs:9000}
      AWS_ENDPOINT_URL: ${S3_ENDPOINT:-http://rustfs:9000}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-rustfsadmin}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-rustfsadmin}
      AWS_REGION: ${AWS_REGION:-us-east-1}
      POLARS_MAX_THREADS: "2"
    depends_on:
      - rustfs

  web:
    image: ghcr.io/karet-org/karet:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      HOSTNAME: 0.0.0.0
      S3_BUCKET: ${S3_BUCKET:-karet-data}
      S3_ENDPOINT: ${S3_ENDPOINT:-http://rustfs:9000}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-rustfsadmin}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-rustfsadmin}
      AWS_REGION: ${AWS_REGION:-us-east-1}
      S3_FORCE_PATH_STYLE: "true"
      KARET_SESSION_SECRET: ${KARET_SESSION_SECRET:?set KARET_SESSION_SECRET (e.g. openssl rand -base64 48)}
      KARET_API_KEY: ${KARET_API_KEY:-}
      KARET_WEBHOOK_SECRET: ${KARET_WEBHOOK_SECRET:-}
    depends_on:
      - rustfs
      - worker

volumes:
  rustfs-data:
```

The worker port is intentionally not exposed to the host -- it's only
reachable through the `web` service over the compose network.

## 2. Generate the required secret

Karet refuses to start without `KARET_SESSION_SECRET` (otherwise anyone
who guessed the default would forge a session). Drop it in a
`.env` file next to the compose file:

```sh
echo "KARET_SESSION_SECRET=$(openssl rand -base64 48)" > .env
```

You can optionally add the two other secrets while you're at it:

```sh
echo "KARET_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env
echo "KARET_API_KEY=$(openssl rand -hex 32)" >> .env
```

Both are off by default. `KARET_WEBHOOK_SECRET` enables the auto-run
webhook receiver; without it, RustFS upload events are ignored. See
[Auto-runs](./webhooks). `KARET_API_KEY` lets non-browser clients
(`curl`, scripts, the `karet-skills` family) call the API; without it,
only the cookie-authenticated UI flow works.

## 3. Start the stack

```sh
docker compose up -d
```

First boot pulls ~250 MB of images. Subsequent restarts are
sub-second.

Open <http://localhost:3000>. The first visit shows a "Set admin
password" form. Pick a password (≥ 8 characters) and click **Set
password**.

## 4. Tail the logs (optional)

```sh
docker compose logs -f web worker
```

Once the worker is responsive you'll see `Listening on 0.0.0.0:8080`,
and the web service prints `▲ Next.js 15.x  ✓ Ready in …ms`.

## Configuration reference

All three services share environment variables for S3 access. The
defaults (`rustfsadmin` / `rustfsadmin` / bucket `karet-data`) are
fine for a single-node homelab; rotate them if your network is
shared.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET` | `karet-data` | S3 bucket the worker reads from and writes to. |
| `S3_ENDPOINT` | `http://rustfs:9000` | S3 endpoint URL. Set to a real AWS endpoint to swap out RustFS. |
| `AWS_ACCESS_KEY_ID` | `rustfsadmin` | S3 access key. |
| `AWS_SECRET_ACCESS_KEY` | `rustfsadmin` | S3 secret key. |
| `AWS_REGION` | `us-east-1` | AWS region. |
| `KARET_SESSION_SECRET` | *(required)* | HMAC key for signing user session cookies. |
| `KARET_API_KEY` | *(empty)* | Shared-secret auth for `/api/*`. Empty disables it. |
| `KARET_WEBHOOK_SECRET` | *(empty)* | Shared secret enforced by `/api/events/s3`. Empty disables the webhook receiver. |

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

- Remove `S3_ENDPOINT` (and `AWS_ENDPOINT_URL` on the worker) so the
  AWS SDK hits real S3.
- Set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
  `AWS_REGION` to credentials that can read/write the bucket.
- Set `S3_BUCKET` to your bucket name.
- Drop `S3_FORCE_PATH_STYLE` from the web service -- real S3 prefers
  virtual-hosted addressing.

For full AWS deployment (ECS/Fargate, ALB, IAM task roles, CloudWatch),
see [Deploying to AWS](./deploy-aws).

## What's next?

- [Getting started](./getting-started) -- a hands-on walkthrough that
  builds a Spending Tracker pipeline and watches data flow through it.
- [Architecture](./architecture) -- the three services and how they
  talk to each other.
- [Authentication](./authentication) -- single-admin flow, password
  rotation, optional API-key auth for automation.
