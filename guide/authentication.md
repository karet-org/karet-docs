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
payload is `{ u: "", exp: <unix-seconds> }`. Karet doesn't need a
username, but the field is kept so older multi-user cookies still
validate. Sessions last 7 days.

Rotate the secret to invalidate every session:

```sh
sed -i '' 's/^KARET_SESSION_SECRET=.*/KARET_SESSION_SECRET=$(openssl rand -base64 48)/' .env
finch compose up -d --force-recreate web
```

## Changing the password

Click **Account** in the top nav. The modal asks for your current password,
a new one (≥ 8 characters), and a confirmation. On success, the session
cookie is re-issued so you don't get logged out.

The endpoint runs `verifyPassword` against the stored hash even when the
account file is missing or unreadable, so timing doesn't leak whether
an admin exists.

## CI / automation: API keys

If you have a script that needs to call `/api/*` without going through
the cookie flow, set `KARET_API_KEY` to a shared secret:

```sh
echo "KARET_API_KEY=$(openssl rand -hex 32)" >> .env
```

The middleware accepts requests bearing the matching value in either
`X-API-Key` or `Authorization: Bearer <key>`. Empty disables the feature.

## Migration from the old multi-user shape

Older Karet installs wrote `_auth/users.json` with an array of users.
On the next auth-touching request, the new code:

1. Reads the legacy file.
2. Takes the first user's `password_hash` and `created_at`.
3. Writes them to `_auth/admin.json`.
4. Returns the migrated record.

The legacy file is left in place. Delete it manually once you've
confirmed the migration succeeded.

## What's stored where

| Path | Contents |
|------|----------|
| `_auth/admin.json` | The admin record: scrypt hash + created-at timestamp. |
| `_auth/users.json` | Legacy file from the multi-user era. Read once on migration; safe to delete after. |
| Session cookie `karet_session` | `<base64url(payload)>.<base64url(hmacSHA256(payload))>`. HttpOnly, SameSite=Lax. |
