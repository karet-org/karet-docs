# Authentication and roles

Karet has **named accounts** with three roles, and a role can be narrowed or
widened for a single pipeline. There is a bootstrap admin in the environment, and
team accounts in Postgres.

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

A stored account cannot shadow this one: the credential is re-asserted from the
environment on every start, so editing the database cannot demote the operator or
replace their password.

## Team accounts

Everyone else is a row in Postgres. There is no signup form: an admin does this on
**Settings → People**, which lists who exists, adds an account from a username,
password and role, changes a role, resets a password, and deletes an account. There
can be as many admins as you like, and a team of any size wants at least two, since
nobody can change their own role.

Two things that screen will not do, because they would undo themselves or lock you
out mid-request:

- The bootstrap admin cannot be deleted, demoted, or given a new password here. The
  environment sets its role and password on every start, so the change would appear
  to work and then revert. Retire it by changing `KARET_ADMIN_USERNAME`.
- You cannot change your own role or delete your own account. Ask another admin.
  Resetting your own password is allowed, and signs you out.

Changes take effect on the next request, not whenever a cookie expires. The role is
read from the account row rather than from the session, and better-auth's session
cookie cache is off, so a demotion, a reset or a deletion is effective at once at
the cost of one indexed lookup per request.

A reset sets a password and ends that account's sessions. Karet sends no mail, so
there is no self-service "forgot password": an admin sets a new one and tells them.

Deleting an account ends its sessions and drops its per-pipeline grants. Pipelines
it owned stay, without an owner, and any admin can hand them on; the confirmation
names them so nobody deletes a colleague and wonders where the work went.

### From a terminal

`scripts/manage-users.mjs` does the same things for an operator who is already at a
shell, and it is the way back in if every admin account is lost, since the bootstrap
admin comes from the environment:

```sh
node scripts/manage-users.mjs list
node scripts/manage-users.mjs add erin editor      # password read from stdin
node scripts/manage-users.mjs set-role erin admin
node scripts/manage-users.mjs set-password erin
node scripts/manage-users.mjs remove erin
```

If you are coming from a pre-Postgres instance, a one-off
`node scripts/manage-users.mjs import-s3` brings accounts over from the old
`_auth/users.json`.

## Roles

| Role | Can |
|------|-----|
| `viewer` | read everything: pipelines, dashboards, jobs, table data; run read-only SQL; validate a draft config |
| `editor` | all of the above, plus edit configs and dashboards, save queries, upload to the lake, trigger runs, create and import pipelines, restore a config or table version |
| `admin` | all of the above, plus delete or rename a pipeline, manage who may use it, and change instance settings |

Read-only POSTs are viewer work on purpose: running a `SELECT`, drawing a
dashboard panel and validating a draft write nothing.

Authorization is decided by one table (`lib/auth/policy.ts`) consulted twice:
edge middleware refuses a request with no session, and the route handler resolves
the caller *against the pipeline they are addressing*, where a demotion, a
deletion or a membership is visible. Resolving against rows is why this cannot
live in middleware: the edge cannot read the database. A test walks every route
file and fails if a handler is exported without that guard.

## Sessions

Sessions are **rows in Postgres**, issued by
[better-auth](https://better-auth.com), and the cookie is a reference to one.
Deleting a row signs that session out on its next request, which is the reason
sessions live in the database rather than in a self-contained signed cookie: a
stateless cookie can only be expired, never revoked. Sessions last 7 days.

Changing a password or a role, or deleting an account, deletes that account's
session rows and nobody else's. Rotating `KARET_SESSION_SECRET` invalidates every
session at once.

## Per-pipeline access

Roles above are instance-wide, which is the right default for a small team
sharing everything and the wrong one as soon as a pipeline exists that some of
those people should not read. Two things narrow it.

**Visibility.** A pipeline is either `instance`, meaning everyone signed in sees
it at their own role, or `members`, meaning it is hidden from everyone except the
people listed on it. **New pipelines are `members`**: a pipeline usually holds
somebody's data before its author has decided who should see it, so access is
granted rather than assumed. Existing pipelines were left as they were when this
arrived.

**Grants.** A membership row replaces a person's instance role for one pipeline,
and it can widen (a viewer who edits one pipeline) or narrow (an editor who may
only read this one).

### Owners

Whoever creates a pipeline owns it, recorded as `pipelines.owner_id`, and an
owner is admin on their own pipeline whatever the member list says. That is why
access does not come from a grant: a list that can lock a person out of the thing
they built is a way to lose it. `created_by` stays beside it as a record of who
made the pipeline, while `owner_id` answers who has it now.

Ownership can be handed over, which is what keeps permanent access from meaning
forever. Transferring is the owner's decision or an instance admin's, not merely
an admin-on-this-pipeline decision, since otherwise an editor granted admin on
one pipeline could take ownership and make their own access permanent. Only the
owner changes: no grant is written for the new owner, and the previous owner's
grant, if they have one, becomes ordinary and revocable rather than vanishing
under them. Deleting an account leaves its pipelines ownerless rather than
guessing an heir, and an instance admin picks who takes them.

Attempting to remove the owner from the member list, or to set them below admin,
returns `422 owner_access_is_permanent` rather than appearing to work.

### How a role is resolved

For a given person and pipeline, in order:

1. An **instance admin** is admin everywhere. An access list that can lock the
   operator out is a way to lose a pipeline.
2. The **owner** is admin on that pipeline.
3. A **membership row**, if there is one. It is the more specific statement, so it
   wins over the instance role in both directions.
4. Otherwise the **instance role**, unless the pipeline is `members` only, in
   which case there is no access at all.

The service token is admin-equivalent and holds no membership.

A person with no access gets **404, not 403**: telling someone a pipeline exists
but is not for them leaks its existence, and they cannot act on the information
either way. The pipeline also does not appear in their list.

Who may use a pipeline is an admin decision *about that pipeline*, so the
**Access** page and the `members` endpoints need admin there. An editor can
change what a pipeline does without changing who else can reach it.

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
| Postgres `user`, `account` | team accounts: username, role, scrypt hash |
| Postgres `session` | live sessions; deleting a row signs it out |
| Postgres `pipelines.visibility`, `pipelines.owner_id`, `pipeline_members` | who may use each pipeline |
| Session cookie | a reference to a `session` row, HttpOnly, SameSite=Lax |

Passwords are never stored in plaintext, and no S3 bucket holds a credential:
accounts moved out of the pipelines bucket when the control plane moved to
Postgres.
