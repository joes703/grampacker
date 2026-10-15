# Grampacker VPS migration plan

**Status:** Planning only. Do not deploy, change production data, or change DNS
until the relevant stage is approved.

The step-by-step commands live in the companion runbook,
`docs/vps-bootstrap-and-migration-runbook.md`. This document says what and
why; the runbook says exactly how, where each command runs, and how to check
and undo it.

## Goal

Move Grampacker from Cloudflare Workers and D1 to an ordinary Linux server.
The result should be simpler to develop, test, operate, and move again later.

The application will run as one Node container using a local SQLite database.
Caddy will provide HTTPS and forward requests to the application. GitHub
Actions will build a finished image and publish it to GitHub Container
Registry (GHCR). The VPS will pull that image and run it with Docker Compose.

Nothing in the application will depend on RackNerd. Moving later should require
copying the SQLite database and configuration, pulling the same image, and
changing DNS.

## Current infrastructure (recorded 2026-10-11)

This section records the server as it exists today. Reusable commands and
configuration elsewhere use the name `VPS_HOST` instead of the address, so
they still work after a move.

| Item | Value |
| --- | --- |
| Provider | RackNerd KVM |
| Public IPv4 (`VPS_HOST`) | `104.168.43.9` |
| IPv6 | None. The only IPv6 address is link-local (`fe80::`). |
| Operating system | Ubuntu 26.04.1 LTS, kernel `7.0.0-31-generic`, x86-64 |
| Memory | 1.9 GiB RAM, 1 GiB swap |
| Disk | Root filesystem about 34 GB, about 32 GB free |
| Docker | Engine 29.9.0, Compose 5.6.0, service active |
| Administrator | `joe`, key-based SSH from the Mac and from walnut |
| SSH policy | Root login off; password and keyboard-interactive login off |
| Firewall | UFW: deny incoming, allow outgoing; SSH rate-limited; TCP 80 and TCP 443 allowed |
| Listening publicly | SSH only |

Directories that exist, all owned by `joe:joe`:

| Path | Mode |
| --- | --- |
| `/srv/grampacker` | `0755` |
| `/srv/grampacker/data` | `0700` |
| `/srv/grampacker/secrets` | `0700` |
| `/srv/grampacker/snapshots` | `0700` |

Not done yet: Caddy, the Grampacker deployment, GitHub Actions deployment, GHCR
access, and any DNS change. Cloudflare Workers and D1 remain the production
system. No sandbox or agent SSH key is installed on the VPS.

Consequences for this plan:

- **No AAAA record.** Publish only an A record until the VPS has a global IPv6
  address and it has been tested. A stale AAAA record would send IPv6 clients
  somewhere else.
- **No UDP 443.** Grampacker does not need HTTP/3. Caddy must be configured
  for HTTP/1.1 and HTTP/2 only, so it does not advertise HTTP/3 that the
  firewall would block.
- **Memory is tight but enough.** 1.9 GiB with 1 GiB swap fits one small Node
  process, Caddy and Docker. Measure before adding a memory limit (step 6).

## Verified current design

- `server/index.ts` contains one Hono application deployed as a Worker.
- The Worker serves both `/api` and the React single-page application.
- `server/db/index.ts` creates a Drizzle D1 connection per request.
- The repositories contain 33 `db.batch()` calls. D1 batches are currently the
  transaction boundary.
- The baseline schema has 18 tables, composite ownership foreign keys, partial
  unique indexes, and 22 hand-written triggers.
- Four tables exist mainly to support D1 guard and coordination behavior.
- Authentication uses Better Auth with magic links and passkeys.
- Passkeys use `grampacker.app` as the WebAuthn relying-party ID.
- Rate limiting is stored in the database. The current client address comes
  from Cloudflare's `cf-connecting-ip` header.
- There is no scheduled Worker, queue, Durable Object, or other background
  Cloudflare service to replace.
- Tests currently use workerd and `cloudflare:test` for the API tier.
- The current deployment workflow applies D1 migrations and deploys the Worker
  after changes reach `main`.

These facts should be rechecked immediately before implementation because the
repository may have changed since this plan was written.

## Target design

```text
Internet
   |
   v
Caddy on the VPS (:80 and :443)
   |
   v
Grampacker container (Node + Hono, localhost:3000)
   |
   v
/srv/grampacker/data/grampacker.db
```

Use:

- Node 24 initially if implementation begins before Node 26 LTS and dependency
  compatibility has not been verified. If implementation starts after Node 26
  becomes LTS, test Node 26 and use it directly if the existing suite passes.
- `@hono/node-server` for the HTTP server.
- `better-sqlite3` with Drizzle.
- one Hono application serving both the built React frontend and API.
- a multi-stage Docker build using a glibc-based Node image, not Alpine.
- Docker Compose on the VPS.
- Caddy on the VPS for TLS and reverse proxying. Run it as a second Compose
  service from the official `caddy:2` image, changed only by an explicit
  update that validates the configuration first, with host networking. Host networking
  lets Caddy see the real client address (Docker's port proxy can hide it)
  and reach the application on `127.0.0.1`. It also means Docker publishes no
  port for Caddy, so UFW's rules for 80 and 443 apply to it normally.
- SQLite on a host-mounted persistent directory, never inside the image.
- GitHub Actions and GHCR for production images.

The production application port binds only to `127.0.0.1`. Caddy is the only
public HTTP entry point.

## What becomes simpler

Replace each D1 batch with a real SQLite transaction. The complete read,
validation, planning, and write sequence must run inside the transaction.

After that conversion is proven, remove D1-only machinery where it no longer
protects a real application invariant:

- guard-table abort tricks used because a D1 batch cannot branch;
- pre-read drift checks needed because reads and writes occurred in separate
  D1 calls;
- D1's 100-parameter chunking where the local SQLite build and application
  request limits make it unnecessary;
- D1 invocation-limit handling;
- Wrangler, workerd, Miniflare, and Cloudflare Vite/Vitest integration;
- the Worker asset binding and Worker-specific generated types;
- Worker deployment and liveness workflows.

Keep:

- user-scoped repositories and ownership checks;
- composite ownership foreign keys;
- unique indexes;
- the 22 triggers until each is separately proven unnecessary;
- CSRF protection and authentication middleware ordering;
- request body limits;
- strict public-share response objects;
- passkey freshness rules;
- magic-link hardening and rate limiting;
- error redaction and security headers.

Do not use the migration as an excuse to redesign the relational schema or
remove security checks whose purpose is still valid.

## Access and credentials

Four separate credentials. None is reused for another purpose.

| Credential | Holder | Can do | Lifetime |
| --- | --- | --- | --- |
| Administrator SSH keys | the Mac and walnut, logging in as `joe` | full administration through `sudo` | permanent; already installed |
| Temporary provisioning key (optional) | the agent sandbox | log in as a separate temporary account, only during an approved provisioning session | removed after that session; none exists now |
| Deployment SSH key | GitHub: a `production` environment secret | run the deployment wrapper as `deploy`, nothing else | permanent; rotated if exposed |
| Read-only GHCR credential | root's Docker configuration on the VPS | pull Grampacker images | long-lived token with an expiry date and a reminder |

The coding sandbox does not need VPS access for the Node/SQLite conversion or
the container build. No agent key is created or installed now. If direct
sandbox access is ever needed, the runbook's controlled process applies: a new
dedicated key, a separate temporary account, removal afterward, and a failed
login test that proves the removal.

## Implementation sequence

### 1. Record production state

Before changing code:

- list the Worker routes and custom domains;
- record the current DNS entries for `grampacker.app` and `www`, if present;
- record the production D1 migration ledger;
- identify any Pages project, redirect rule, or old Worker route that could
  continue answering for the domain;
- check the complete history, make the repository public, then move to
  GitHub Free (runbook section 5);
- confirm the VPS distribution, SSH setup, IPv6 availability, and firewall
  (done 2026-10-11; see "Current infrastructure").

Stop automatic Worker deployment immediately before the first incompatible
Node/SQLite change reaches `main`. Do not disable it weeks in advance. This
is the deployment-safety change, merged just before the Node/SQLite branch
(runbook step 6.1, "Merge order").

### 2. Port the application to Node and local SQLite

Add the Node server and `better-sqlite3` connection. Open one database
connection for the application process and set:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

Replace the generated Worker environment type with a small application
configuration type. Add graceful handling for `SIGTERM` and `SIGINT` so the
HTTP server stops accepting requests before the database closes.

Serve the built frontend through Hono. Preserve the current cache rules,
security headers, API routing, and single-page application fallback.

Change database error handling to use `better-sqlite3` error codes instead of
assuming D1 placed the SQLite code inside the message text. Keep API behavior
such as 409 and 422 responses unchanged.

Initially provide a small compatibility helper that executes existing D1
statement arrays inside one synchronous SQLite transaction. This limits the
size of the first port. Remove that helper as repositories are converted to
clear transaction callbacks.

### 3. Replace D1-specific repository machinery

Convert one repository group at a time. For every change:

- move the full read/validate/write operation inside the transaction;
- keep genuine ownership and data-integrity checks;
- remove only concurrency defenses made unnecessary by the new transaction;
- prove unchanged API behavior with tests;
- document why a removed 409 path can no longer occur.

Suggested order:

1. packing locations and pack reordering;
2. food planning;
3. lists and list items;
4. gear, categories, and public shares;
5. rate limiting and remaining system operations.

Delete the compatibility batch helper when no caller remains.

### 4. Replace the Cloudflare test and development environment

Move API tests from workerd/D1 to Node and `better-sqlite3`. Each test file
should receive a fresh database with migrations applied. Preserve the existing
authorization and behavior assertions.

Retain:

- build and type checking;
- linting;
- unit tests;
- API tests;
- migration immutability and migration bookkeeping checks;
- action pin checks and YAML validation.

Remove Cloudflare-specific checks only after their replacement passes.

Local development should start Vite, Hono, and a disposable SQLite database
without Wrangler.

### 5. Build the production image

Create a multi-stage Dockerfile:

1. install locked dependencies and build the frontend and server;
2. install or copy only production dependencies;
3. copy the finished application and migrations into a small runtime image;
4. run as a non-root user;
5. expose only the application port;
6. include a health check that verifies both HTTP and a simple database query.

The health check passes only when `GET /api/health` returns HTTP status 200
**and** a JSON body whose `ok` property is exactly `true`, within a short
timeout. Receiving some HTTP response is not enough: the application can
answer with an error response, or with `{"ok": false}`, when its database
check fails. A missing body, a body that is not JSON, any other status, or a
timeout is unhealthy. The deployment script's own health step uses the same
rule.

The image must not contain:

- `.env` files or secrets;
- a SQLite database;
- Wrangler credentials;
- source-control credentials;
- development caches.

Build `linux/amd64`. The VPS is x86-64, and GitHub's normal Linux build
runners are too.

### 6. Prepare Compose and the VPS

Use a small production layout:

```text
/srv/grampacker/          joe:joe 0755 (exists)
  compose.yaml
  Caddyfile
  deploy.env              the app image digest to run; no secrets
  secrets/                joe:joe 0700 (exists)
    app.env               application secrets, mode 0600
  data/                   0700 (exists); owned by the image's runtime UID
  maintenance/            maintenance is on while maintenance/on exists
  rollback/               0700; one stopped copy of data/ per deploy
  caddy/data/             certificates and ACME account
  caddy/config/
```

`secrets/app.env` contains application secrets and is mode `0600`.
`deploy.env` contains the exact application image digest to run.
`data/` must be writable by the container's non-root user, so it is owned
by that user's numeric UID, whatever `joe`'s UID is. The files themselves
are in `deploy/` in the repository.

The Compose service should:

- use the finished GHCR image;
- bind `127.0.0.1:3000:3000`;
- mount `/srv/grampacker/data` at the database directory;
- run as the image's non-root user;
- restart unless stopped;
- use bounded local log rotation;
- wait on the image health check.

Do not impose a guessed 512 MB memory limit. Measure ordinary and peak use on
the 2 GB VPS first. Add a limit later only if it protects the host without
causing avoidable out-of-memory failures.

Allow only the required public ports: SSH, HTTP, and HTTPS (TCP only). Prefer
Tailscale or a restricted source range for administration if convenient, but
do not make that a requirement for the application design.

**Docker-published ports bypass UFW.** Docker writes its own packet-filter
rules, and they are evaluated before UFW's. A Compose line such as
`"3000:3000"` would make the application reachable from the internet even
though UFW has no rule allowing 3000. Every published port must therefore
name `127.0.0.1` explicitly, and the runbook proves this from another machine
rather than by reading `ufw status`.

### 7. Configure Caddy

Caddy should:

- obtain and renew the certificate for `grampacker.app`;
- redirect HTTP to HTTPS;
- proxy to `127.0.0.1:3000`;
- pass the real client address in a header accepted only from the local proxy;
- serve HTTP/1.1 and HTTP/2 only (UDP 443 is closed on purpose);
- return a simple 503 maintenance response while a deployment is changing the
  database.

The maintenance response is a requirement, not a design. How Caddy switches it
on and off is designed and tested together with the real Compose files during
implementation. Whatever the mechanism, it must: answer every request with 503
while on, including `/api/*`; not depend on the application container running;
survive a Caddy restart in the state it was left in; and be provable with one
`curl` from outside the VPS.

The application must stop trusting `cf-connecting-ip`. It reads the LAST
`X-Forwarded-For` entry: Caddy writes that entry from the connection itself
and, with no `trusted_proxies` configured, discards what the client sent.
Other headers such as `X-Real-IP` pass through Caddy unchanged unless the
config overwrites them, so they are not trusted. The header is trusted only
because the application port is reachable solely from localhost.

Use a temporary DNS-only `staging.grampacker.app` record to verify Caddy and
the container before production cutover.

For staging:

- set `BETTER_AUTH_URL=https://staging.grampacker.app`;
- keep the passkey RP ID as `grampacker.app`;
- explicitly allow the staging origin in Better Auth;
- confirm magic links and an existing passkey both work.

Production uses `BETTER_AUTH_URL=https://grampacker.app`.

Today `BETTER_AUTH_URL` is Better Auth's `baseURL`, the passkey origin, and the
origin the CSRF middleware compares against, and `passkeyRpId` maps any
`*.grampacker.app` URL to the RP ID `grampacker.app`. Setting the staging URL
may therefore be all the "allow" needs. Confirm that against the code at
implementation time instead of adding a second trusted origin by habit.

Staging uses its own `BETTER_AUTH_SECRET`, different from the production
secret, so a staging cookie can never be valid in production. Testing an existing passkey
needs a copy of production users and passkeys on staging, so loading that copy
is a production-data operation: it needs explicit approval, the copy is
protected like production, and it is deleted when staging is removed. Remove
the staging DNS record and Caddy site after cutover.

### 8. Add GitHub image builds

**Publishing is built** (`.github/workflows/image.yml`; the procedure is
runbook step 6.1). On a pull request it builds the image and runs
`scripts/check-image.sh`, and publishes nothing. Started by hand on `main`,
it:

1. checks out the dispatched `main` commit;
2. runs the build, unit, API and migration checks on that commit itself,
   instead of asking the API whether `ci.yml` passed: the workflow is
   self-contained and needs no `actions: read`;
3. builds a `linux/amd64` image and runs `scripts/check-image.sh` on it;
4. tags it with the full Git commit, and refuses if that tag already exists;
5. pushes it to GHCR with the run's `GITHUB_TOKEN` (`packages: write`);
6. reads it back by digest, checks it is the tested linux/amd64 image, and
   prints the digest in the log and run summary.

The publish never replaces a tag because a rebuild of the same commit is not
byte-identical: overwriting would let one commit name two images. The check
runs just before the push and is not atomic, so it guards against a rerun,
not against another writer pushing at the same moment. GHCR
keeps the tag and its digest; the deploy history on the VPS will record
which digest ran. The publish has no push trigger yet: each one is started
by hand until the deployment exists.

Merging this branch must not reach the Worker. A separate change, merged to
`main` first, makes `deploy.yml` legacy: every job in it is `if: false`, so
the Worker keeps serving its last deployed commit as the rollback target.
The merge order and how to confirm that nothing deployed are in runbook
step 6.1.

**Built:** the deploy step, the job "Deploy to the VPS" in `image.yml`. A
dispatch with its `deploy` input set deploys the digest that run's publish
job pushed, over SSH as a `deploy` account whose key can only run
`grampacker-deploy deploy <digest>` (runbook section 8).

Do not require GitHub Releases. Do not deploy `latest` without also recording
the immutable digest or commit tag.

The repository becomes public and the account moves to GitHub Free, which
offers environments on public repositories. The SSH key is a secret of a
`production` environment whose deployment-branch rule allows `main` alone,
so GitHub itself refuses the environment, and its secrets, to a run from any
other branch. Make the repository public, after checking its complete
history for secrets and data, before cancelling Pro (runbook section 5).

The VPS also limits the key with a forced command (below), so even a
leaked key can only deploy an image digest.

The VPS uses a read-only GHCR credential. It may prune unused images from its
local Docker storage, but it must not be able to delete images from GHCR.
Registry retention can be handled separately if it ever becomes necessary.

The deployment SSH key logs in as a dedicated `deploy` account, not as `joe`.
Its `authorized_keys` entry forces one command: a root-owned wrapper that
accepts only an image digest and runs the deployment script. The key cannot
open a shell, forward ports or run anything else. The workflow verifies the
VPS host key against a pinned value and never accepts an unknown one.

The current `deploy.yml` forbids `workflow_dispatch` because a dispatch runs
the chosen branch's copy of the workflow with repository secrets, and its
Cloudflare token can do anything to production. The new workflow reverses
that rule deliberately, for the reasons above: the deploy key's power is
limited on the VPS side, and the `production` environment refuses the key to
any branch but `main` on the GitHub side. `deploy.yml` keeps its own rule
against `workflow_dispatch`: its header speaks only of its Cloudflare token,
so it needs no change.

`image.yml` carries `workflow_dispatch` and, in its deploy job, the deploy
key: the one exception to the rule in `docs/testing-and-ci.md` section 10,
recorded in `SECURITY.md`. Its token can also push images: a branch that edited the file
and was dispatched could push an image to GHCR under any tag. The same
GitHub-side limit on who can edit or dispatch workflows covers that, and it
is why a deployment takes a digest printed by a run on `main`, never a tag
(`SECURITY.md`).

### 9. Keep routine deployment simple

The deployment script (`deploy/grampacker-deploy`) is short and readable.
A deploy, under one lock:

1. turns maintenance on;
2. stops the application, so nothing can write to SQLite;
3. copies the complete data directory, including any database, WAL and SHM
   files, to a timestamped rollback directory, with the previous image
   digest in a text file beside it;
4. runs migrations with the new image;
5. starts it and verifies health and the homepage;
6. turns maintenance off only after verification succeeds.

If a step fails, maintenance stays on and the script prints the rollback
directory. A rollback stops the app, keeps the failed data directory,
restores the saved directory, starts the previous digest and verifies
health. The rollback directory is only the immediate way back from one
deploy; Kopia remains responsible for long-term backups.

Do not build an automatic disaster-recovery state machine. Before public
traffic reopens, restoring the copy and previous image is safe because no
new writes were accepted. After traffic reopens, database restoration is a
manual decision because it would discard subsequent writes.

Automate routine deployment. Document rare recovery.

## D1-to-SQLite data migration

Treat this one-time move more cautiously than ordinary deployments.

### Export

After production writes are frozen:

1. record the D1 Time Travel bookmark;
2. create one full schema-and-data export as the untouched archive;
3. create the data export used for import;
4. record the D1 migration ledger;
5. record all application schema objects;
6. record row counts for every table;
7. hash and copy the archive somewhere outside the VPS.

Rehearse this before cutover. Do not first discover the export format during
the production maintenance window.

### Import

Use the same production image and SQLite library that will run Grampacker.

1. Create an empty reference database by applying the Drizzle migrations.
2. Compare D1 and reference schemas structurally: columns and order, types,
   nullability, defaults, primary keys, foreign keys, indexes, and triggers.
3. Normalize harmless quoting and whitespace before comparing trigger and
   index SQL. Do not require raw `sqlite_master.sql` strings to be byte-for-byte
   identical when the structural comparison proves the same schema.
4. Create the target database with the normal migration runner so its Drizzle
   migration ledger is correct.
5. Temporarily remove triggers that would reject valid data solely because of
   export insertion order.
6. Disable foreign-key checking outside the import transaction.
7. Inspect the export for its own `BEGIN` and `COMMIT`. Use its transaction if
   present; otherwise add one. Never nest transactions blindly.
8. Load the data and discard the D1-specific migration ledger. Before
   reporting success, checkpoint, close every connection, and leave one
   self-contained file with no `-wal` or `-shm` beside it, so promoting it is
   a plain rename.
9. Recreate the triggers and enable foreign keys.
10. Require `PRAGMA integrity_check` to return `ok` and
    `PRAGMA foreign_key_check` to return no rows.
11. Check application invariants that triggers do not retroactively test,
    including ownership, same-list relationships, container cycles, rank
    ranges, and row caps.
12. Compare every table's row count with the export.
13. Preserve users, accounts, passkeys, lists, gear, food, and shares.
14. Delete transient sessions, verification challenges, and rate-limit rows.
15. Verify passkey credential IDs, public keys, user IDs, and counters were
    copied without transformation.
16. Exercise representative accounts and lists through the staging API.

Do at least two rehearsals. Record how long export, import, validation, and
certificate issuance take.

## Authentication continuity

Keep unchanged:

- production hostname `grampacker.app`;
- WebAuthn RP ID `grampacker.app`;
- production origin `https://grampacker.app`;
- HTTPS;
- user IDs;
- passkey credential IDs, public keys, and counters.

Keep the existing production `BETTER_AUTH_SECRET` during the move. Rotating it
is a separate future operation, not part of this migration. Cloudflare cannot
show a Worker secret after it is set, so the VPS needs the value from the
password-manager copy. If no copy exists, stop: the move then forces a
rotation, and that needs its own decision.

Still delete imported sessions and short-lived verification challenges, so
everyone signs in once on the new server. That is one statement in the import
and avoids carrying sessions across a change of server.

Magic-link sign-in remains the recovery path if a passkey test fails. Do not
complete cutover until at least one existing passkey works against the staging
copy with the correct staging origin.

## DNS cutover

Cloudflare may remain the authoritative DNS provider, but the production A
record should be DNS-only. The application should no longer depend on the
Cloudflare proxy or Tunnel.

During the maintenance window:

1. prevent new writes to D1 by removing the Worker's production custom domain;
2. verify no alternate Worker hostname can accept production writes. The
   `workers.dev` URL refuses browser writes because the CSRF middleware checks
   `Origin`, but a non-browser client can send any `Origin` header, so disable
   the `workers.dev` route and preview URLs rather than relying on that;
3. take the final D1 export;
4. import and validate SQLite;
5. start the application locally on the VPS and test with an explicit Host
   header;
6. create the DNS-only A record for the VPS. Create no AAAA record: the VPS
   has no global IPv6 address. Confirm that no AAAA record for the name is
   left over from the Worker;
7. wait for Caddy to obtain the production certificate;
8. test HTTPS, headers, cookies, API routes, deep links, static assets, magic
   links, passkeys, private data, and public shares;
9. begin accepting real writes only after those checks pass.

This includes planned downtime. DNS caches and ACME validation may make it last
several minutes. Do not promise certificate issuance "within seconds."

## Rollback

Before the first real SQLite write, rollback is straightforward:

- remove the VPS DNS record;
- restore the Worker custom domain;
- treat D1 as authoritative;
- discard the rehearsal or failed SQLite import.

Do not re-enable `deploy.yml` as part of that rollback once `main` contains
Node/SQLite code: it would deploy code the Worker cannot run. For the same
reason, never re-run an earlier Deploy run: a re-run uses that run's old copy
of the workflow, which still deploys, and can deploy `main` as it is now. The
Worker keeps serving its last deployed version, which is what rollback needs.

After SQLite accepts real writes, D1 is stale. Prefer fixing forward or running
the previous container image. Returning to D1 would lose or require manually
copying those new writes.

For later deployments:

- application rollback means running the previous image;
- database rollback means restoring the deploy's rollback directory;
- restoring it after reopening public traffic loses later writes and
  therefore always requires a deliberate operator decision.

Keep migrations backward-compatible with the previous image whenever
practical.

## Acceptance checks

The migration is ready for production only when:

- local Node development works without Wrangler;
- unit and Node API tests pass with their existing behavior assertions;
- all D1 batches have become real SQLite transactions;
- the production image builds and contains no database or secrets;
- Compose preserves the database when the container is replaced;
- the application port is unreachable from another machine;
- staging works through Caddy with a valid certificate;
- magic-link sign-in and an existing passkey work on staging;
- two D1 import rehearsals pass every integrity, relationship, and row-count
  check;
- a manually started GitHub workflow publishes and deploys an immutable image;
- the rollback-directory and previous-image recovery has been tested (the
  empty-database rehearsal, runbook 7.4);
- the existing B2 backup copies a backup-API snapshot of the database, and one
  has been restored from B2 and passed `integrity_check`;
- final DNS, HTTPS, cookie, security-header, private-data, and public-share
  checks pass.

## After cutover

Observe the VPS for at least two weeks. Monitor:

- `/api/health` from outside the VPS;
- disk and memory use;
- application restarts and errors;
- certificate renewal;
- backup arrival and restore tests;
- SQLite integrity and foreign keys;
- accumulation of local Docker images.

Continue encrypted Kopia backups to B2. Back up a SQLite snapshot made through
SQLite's backup API, not an arbitrary copy of the live database and WAL files.

After the observation period:

- remove obsolete Worker deployment code and secrets;
- remove Wrangler and Cloudflare-only development dependencies;
- replace the D1 restore document with the SQLite restore procedure;
- archive a final D1 export;
- keep the D1 database until its deletion is separately and explicitly
  approved.

Routine maintenance afterward is ordinary Linux administration: operating
system and Docker updates, dependency updates, backup verification, occasional
restore tests, certificate monitoring, Caddy updates, and deleting old
rollback directories and unused images.
