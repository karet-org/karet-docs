# Authentication

Karet is **single-admin** and **password-only**. There's one admin
password; anyone who knows it has full access.

## Provisioning the password

The credential is an **scrypt hash in the environment**
(`KARET_ADMIN_PASSWORD_HASH`), not a record in storage. Generate it from
a checkout of the [`karet`](https://github.com/karet-org/karet) repo:

```sh
npm run hash-password
```

The script reads the password from stdin (≥ 8 characters) and prints two
forms: the plain hash for shell exports and systemd units, and a
Docker-Compose-escaped form for `.env` files — compose interpolates `$`,
so every `$` in the hash must be doubled there. Paste the right one and
start the stack; the web service refuses to start without it.

There is no in-app setup form. This is deliberate: with no runtime write
path for the credential, a wiped or restored bucket can never revert the
instance to an unauthenticated "set admin password" state.

## Changing the password

Generate a new hash, replace `KARET_ADMIN_PASSWORD_HASH` in the
environment, and restart the web service:

```sh
npm run hash-password        # paste output into .env
docker compose up -d web
```

Rotating the password hash **invalidates every outstanding session** —
session cookies are signed with a key derived from both
`KARET_SESSION_SECRET` and the password hash, so a stolen cookie dies
with the old password. Rotating `KARET_SESSION_SECRET` has the same
effect.

## Sessions

The session cookie is **HMAC-signed**; the payload is
`{ exp: <unix-seconds> }`. Karet is single-admin, so possession of a
valid HMAC over a fresh `exp` is the entire authorization signal.
Sessions last 7 days.

## Login throttling

scrypt verification is deliberately expensive (~128 MiB, ~0.5 s per
attempt), so the login endpoint is throttled: each client gets a burst
of 5 attempts refilling one per 15 seconds (reset on successful login),
and at most 2 verifications run concurrently across all clients.
Throttled requests get `429` with a `Retry-After` header.

## CI / automation

There is no machine-readable HTTP API for Karet. The endpoints under
`/api/*` exist solely to back the browser UI and are not a public
contract, they require a session cookie. For automation, talk directly
to the S3 store: pipelines, dashboards, and jobs all live as JSON /
Parquet objects under `pipelines/<slug>/`.

## What's stored where

| Location | Contents |
|----------|----------|
| `KARET_ADMIN_PASSWORD_HASH` env var | scrypt hash, format `scrypt$N$r$p$<saltB64>$<hashB64>`. |
| Session cookie `karet_session` | `<base64url(payload)>.<base64url(hmacSHA256(payload))>`. HttpOnly, SameSite=Lax. |

Nothing auth-related is stored in S3. (Instances upgraded from ≤ 0.1.x
may still have a stale `_auth/admin.json` in the pipelines bucket; it is
ignored and safe to delete.)
