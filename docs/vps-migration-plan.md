# Migration plan: Cloudflare Workers + D1 to Node + SQLite on a VPS

**Status: draft plan, not implemented.** Dated 2026-10-10. Once it ships this
becomes a dated record (AGENTS.md "Documents and rules").

Legend: **[V]** verified in the repo or official docs. **[R]** recommendation.
**[A]** assumption to confirm. **[U]** could not be verified.

## 1. Current architecture (verified)

- **Entry:** `server/index.ts` is one Hono app deployed as a Worker
  (`wrangler.jsonc`). Middleware order: `securityHeaders` -> `assetCache` ->
  `/api` (`apiBodyLimit` -> `csrfProtection` -> `authRateLimit` on `/auth/*` ->
  better-auth handler -> `requireSession` on `/lists/*` -> routes). Everything
  else is the SPA via `c.env.ASSETS.fetch` (`run_worker_first: true` so headers
  cover every response; `not_found_handling: single-page-application`).
- **DB:** `server/db/index.ts` is `drizzle(d1)`, built per request
  (`createDb(c.env.DB)`), as is auth (`createAuth(c.env)` in `server/auth.ts`).
  **33 `db.batch()` sites** across 8 repos are the only transactions.
  `migrations/0000_baseline.sql`: 18 tables (4 transient guard/state tables),
  composite same-owner FKs, partial unique indexes, **23 hand-written
  triggers** (caps, same-list, cycle, rank range, rerank). The production
  ledger is `d1_migrations`; the baseline name was inserted by hand
  (`docs/incidents.md`).
- **Auth:** better-auth 1.7.7, passwordless: magic link (Resend HTTP API) plus
  `@better-auth/passkey`. `passkeyRpId()` maps any `*.grampacker.app` to RP ID
  `grampacker.app`; passkey `origin` is `BETTER_AUTH_URL`. Cookies
  `sameSite: 'strict'`; 30-day sliding sessions; `freshAge` gate. better-auth's
  own rate limiter is off; `server/middleware/rate-limit.ts` keeps buckets in
  `rate_limits`.
- **Client IP:** `authRateLimit` reads `cf-connecting-ip` into
  `rateLimitIpKey()` (IPv6 /64 grouping). That header is meaningful only behind
  Cloudflare.
- **Error mapping:** `server/repos/db-errors.ts` classifies errors (409/422 vs
  500) by finding `SQLITE_CONSTRAINT...` **inside the message text**. D1 embeds
  it; better-sqlite3 puts it in `err.code` instead.
- **No scheduled work:** no cron triggers, no `waitUntil`, no queues. Expired
  `verification` rows are swept opportunistically inside the limiter.
- **CI/CD:** `ci.yml` (build, unit, API tests on workerd, migration checks,
  action pins, yamllint). `deploy.yml` (350 lines, `workflow_run`, in-lock CI
  re-verify, `wrangler d1 migrations apply --remote`, `wrangler deploy`,
  deployment marker). `deploy-liveness.yml` plus `scripts/deployed-sha.mjs`.
- **Other Cloudflare coupling:** CSP allows the Web Analytics beacon
  (`security-headers.ts`); the Worker also answers on `*.workers.dev` (SECURITY.md
  "TWO public origins"); `vite.config.ts` uses `@cloudflare/vite-plugin`;
  `vitest.workers.config.ts` plus about 20 test files use `cloudflare:test`;
  `server/auth-schema.config.ts` refers to `D1Database`.
- **Docs this reverses:** README.md says portability to Node + SQLite "is no
  longer one", and so does `server/db/index.ts`. This plan reverses that on
  purpose, so those binding docs change with it.
- **Groundwork already written:** `docs/incidents.md` "If this ever moves off D1"
  lists the required pragmas (`foreign_keys=ON`, `busy_timeout`, WAL,
  `synchronous=NORMAL`).

## 2. Target architecture [R]

```
Internet -> Caddy (host network, :80/:443, ACME) -> 127.0.0.1:3000 -> app container (Node 24, @hono/node-server)
                                                                     |- same Hono app; serves dist/client via serveStatic
                                                                     '- better-sqlite3 -> /srv/grampacker/data/grampacker.db (WAL)
```

- **One app container serves both API and SPA.** The header and cache
  middleware are tested to cover every response (`security-headers.test.ts`,
  `asset-cache.test.ts`). Keeping one Hono app keeps that guarantee without
  copying the header map into Caddy. Caddy does TLS, proxying, a body ceiling
  and compression only.
- **Node 24** (matches `.nvmrc`). Node 24 enters maintenance 2026-10-20 and
  Node 26 becomes LTS 2026-10-28 [V]; upgrade in its own PR later.
- **better-sqlite3 13.x** [V]: prebuilt linux-x64 glibc binaries inside the npm
  tarball and **no install script**, so `.npmrc` `ignore-scripts` can stay
  (confirm with a clean `npm ci` plus build). Drizzle 0.45 has no `node:sqlite`
  driver [V], and drizzle is pinned by better-auth's peer range.
- **Base image `node:24-bookworm-slim`**, pinned by digest: glibc matches the
  prebuilt binary. No Alpine.
- **Hostname unchanged:** `https://grampacker.app`.
- **Cloudflare DNS record DNS-only (grey cloud).** Reasons: Caddy gets its own
  certificate without workarounds; Caddy's `{remote_host}` is the real client IP,
  which the rate limiter needs; and the setup is the same on any host or DNS
  provider. Cost: no Cloudflare proxy/DDoS shield and no analytics beacon.
  Acceptable for this app.

## 3. Complexity that can be removed

**Required changes for the move:**

| Item | Today | After |
|---|---|---|
| `db.batch` (33 sites) | Only way to get a transaction | `db.transaction(tx => ...)`, synchronous on better-sqlite3 [V] |
| Error matchers (`db-errors.ts`) | `SQLITE_CONSTRAINT_*` in message | Match on `err.code` for the class; keep message match for table.column. **If missed, every 409 silently becomes a 500.** |
| Client IP | `cf-connecting-ip` | `x-real-ip`, set by Caddy from `{remote_host}`; app port loopback-only. Also set better-auth `advanced.ipAddress.ipAddressHeaders: ['x-real-ip']` [V option] |
| Pragmas | Applied by D1 | Set on every connection: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000` |
| Migrations | `wrangler d1 migrations apply`, `d1_migrations` | `migrate()` from `drizzle-orm/better-sqlite3/migrator`; ledger `__drizzle_migrations`; all pending in one BEGIN/COMMIT [V] |
| SPA serving | `ASSETS` binding | `serveStatic` from `@hono/node-server/serve-static`, plus `index.html` fallback for non-`/api` GETs |
| Dev | `@cloudflare/vite-plugin` | `@hono/vite-dev-server` keeps a single `npm run dev`; local DB in `.data/` (gitignored) |
| Test tier | workerd + `cloudflare:test` | Node vitest; per-file fresh in-memory DB with migrations applied; `app.request(path, init, env)` keeps working |

**D1 workarounds removable once real transactions exist** (each its own PR):

- **Guard-table aborts.** `_pack_reorder_guard` and `_food_pack_reorder_guard`
  (`app-schema.ts:530`) exist because "a D1 batch cannot branch". Inside a
  transaction you read, count and `throw`. That removes the census statements in
  `packing-locations.ts:450-470`, `isPackGuardViolation`, and the
  NULL-into-NOT-NULL trick. Leave the empty tables in the schema for now:
  dropping them needs `DROP TABLE`, which the rules forbid. The rule's reason
  (cascades during rebuilds) does not apply to these childless tables, so revise
  the rule explicitly when you want them gone.
- **Pre-read drift detection.** Pre-read, plan, then write with conditional
  `WHERE ... pack_sort_order = <pre-read>` and `isPackRankNotNullViolation`
  ("rounds 6-8" comments). This exists because reads and writes were separate
  D1 calls. With `transaction(..., { behavior: 'immediate' })` the read happens
  under the write lock, and one synchronous better-sqlite3 connection cannot
  interleave requests inside a transaction, so most concurrency-only 409 paths
  disappear. **Keep:** the unique cohort indexes (real invariant), the
  two-phase park/settle (SQLite checks uniqueness per statement on any host),
  all triggers, the ownership prechecks, and the payload validation
  (cross-cohort and untouched-rank checks, `server/repos/pack-reorder.ts:245`).
  This holds only if the **whole** read, validate, plan and write sequence
  moves inside one synchronous immediate transaction. A pre-read outside the
  transaction would bring the race back.
- **100-parameter chunking** (`server/repos/chunk-ids.ts`, chunked rank
  writes). Local SQLite allows far more bound parameters; confirm the bundled
  limit with `select sqlite_version()` plus a test at the largest payload cap
  (500). Keep "owned-set membership in JS" (ownership invariant).
- **Platform notes that become obsolete:** queries-per-invocation and Free-plan
  daily row limits (incidents.md); "raw SQL in `db.batch` crashes the driver";
  "Env differs between local and CI" (`wrangler types`); per-isolate wording in
  `error-handler.ts` (the budget becomes per process, which is stricter); "rate
  limits belong at the edge" for shares (a process-local counter is now
  meaningful if one is ever wanted).
- **Gaps that become easy to close:** the SECURITY.md food-revision race was
  designed around the guard trick and becomes "check the revision inside the
  transaction, throw -> 409". Transactions only replace the abort mechanism.
  The race is about CLIENT staleness, so it still needs the rest of that
  design: a client-supplied revision, and a revision bump on every food
  mutation. `packing-locations.ts` `create`/`rename`
  read-back becomes write plus read in one transaction.
- **Deploy machinery:** the `deploy.yml` `workflow_run` dance;
  `deploy-liveness.yml` and `scripts/deployed-sha.*` (a manual deploy is
  supposed to lag main); `wrangler.jsonc`; `worker-configuration.d.ts`;
  `tsconfig.worker.json`'s `@cloudflare/vitest-plugin/types`; three Cloudflare
  devDependencies (removing `@cloudflare/vitest-plugin` also unblocks vitest 5,
  STACK.md watch list).
- **Smaller items:** the `workers.dev` second origin; the CSP beacon
  allowance; `docs/d1-restore.md` (replaced by a snapshot-restore doc).

**Essential, and staying:** `reposForUser` scoping; the ESLint DB-import
boundary; CSRF-then-auth; the strict share DTO; the passkey freshness gate;
magic-link hardening and the three-bucket quota; all 23 triggers; composite
FKs; body limits; the header map; error-handler redaction.

## 4. Implementation sequence

Each step is a PR, tests first, binding docs updated in the same PR. **No
schema migrations land between stage 2 and cutover,** so D1 and the import
tool stay in step.

**Stage 0: inventory and freeze (no code).**
1. You inventory Cloudflare: the Worker's Domains & Routes; DNS records for
   `grampacker.app` and `www`; any leftover Pages project; redirect and page
   rules; Web Analytics. Capture `wrangler d1 migrations list grampacker --remote`.
2. Answer the questions in section 11.
3. Before the first conversion PR merges: `gh workflow disable deploy.yml` and
   `gh workflow disable deploy-liveness.yml`. The Worker keeps serving its
   current version. Without this, a merge to main would `wrangler deploy` a
   half-converted app, and `routes` would re-claim the domain.

**Stage 2: Node and vanilla SQLite** (one PR, several commits).
- Add `better-sqlite3`, `@hono/node-server`, `@types/better-sqlite3`,
  `@hono/vite-dev-server`; read the lockfile diff. Remove
  `@cloudflare/vite-plugin`, `@cloudflare/vitest-plugin`, `wrangler`.
- Rewrite `server/db/index.ts`: `openDatabase(path)` (opens the file and sets
  the pragmas) and `createDb(sqlite)`. Add `server/app-env.ts`, a typed
  replacement for the generated `Env`: `DB`, `BETTER_AUTH_URL`,
  `BETTER_AUTH_SECRET`, `RESEND_API_KEY?`, `EMAIL_FROM`, `CLIENT_IP_HEADER`.
  Update `server/env.d.ts`, `auth-schema.config.ts`, and
  `tsconfig.worker.json` (rename to `tsconfig.server.json`, Node types).
- Add `server/node.ts`: open the DB once, build the app from
  `server/index.ts`, serve `dist/client` through `serveStatic`, `serve()` on
  `PORT`; on SIGTERM/SIGINT, `server.close()` then `db.close()`.
- Replace `c.env.ASSETS.fetch` in `server/index.ts` with `serveStatic` plus the
  SPA fallback. Re-check what `forceValidatedAssetResponse` does with
  `serveStatic` (it may become unnecessary). `index.html` gets
  `Cache-Control: no-cache`.
- Add a **temporary** `runBatch(db, stmts)` that runs today's statement arrays
  in one synchronous transaction, so the 33 sites convert mechanically with the
  same semantics. Deleted in stage 3. Run each item **synchronously**
  (drizzle's prepared-query sync execution) inside the transaction callback.
  Never `await` a builder there: `.execute()` is async even on this driver,
  and a better-sqlite3 transaction callback must not return a promise. Keep
  drizzle's row mapping rather than running raw SQL, because callers read the
  mapped `returning`/select arrays (for example `server/repos/food.ts:596`).
  No repo reads D1 run-result metadata.
- `db-errors.ts`: keep the walk to the root `cause`, then classify by the root
  error's `code` (`SQLITE_CONSTRAINT_*`) **and** its message (which names the
  table and column). better-sqlite3's `SqliteError` keeps the two separately;
  D1 put both in the message. `rate-limit.ts`: read
  `CLIENT_IP_HEADER`.
- Port tests: `vitest.workers.config.ts` becomes a Node "api" config;
  `server/test/apply-migrations.ts` calls `migrate()` on a per-file in-memory
  DB; `cloudflare:test` imports point at a local `server/test/env.ts`.
- Build: `vite build` (client) plus a Vite SSR build of `server/node.ts` and
  `server/ops.ts` into `dist/server/`. `typecheck` drops `wrangler types`.
- ESLint exempt list: `server/node.ts` and `server/ops.ts` (composition roots).
- Docs: AGENTS.md (stack, commands, the D1 traps), README, STACK,
  `docs/testing-and-ci.md` sections 1-5, `incidents.md` "If this ever moves off
  D1" (done), SECURITY.md (client IP, secrets).

**Stage 3: simplify** (one PR per repo group, schema unchanged).
- `pack-reorder.ts` + `packing-locations.ts` (guards, census, drift checks).
- `food.ts`; `lists.ts` and `list-items.ts`; `gear-items.ts`,
  `categories.ts`, `public-shares.ts`.
- Delete `runBatch`. Optionally delete `chunk-ids.ts` after a max-payload test.
- Each removed 409 path either gets a test proving the race can no longer
  happen, or its test is deleted with the stated reason
  (`testing-and-ci.md` section 8).

**Stage 4: production container.** `Dockerfile` (build stage: `npm ci`,
`npm run build`; prod-deps stage: `npm ci --omit=dev`; runtime stage),
`.dockerignore`, and `server/ops.ts` with these commands: `migrate`,
`pending`, `snapshot <dest>` (better-sqlite3 `.backup()` [V], then
`integrity_check` on the copy), `check` (`integrity_check`,
`foreign_key_check`, invariant queries), and a temporary `import-d1`.

**Stage 5: local Compose.** `deploy/compose.yaml`, `deploy/Caddyfile`,
`deploy/bin/deploy`, `deploy/README.md`; verify on oak.

**Stage 6: CI and GHCR.** Rewrite `ci.yml` (section 10); new `deploy.yml`
(section 7); delete the old `deploy.yml`, `deploy-liveness.yml`,
`scripts/deployed-sha.*`; `scripts/migration-rules.mjs` rule
`d1_migrations` -> `__drizzle_migrations`; SECURITY.md `workflow_dispatch` rule
(section 7).

**Stages 7-16:** VPS preparation, rehearsals, cutover and retirement are in
sections 6, 8 and 9.

## 5. Acceptance checks per stage

| Stage | Passes when |
|---|---|
| 0 | Inventory written; both workflows `disabled_manually`; D1 ledger lists `0000_baseline.sql` |
| 2 | `npm run build`, `test:unit`, and the Node API suite pass with **unchanged assertions** (a one-line import change per file is allowed). A test proves `PRAGMA foreign_keys` = 1 on a fresh connection. A test proves a unique violation still answers 409 (temporarily break `db-errors` and watch it fail). A spoofed `cf-connecting-ip` no longer changes the bucket. `npm run dev` serves SPA and API. |
| 3 | Same suites green; each removed mechanism has a removal reason in its commit; `grep -r "db.batch\|_pack_reorder_guard" server/repos` is empty. |
| 4 | `docker build --platform linux/amd64` works; non-root (`id` -> uid 1000); `docker run ... ops.js migrate` creates a DB; HEALTHCHECK turns healthy; `docker stop` exits in under 2 s with a clean WAL checkpoint; `docker history` and `find / -name '*.db'` show no secrets or DB. |
| 5 | On oak: data survives `docker compose down && up` (container recreated); `ops snapshot` output appears in the host `snapshots/` directory; with `state/maintenance` present, Caddy answers 503 while `127.0.0.1:3000` still answers; `compose up --wait`; through Caddy, `/api/health` `{"ok":true}`, `/` carries CSP/HSTS, a hashed asset has `immutable`, anonymous `/api/lists` 401, POST without CSRF header 403; the app port cannot be reached from another machine. |
| 6 | PR CI green including container smoke; a dispatch for a SHA with no green CI fails before build/SSH; a manual dispatch pushes `ghcr.io/joes703/grampacker:<sha>` and the summary shows the digest. |
| 7 | VPS: only 22/80/443 open (`ss -tlnp` and an external scan); Caddy gets a cert for the rehearsal hostname; the deploy key runs only the forced command (`ssh deploy@vps id` refused). |
| 8 | Two import rehearsals pass every gate in section 6; timings recorded. |
| 9 | On `staging.grampacker.app` with rehearsal data: magic-link sign-in; **an existing passkey signs in**; lists, gear and food match production; share links work; account deletion works on a throwaway account. |
| 12-14 | Section 9 cutover checklist all green. |
| 15 | 14 days of observation; nightly `ops check` reports `ok`; one backup restore tested. |

## 6. D1 -> SQLite data migration

Export runs on your machine with `wrangler login` (the sandbox has no
Cloudflare credentials). The import runs inside **the production image**
(`docker run --rm ... ops.js import-d1`), so it uses the same SQLite build as
production.

**Export** (rehearsals and final):
1. `npx wrangler d1 time-travel info grampacker`: record the bookmark.
2. `npx wrangler d1 export grampacker --remote --output=d1-full-<UTC>.sql`.
   This is the **archival original**: `sha256sum`, `chmod 0400`, copy off the
   machine, never edit. A running export **blocks other database requests** [V].
3. `npx wrangler d1 export grampacker --remote --no-schema --output=d1-data-<UTC>.sql`:
   the file that gets loaded.
4. `wrangler d1 execute grampacker --remote --json --command "select type,name,tbl_name,sql from sqlite_master order by type,name"`
   -> `d1-schema.json`.
5. Same way: `select * from d1_migrations`, plus one
   `select '<t>', count(*) from <t>` union over all 18 tables -> `d1-counts.json`.

**Import (`ops import-d1`):**
1. Build a **reference DB** (empty plus `migrate()`). Compare the
   **application** objects in its `sqlite_master` with `d1-schema.json`,
   excluding both platform ledgers (`d1_migrations` on the D1 side,
   `__drizzle_migrations` on the reference side) as well as `_cf_*` and
   `sqlite_*`. For each table, also compare `PRAGMA table_info` (column order,
   type, NOT NULL, default, primary key) on both sides; run
   `wrangler d1 execute --json` for the D1 side. **Any remaining difference
   stops the import.** Do not loosen the comparison to ignore SQL text
   differences. This gate is what lets positional `INSERT`s land in the right
   columns.
2. Check that the D1 ledger contains `${tag}.sql` for every entry in
   `migrations/meta/_journal.json`. Today that is `0000_baseline.sql`.
   Wrangler records file names; the journal stores tags without the
   extension. The ledger also holds the 30 historical names from before the
   baseline collapse; those are expected, not errors.
3. Build the **target** with `migrate()`. That creates `__drizzle_migrations`
   with the correct hash and `created_at`, so nothing is seeded by hand.
   Check its contents separately: one row per journal entry.
4. Save the 23 `CREATE TRIGGER` statements and drop the triggers.
   `packing_locations` and `list_items` check each other in their insert
   triggers, so any export order can trip them.
5. `PRAGMA foreign_keys=OFF` (outside a transaction). Create a scratch
   `d1_migrations` table for its INSERTs. Load the data file in one
   transaction. Drop the scratch table.
6. Recreate the triggers. Compare `sqlite_master` with the reference DB:
   **identical**.
7. `PRAGMA foreign_keys=ON`; `PRAGMA foreign_key_check` returns no rows;
   `PRAGMA integrity_check` returns `ok`.
8. Re-check trigger invariants with explicit queries (triggers only fire on
   new writes): caps per user and per list; list items and food items on the
   same list as their packing location; containers on the same list; no
   container cycles (recursive CTE); `pack_sort_order` within 0..1e9; the 4
   transient tables empty.
9. Row counts per table equal `d1-counts.json` (except the purged tables in
   step 10).
10. **Recorded transformations** (log each with row counts): delete `session`
    (secret rotated, section 9), `verification` (5-minute tokens and
    challenges), `rate_limits` (transient).
11. Auth checks: every `passkey.user_id`, `account.user_id`, `session.user_id`
    exists in `user`; `select provider_id, count(*) from account group by 1`
    shows no `credential` rows (password purged); `passkey.credential_id` and
    `public_key` byte-identical to the export (spot-check by hash).
12. Representative checks: for each of the 3 users, per-list item counts,
    total weights (through the API on staging) and one food plan compared with
    the live app.
13. `VACUUM`; `journal_mode=WAL`; record the sha256 of the result. Install it
    at `data/grampacker.db`, owned 1000:1000, mode 0600.

**Precision** [V]: export numbers are subject to JS 52-bit precision. Epoch-ms
(about 1.8e12) and ranks (at most 1e9) fit; spot-check one timestamp anyway.

**Timing:** time export, import and gates on each rehearsal. With 3 accounts I
expect well under a minute, but that is unmeasured.

## 7. GitHub Actions and GHCR

**New `deploy.yml`** [R]:
- `on: workflow_dispatch` (no inputs). Job `if: github.ref == 'refs/heads/main'`,
  `environment: production` (holds `VPS_HOST`, `VPS_SSH_KEY`,
  `VPS_KNOWN_HOSTS`). Permissions `contents: read`, `actions: read`,
  `packages: write`. Job-level `concurrency: deploy-production`,
  `cancel-in-progress: false`.
- Steps:
  1. Check out `refs/heads/main`; resolve the SHA.
  2. Reuse today's "Verify ci.yml is green for main's head" query, but make
     it **fail the job** (exit non-zero) when no successful `ci.yml` push run
     exists for the SHA. Today's step writes `go=false` and exits 0, which is
     safe only because every later step tests `steps.verify.outputs.go`
     (`deploy.yml:248`, `:260`). A manual deploy of an unverified SHA is an
     error, not a no-op. Acceptance: dispatching against a SHA without green
     CI never reaches the build, push or SSH steps.
  3. `setup-buildx`; `login-action` to ghcr.io with `GITHUB_TOKEN`.
  4. `build-push-action`: `platforms: linux/amd64`, tag
     `ghcr.io/joes703/grampacker:<full-sha>`, label
     `org.opencontainers.image.revision=<sha>`, digest as output.
  5. `ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=<from secret> deploy@$VPS_HOST "deploy <sha> <digest>"`.
  6. Job summary: SHA, digest, host result. The `environment:` key also
     creates the GitHub deployment record, which replaces the hand-written
     marker step.
- **Built here, not reused from CI:** a branch can push GHCR tags, and tags
  are mutable. The VPS **pulls by digest**, and the digest comes from this
  protected job. Third-party actions are pinned by SHA (already enforced by
  `check-action-pins.mjs`).
- **The `workflow_dispatch` conflict:** SECURITY.md and `incidents.md` ban
  `workflow_dispatch` on any workflow that names a secret, because a dispatch
  runs the chosen ref's edited copy. An environment with a "main only"
  deployment-branch policy closes that, since environment secrets are never
  released to other refs. **On a private repo, environments need GitHub Pro**
  [V]. See question 1.
- **Deploy key on the VPS:** `authorized_keys` entry
  `restrict,command="/srv/grampacker/bin/deploy" ssh-ed25519 ...`. The script
  accepts only `^deploy [0-9a-f]{40} sha256:[0-9a-f]{64}$` or `^rollback$`.
  A leaked key gets no shell. Membership in the `docker` group still equals
  root on that host; the forced command is what contains it.

**Host script `deploy/bin/deploy`** (in the repo, installed by hand, under
`flock`):
Public traffic stays closed from the snapshot until the candidate has passed
its checks. Otherwise a restore after a failed check could erase writes users
made against the new app in the meantime. Maintenance mode is a flag file
that Caddy reads (section 8).

1. Pull `image@digest`; check the revision label equals the SHA.
2. `ops pending` with the new image (read-only list of pending migrations).
3. **Close public traffic:** create `state/maintenance`. Caddy now answers
   every public request with 503 and `Retry-After`, so no request reaches
   either app version. **Check that it actually closed:** an HTTPS request
   through Caddy (`curl --resolve grampacker.app:443:127.0.0.1`) must return
   that 503. If not, abort before stopping anything and leave the flag in
   place for inspection.
4. `docker compose stop app`. **10-30 s of downtime per deploy**, but the
   snapshot then exactly matches the pre-migration state, and the old code
   never runs against the new schema.
5. `ops snapshot /snapshots/pre-<sha>-<UTC>.db` (online backup, then
   integrity check of the copy).
6. `ops migrate` with the **new** image, as an explicit step. Never on app
   startup; this keeps today's model of migration as its own visible step.
7. Write `GRAMPACKER_IMAGE=...@digest` to `/srv/grampacker/.env`;
   `docker compose up -d --wait --wait-timeout 60 app` [V].
8. **Private smoke test,** straight to the app on `127.0.0.1:3000` with
   `Host: grampacker.app` (Caddy is still answering 503 to the public):
   health, SPA shell with CSP, one hashed asset, anonymous 401, POST without
   CSRF header 403. The security headers come from the app, so this path
   checks them.
9. **Failure before reopening:** no public write can have happened since the
   snapshot. Switch back to the previous image. If step 6 applied anything,
   stop, restore the snapshot (remove `-wal`/`-shm`). With maintenance still
   on, start the previous image with `compose up --wait` and run the same
   private smoke test against it. Remove the flag only if that passes. If the
   recovery fails, traffic stays closed. Either way, exit non-zero naming the
   snapshot path.
10. **Reopen:** remove `state/maintenance`. Run the public check with
    `curl --resolve grampacker.app:443:127.0.0.1`: TLS, health, one asset.
11. **Failure after reopening:** switch the image back only. That is safe
    only for backward-compatible migrations. **Never restore the database
    automatically at this point.** Restoring the snapshot once the app has
    reopened is a manual recovery you authorize, knowing it discards the
    writes accepted since reopening.
12. Success: write `state/current`, shift `state/previous`, prune GHCR images
    other than current and previous.

**App rollback vs DB rollback:** `rollback` (or by hand) swaps the image only.
That is safe **only if** the migrations since the previous image are
backward-compatible. Today's rules (no rebuilds; drops only after the release
that stopped using the object has deployed) keep that true, so keep them, with
the reason changed to "the previous image must run against the new schema".
An incompatible migration needs the old image **and** the pre-migration
snapshot, and loses any writes made since.

**Later:** tag deploys are `on: push: tags: ['v*']` with the same environment
(tags allowed in the policy). Automatic deploy from main is the old
`workflow_run`-on-CI pattern without the D1 steps. Neither is needed now.

## 8. VPS, Compose, Caddy, DNS

**Layout** [R]:

```
/srv/grampacker/
  compose.yaml  Caddyfile  .env             # deploy config; .env holds only GRAMPACKER_IMAGE
  secrets/app.env                           # 0600 root: BETTER_AUTH_SECRET, RESEND_API_KEY
  data/                                     # 0700 1000:1000: grampacker.db, -wal, -shm
  snapshots/                                # 0700: pre-deploy + scheduled snapshots (what B2 uploads)
  state/                                    # current, previous, deploy.log, deploy.lock
  caddy/{data,config}/                      # ACME account + certs; back these up too
  bin/deploy
```

**Compose `app` service:** `image: ${GRAMPACKER_IMAGE:?}`, `init: true`,
`restart: unless-stopped`, `env_file: secrets/app.env`; `environment:`
`NODE_ENV=production`, `PORT=3000`, `DATABASE_PATH=/data/grampacker.db`,
`BETTER_AUTH_URL=https://grampacker.app`, `EMAIL_FROM`,
`CLIENT_IP_HEADER=x-real-ip`; `ports: ["127.0.0.1:3000:3000"]`;
`volumes: [/srv/grampacker/data:/data, /srv/grampacker/snapshots:/snapshots]`
(the only writable paths besides `/tmp`; both directories are owned by
1000:1000, the image's `node` user, so the app and `ops` runs can write
them);
`read_only: true`, `tmpfs: /tmp`, `cap_drop: [ALL]`, `no-new-privileges`,
`mem_limit: 512m`; json-file logging with `max-size: 10m`, `max-file: 5`. The
image runs as `USER node`, with a `HEALTHCHECK` script that fetches
`http://127.0.0.1:3000/api/health` inside the container using Node's `fetch`
(slim has no curl). The script has a bounded timeout
(`AbortSignal.timeout(3000)`) and exits non-zero unless the status is 200
**and** the JSON body has `ok === true`. A `fetch` that resolves is not
success: a failed DB query still produces an HTTP response
(`server/index.ts:118`). The probe never goes through Caddy, so maintenance
mode cannot block `compose up --wait`.

**Compose `caddy` service:** official `caddy:2.x` pinned by digest, with
`network_mode: host`; volumes
`./Caddyfile:/etc/caddy/Caddyfile:ro`, `/srv/grampacker/caddy/data:/data`,
`/srv/grampacker/caddy/config:/config`,
`/srv/grampacker/state:/srv/state:ro` (so Caddy can see the maintenance
flag). Host networking is deliberate: Docker's port proxy can
replace the source IP of IPv6 clients, which would put every IPv6 visitor in
one rate-limit bucket. On the host network Caddy sees real v4 and v6
addresses, and only Caddy listens publicly.

**Caddyfile:**

```
grampacker.app {
  encode zstd gzip
  request_body { max_size 3MB }        # outer ceiling; app keeps 128 KB / 2 MB
  @maintenance file {
    root /srv/state                     # file paths are relative to root, even with a leading slash
    try_files maintenance
  }
  handle @maintenance {
    header Retry-After 60
    respond "grampacker is updating; try again in a minute" 503
  }
  handle {
    reverse_proxy 127.0.0.1:3000 { header_up X-Real-IP {remote_host} }
  }
}
```

The deploy script's private smoke test (section 7) skips Caddy and goes
straight to `127.0.0.1:3000`, so the candidate can be checked while the
public sees 503.

Add a `www` redirect only if stage 0 finds a `www` record. Caddy ignores
incoming `X-Forwarded-*` from untrusted peers [V]. The app streams nothing and
has no WebSockets, so no special proxy settings are needed.

**Host:** firewall allows 22/tcp, 80/tcp, 443/tcp (plus 443/udp for HTTP/3).
The only Docker-published port is on loopback, so Docker bypassing ufw exposes
nothing. A `deploy` user; `docker login ghcr.io` with a **classic PAT,
`read:packages` only, with an expiry** [V: GHCR needs a classic PAT]. The image
contains no secrets, so a public package is also acceptable and removes the
credential.

**What backup and email need from the app:**
- Backup uploads `snapshots/`, **never the live `data/` files** (copying a
  live WAL database is unsafe). A host systemd timer runs
  `docker compose run --rm app node dist/server/ops.js snapshot ...` nightly
  with retention. Also back up `caddy/data` and `secrets/` (encrypted).
- Email: outbound HTTPS to `api.resend.com`, `RESEND_API_KEY`, and
  `EMAIL_FROM` on the `grampacker.app` domain. SPF/DKIM records stay in
  Cloudflare DNS, untouched.

**DNS:** rehearsal `staging.grampacker.app` A record (DNS-only, TTL 60) to the
VPS IPv4. Production: A (plus AAAA if the VPS has IPv6) for `grampacker.app`,
DNS-only, TTL 300. Verify: `dig +short A/AAAA grampacker.app @1.1.1.1` and
`@8.8.8.8` both return the VPS; `curl -vI` shows issuer and expiry; `http://`
redirects to `https://`; HSTS and CSP present;
`Set-Cookie: __Secure-better-auth.session_token; HttpOnly; Secure; SameSite=Strict`;
API, asset and deep-link routes work; external `nmap` shows only 22/80/443.

## 9. Cutover and rollback

**Sessions** [R]: a one-time sign-in. Worker secrets cannot be read back, so
continuing sessions would need the old `BETTER_AUTH_SECRET` from somewhere
else, and a new secret that never leaves the VPS is a cleaner boundary. So:
new secret on the VPS; purge `session` and `verification` at import; users,
accounts and passkeys stay. better-auth signs session cookies with the secret,
so old cookies just stop validating [V].

**Passkey continuity** [V for the logic; confirm in stage 9]. These must not
change: hostname `grampacker.app`; RP ID `grampacker.app` (`passkeyRpId`);
origin `https://grampacker.app` (`BETTER_AUTH_URL`, no trailing slash); HTTPS;
the `passkey` rows (`credential_id`, `public_key`, `counter`, `user_id`) and
the `user.id` values. On `staging.grampacker.app` the RP ID is still
`grampacker.app`, so **existing passkeys can be tested end to end before
cutover** against the rehearsal copy. Counters only move forward, so staging
use cannot break production.

**Maintenance window:**
1. Confirm the VPS is on the release image with an empty `data/`, and that
   Caddy is up for `staging`. No TTL to lower: the Worker record is proxied,
   so Cloudflare answers for it immediately.
2. **Freeze D1 writes:** in the Worker's Domains & Routes, remove custom domain
   `grampacker.app` and **disable `workers.dev`** (writes there are already
   refused by CSRF/origin; this removes a stale second origin). Check that
   `grampacker.app` no longer answers from the Worker. Whether removing the
   custom domain also deletes its DNS record is not documented [U]: check the
   DNS tab and remove any leftover record by hand.
3. Final export and import (section 6), every gate green; install the DB.
4. `docker compose up -d --wait`; test locally with `--resolve`.
5. Create the DNS-only A (and AAAA) record. Caddy gets its cert via HTTP-01
   within seconds; browsers (HSTS) error until then, inside the window.
6. Verification checklist (section 8 DNS), then auth: magic-link sign-in;
   passkey sign-in for each enrolled authenticator; fresh-session-gated
   passkey add and delete; sign-out; anonymous share link; CSV import (the
   2 MB path).
7. **Create no real data until step 6 passes.** That is the point of no
   return in the table below.

| Failure | Action | Authoritative DB |
|---|---|---|
| Before any DNS change (stages 7-11) | Nothing to undo; the Worker serves throughout; discard the VPS DB | D1 |
| App failure after DNS, **before any real VPS writes** | Delete the A/AAAA records; re-attach the Worker custom domain (and workers.dev if wanted). D1 is unchanged since the export. | D1 |
| App failure after real VPS writes | Fix forward, or image rollback (section 7). Returning to the Worker means abandoning or hand-porting VPS writes; not recommended. | SQLite |
| Auth or passkey failure | Magic link still recovers accounts. Check RP ID, origin, `Secure` cookie. If fundamental and before any writes, use the D1 row above. | D1 before writes, else SQLite |
| Migration failure on a later deploy | A failing migration rolls back its own transaction; the script restarts the previous image. If the migration committed and the candidate then failed its private check, the script restores the snapshot and the previous image. Safe, because maintenance mode blocked public writes. After reopening, a restore is never automatic (section 7). | SQLite (snapshot) |
| Corrupt or incomplete import | Caught by section 6 gates before DNS. Re-import from the untouched archive; D1 Time Travel (7 days, Free [V]) is the backstop. | D1 |

There is never a moment when both databases accept writes: D1 loses traffic
in step 2, before the export, and SQLite gets none until step 5.

**Retirement** (after about 14 days): delete the Worker, then the Cloudflare
API token and `CLOUDFLARE_*` secrets, then `wrangler.jsonc`,
`docs/d1-restore.md` and `import-d1`. Delete the D1 database **last**, after a
final archived export. AGENTS.md says "the database is never deleted", so
that step needs your explicit approval and a rule change.

## 10. CI checks

| Check | Decision |
|---|---|
| `npm ci`, `npm run build` (typecheck + lint + vite build) | Keep; `typecheck` drops `wrangler types` |
| `test:unit` | Keep unchanged |
| `test:api` (workerd + D1) | **Replace** with Node + better-sqlite3, same test files. Remove the old one only when the new one passes with the same assertions |
| `test:migrations` | Keep. Ledger rule `d1_migrations` -> `__drizzle_migrations`. New: the newest journal `when` must exceed the previous one, because drizzle **silently skips** older-timestamped migrations [V] |
| `check-migration-immutability.mjs` | Keep |
| `check:action-pins`, yamllint | Keep; add the `docker/*` actions to the pin check |
| **New:** container build + smoke | `docker build` (no push) -> `ops migrate` on a temp volume -> start -> wait healthy -> curl the 5 smoke routes |
| **New:** Dependabot | `docker` ecosystem for `Dockerfile` and `deploy/compose.yaml` digests |
| `WRANGLER_SEND_METRICS`, `deploy-liveness.yml`, `deployed-sha` test | Remove |

## 11. Questions and assumptions

**Questions that change the plan:**
1. **Is your GitHub account on Pro, or would you make the repo public?** If
   yes: environment secrets restricted to main (section 7). If no: the SSH key
   is a repository secret readable by any pushed branch's workflow, the same
   exposure class as today's `CLOUDFLARE_API_TOKEN` (SECURITY.md "not
   environment-scoped"); the forced command limits that but does not close it.
   The alternative is that you run `ssh vps deploy <sha> <digest>` yourself
   after Actions publishes the image, so GitHub holds no SSH key at all.
2. **Does outbound email stay on Resend's HTTP API?** The app only speaks that
   today (`server/email/resend.ts`). If your email system is SMTP, add an
   `EmailSender` implementation in stage 2.

**Decisions taken (reversible):** rotate the secret and require one sign-in;
DNS-only record; Caddy in Compose with host networking, assuming the **VPS is
dedicated to grampacker** (otherwise a host Caddy with the same Caddyfile);
private image with a read-only PAT; snapshot with the app stopped;
`staging.grampacker.app` as the rehearsal hostname.

**Assumptions to verify:** VPS OS, Docker and Compose versions; IPv6
availability; whether `www` or old Pages bindings exist; Cloudflare Free plan
(7-day Time Travel); whether removing a Worker custom domain removes its DNS
record [U]; export INSERT format (gate 1 catches a mismatch);
`@hono/node-server` `serveStatic` 304 behavior; bundled SQLite parameter limit.

## 12. Official documentation

Verified by the research pass (some through the vendors' GitHub doc sources,
because the sandbox firewall blocked their websites):

- Node release schedule: https://github.com/nodejs/Release
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- Drizzle: https://orm.drizzle.team/docs/get-started-sqlite, https://orm.drizzle.team/docs/migrations
- Hono on Node: https://hono.dev/docs/getting-started/nodejs, https://hono.dev/docs/helpers/conninfo
- better-auth: https://www.better-auth.com/docs/reference/options, https://www.better-auth.com/docs/concepts/cookies, https://www.better-auth.com/docs/adapters/sqlite, https://www.better-auth.com/docs/plugins/passkey
- WebAuthn L3: https://www.w3.org/TR/webauthn-3/
- D1 export: https://developers.cloudflare.com/d1/best-practices/import-export-data/, https://developers.cloudflare.com/workers/wrangler/commands/d1/
- D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
- Workers Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/
- GHCR: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- GitHub environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- GitHub concurrency: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- Workflow triggers: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Docker actions: https://github.com/docker/build-push-action, https://github.com/docker/login-action
- Compose: https://docs.docker.com/reference/compose-file/services/, https://docs.docker.com/reference/cli/docker/compose/up/, https://docs.docker.com/build/building/multi-stage/
- Caddy: https://caddyserver.com/docs/automatic-https, https://caddyserver.com/docs/caddyfile/directives/reverse_proxy, https://caddyserver.com/docs/caddyfile/directives/request_body

Unverified (sqlite.org blocked): https://www.sqlite.org/pragma.html,
https://www.sqlite.org/backup.html, https://www.sqlite.org/wal.html,
https://www.sqlite.org/lang_vacuum.html

## 13. What becomes simpler, and what upkeep remains

**Simpler:** one ordinary Node process and one SQLite file. Real transactions
instead of batch semantics, guard tables and drift checks. No 100-parameter,
per-invocation or daily row limits. No workerd, Miniflare, Wrangler or
Cloudflare plugins, so local equals CI and vitest 5 is unblocked. About 700
lines of deploy/liveness workflow and scripts become about 100 lines of
workflow plus one host script. Restore is a file copy, not Time Travel.
Portable to oak, another VPS, another registry (change one image path) or
self-hosted Git (the host script does not care where the digest came from).

**Upkeep that remains:** OS security updates (unattended-upgrades) and
reboots; Docker Engine and Compose updates; Caddy and Node base-image digest
bumps (Dependabot can propose them); npm updates under the existing AGENTS.md
rules; a nightly `ops check` with alerts on anything but `ok`; monitoring that
backups arrive, and a monthly test restore into a scratch container; external
monitoring of cert expiry, the DNS answer and `/api/health`; disk alerts
(35 GB is plenty, but snapshots and images grow) and memory checks; image
pruning that always keeps current and previous; GHCR PAT rotation before it
expires.
