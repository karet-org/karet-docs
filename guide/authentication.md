# Authentication

Karet is **single-admin** and **password-only**. There's one admin
password; anyone who knows it has full access.

## First-run setup

The first time you visit `/login`, the page asks `/api/auth/setup` whether
an admin has been provisioned. If not, you get a one-time **Set admin
password** form. Submitting it:

1. Hashes the password with **scrypt** at OWASP-recommended cost (`N=2¹⁷,
   r=8, p=1`).
2. Writes `_auth/admin.json` to S3 with `{ version, password_hash,
   created_at }`.
3. Issues a session cookie and redirects you to the home page.

The setup endpoint refuses if an admin already exists. A network
attacker who finds it open can't use it to seed a backdoor account.

## Sessions

The session cookie is **HMAC-signed** with `KARET_SESSION_SECRET`. The
payload is `{ exp: <unix-seconds> }` -- Karet is single-admin, so
possession of a valid HMAC over a fresh `exp` is the entire authorization
signal. Sessions last 7 days.

Rotate the secret to invalidate every session:

```sh
sed -i '' 's/^KARET_SESSION_SECRET=.*/KARET_SESSION_SECRET=$(openssl rand -base64 48)/' .env
docker compose up -d --force-recreate web
```

## Changing the password

Click **Account** in the top nav. The modal asks for your current password,
a new one (≥ 8 characters), and a confirmation. On success, the session
cookie is re-issued so you don't get logged out.

The endpoint runs `verifyPassword` against the stored hash even when the
account file is missing or unreadable, so timing doesn't leak whether
an admin exists.

## CI / automation

There is no machine-readable HTTP API for Karet. The endpoints under
`/api/*` exist solely to back the browser UI and are not a public
contract -- they require a session cookie. For automation, talk
directly to the S3 store: pipelines, dashboards, and jobs all live as
JSON / Parquet objects under `pipelines/<slug>/`. The
[`karet-skills`](https://github.com/karet-org/karet/tree/main/src/karet-skills)
package shows the layout.

## What's stored where

| Path | Contents |
|------|----------|
| `_auth/admin.json` | The admin record: scrypt hash + created-at timestamp. |
| Session cookie `karet_session` | `<base64url(payload)>.<base64url(hmacSHA256(payload))>`. HttpOnly, SameSite=Lax. |
