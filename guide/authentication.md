# Authentication and roles

Karet has **named accounts** with three roles. There is a bootstrap admin in
the environment, and team accounts in the pipelines bucket.

## The bootstrap admin

The operator's credential is an **scrypt hash in the environment**
(`KARET_ADMIN_PASSWORD_HASH`), not a record in storage, so a wiped or restored
bucket can neither lock you out nor revert the instance to an unauthenticated
"set a password" state. Its username is `KARET_ADMIN_USERNAME`, defaulting to
`admin`.

Generate the hash from a checkout of the
[`karet`](https://github.com/karet-org/karet) repo:

```sh
npm run hash-password
```

The script reads the password from stdin (≥ 8 characters) and prints two forms:
the plain hash for shell exports and systemd units, and an escaped form for
Docker Compose `.env` files. Compose interpolates `$`, so every `$` in the hash
must be doubled there. Paste the right one and start the stack; the web service
refuses to start without it.

A stored account cannot shadow this one: if the user store contains an account
with the same username, the env credential wins, so editing the bucket cannot
demote the operator or replace their password.

## Team accounts

Everyone else lives in `_auth/users.json` in the pipelines bucket, managed with
a script rather than a signup form:

```sh
node scripts/manage-users.mjs list
node scripts/manage-users.mjs add erin editor      # password read from stdin
node scripts/manage-users.mjs set-role erin admin
node scripts/manage-users.mjs set-password erin
node scripts/manage-users.mjs remove erin
```

A missing, unreadable or malformed store means "no team accounts", never "let
anyone in", and an entry whose role is not one of the three is ignored rather
than trusted.

## Roles

| Role | Can |
|------|-----|
| `viewer` | read everything: pipelines, dashboards, jobs, table data; run read-only SQL; validate a draft config |
| `editor` | all of the above, plus edit configs and dashboards, save queries, upload to the lake, trigger runs, create and import pipelines, restore a config or table version |
| `admin` | all of the above, plus delete or rename a pipeline and change instance settings |

Read-only POSTs are viewer work on purpose: running a `SELECT`, drawing a
dashboard panel and validating a draft write nothing.

Authorization is decided by one table (`lib/auth/policy.ts`) consulted twice:
edge middleware refuses a request whose signed role is too low, and the route
handler re-resolves the caller against the user store, where a demotion or a
deletion is visible. A test walks every route file and fails if a handler is
exported without that guard.

## Sessions

The session cookie is **HMAC-signed** and carries `{ sub, role, cv, exp }`:
the username, their role, and a fingerprint of their credential. Sessions last
7 days.

`cv` is what makes revocation immediate. Changing a password or a role changes
that user's fingerprint, so their outstanding sessions stop verifying on the
next request — without signing anybody else out. Deleting an account has the
same effect. Rotating `KARET_SESSION_SECRET` invalidates every session at once.

## Automation and CI

Machine callers present the shared worker token instead of a cookie:

```sh
curl -X POST -H "Authorization: Bearer $KARET_WORKER_TOKEN" \
  https://karet.example/api/p/<slug>/jobs
```

That grants an admin-equivalent `service` principal, and writes it performs are
attributed to `service` in the config history. The token already authorizes the
worker's own API, so this is not a separate privilege to manage.

## Login throttling

scrypt verification costs ~128 MiB and ~0.5 s per attempt, so the login
endpoint is throttled: each client gets a burst of 5 attempts refilling one per
15 seconds (reset on successful login), and at most 2 verifications run
concurrently across all clients. Throttled requests get `429` with a
`Retry-After` header.

## What's stored where

| Location | Contents |
|----------|----------|
| `KARET_ADMIN_PASSWORD_HASH` env var | scrypt hash of the bootstrap admin's password, `scrypt$N$r$p$<saltB64>$<hashB64>` |
| `KARET_ADMIN_USERNAME` env var | that account's username; defaults to `admin` |
| `KARET_SESSION_SECRET` env var | session signing key |
| `KARET_WORKER_TOKEN` env var | shared token for machine callers |
| `_auth/users.json` in the pipelines bucket | team accounts: username, role, scrypt hash |
| Session cookie `karet_session` | `<base64url(claims)>.<base64url(hmacSHA256(claims))>`, HttpOnly, SameSite=Lax |

Passwords are never stored in plaintext, and the bucket never holds a
credential that could grant access on its own: without `KARET_SESSION_SECRET`
no session can be signed.
