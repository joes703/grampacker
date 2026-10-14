# Testing and CI/CD: which tier, which check, how a merge reaches production

**Binding, maintained against the code** (AGENTS.md "Documents"). If a
sentence here disagrees with a config file or a workflow, that is a bug in
this document, and the change that made it wrong owes the fix.

Every section describes the tree as it is. Nothing here is headed "target
state" any more: the CI-simplification effort those headings came from closed
on 2026-09-06, and its last two stages were dropped rather than built.
Section 11 records what the dropped design would have changed and why it was
not worth it; history and rationale live in `docs/incidents.md`. The plan
document itself was never committed, so nothing in the tree cites it.

## 1. The tiers

| Tier | Runner | Files | Proves |
| --- | --- | --- | --- |
| Node unit | `npm run test:unit` (Vitest, `environment: node`) | `scripts/**`, `shared/**`, `src/**` tests without a jsdom pragma, `server/**/*.node.test.ts` | Pure functions, DTO schemas, repo plumbing, server code with a mocked `Db` |
| jsdom component | same command; file opens with `// @vitest-environment jsdom` | `src/**` tests that render or need a DOM API | Rendering, DOM APIs, `localStorage` |
| Node / SQLite API | `npm run test:api` (`vitest.api.config.ts`) | every other `server/**/*.test.ts` | What the real Hono app, better-auth and SQLite do on Node: routes, middleware, authorization boundaries, constraints, triggers, transactions |
| Migration check | `npm run test:migrations` (static, no database) | `migrations/**` | Drizzle bookkeeping, snapshot matches `schema.ts`, no destructive statement in a new migration. Not that a migration preserves existing rows: nothing proves that before merge (section 7) |
| Browser / end-to-end | none | none | Not needed today: the API tier drives the real app below the DOM and the jsdom tier covers rendering. Add one only for a cross-layer bug neither can express, in its own config |

`vitest.config.ts` and `vitest.api.config.ts` are the source of truth for
membership. The API tier moved from workerd/D1 to Node/SQLite with the VPS
migration (`docs/vps-migration-plan.md`); `vitest.workers.config.ts` and its
setup files are still in the tree but no longer run, and go when the
Cloudflare tooling is removed.

## 2. Choosing a tier

Pick the cheapest runner that can prove what the test asserts:

1. Depends on what the real app, better-auth or SQLite actually does (a
   status code, a constraint or trigger, a transaction, an authorization
   boundary, a cookie)? **Node / SQLite API.** `server/**/*.test.ts`.
2. A pure function, or a repository driven through a hand-built fake `Db`,
   with no binding and no app? **Node.** Under `server/`, name it
   `*.node.test.ts`.
3. Renders React or needs a DOM API? **jsdom** pragma on line 1.
4. Adds or changes a trigger or other database rule? An API test that
   exercises it on SQLite (`server/**/*.test.ts`). A new constant copied into
   trigger SQL gets a row in `scripts/pack-rank-constants.test.ts`.

Both tiers run on Node now, so the difference is what a test may touch, not
the runtime. The suffix is a claim the author makes and the reviewer checks.

## 3. The unit/API boundary and what enforces it

`server/**/*.node.test.ts` is a unit test: no app, no database. Every other
`server/**/*.test.ts` is an API test with its own SQLite database
(`server/test/node-env.ts`). The name is the boundary so the claim is
visible without opening a config.

- `vitest.config.ts` includes the glob; `vitest.api.config.ts` excludes it.
  A file cannot run in both tiers.
- A misnamed unit test could import the app entry and quietly become an API
  test without a database of its own. A `no-restricted-imports` rule in
  `eslint.config.js` refuses, per directory depth, the direct spellings that
  reach `server/index.ts` from a `.node.test.ts` (`..`, `../`, `../index`,
  `../index.ts`, `../index.js`), and leaves a sibling module's own
  `index.ts` alone. A roundabout path such as `../../server/index` still
  gets through.

This guards against the accidental misfile, not deliberate evasion. The
residual is judgment, per section 2.

## 4. A real database where it is used, and not elsewhere

The bugs this app has shipped lived at the seams between Drizzle, Hono,
better-auth and the database, and none was visible on a fake
(`docs/incidents.md`). The API tier exists to see them. The same fact runs
the other way: an API test file pays a full migration replay before its
first assertion, which a pure function or a mocked repository gains nothing
from. Put each test where its claim needs to be, and nowhere more
expensive.

## 5. Database isolation stays per file

Each API test file gets its own in-memory SQLite database with the
migrations applied (`server/test/node-env.ts`; Vitest gives every file its
own module graph). Sharing a database across files (`--no-isolate`,
`--max-workers=1`) was tried on D1 and leaked rows between files; do not
repeat it. The answer to the per-file cost is fewer API files, never shared
state.

## 6. jsdom

For rendering and DOM APIs only. Do not add the pragma to a test that needs
neither; whether a `localStorage`-only test is better served by a small
stub is a measured decision, not a default.

## 7. Migrations

`migrations/` holds one baseline (`0000_baseline.sql`, production's schema as
of 2026-09-26) plus whatever has been added since. The 30 files it replaced are
in git history. Production records every applied file by name in its
`d1_migrations` ledger and runs only files it has not recorded.

**`npm run test:migrations`** (`scripts/check-migration-safety.mjs`):

- **Bookkeeping.** Every journal entry has its `.sql`, every `.sql` has an
  entry, and the newest entry has a snapshot.
- **Snapshot.** The newest snapshot matches `server/db/schema.ts`
  (`drizzle-kit generate` on a copy must find nothing to do).
- **Destructive SQL.** Any migration not yet on `origin/main` must contain no
  DROP TABLE, RENAME, rebuild scratch table, `PRAGMA foreign_keys`, or write
  to `d1_migrations` or the schema table. The rules are in
  `scripts/migration-rules.mjs`, tested by `migration-rules.test.ts`.

**What proves the SQL itself works:** the API suite. It builds every test
database from `migrations/` on real D1 and exercises the triggers.

**What nothing proves before merge:** that a migration preserves existing
rows. Nothing seeds data and replays the migration. The rebuild ban removes
the known way to lose rows, and D1 Time Travel is the undo for anything else
(`docs/d1-restore.md`: 7 days on the Free plan).

**`scripts/check-migration-immutability.mjs`** (pull requests only) refuses
any change to a migration `main` already holds, judged against the merge
base, apart from appended journal entries. It has no exceptions: the one the
2026-09-26 collapse needed was deleted once that collapse had merged, since it
could never fire again. It depends on the "Protect main" ruleset making a pull
request the only route to `main`.

**Collapsing history again** (only if the directory grows unwieldy):
1. Generate the baseline from production's `sqlite_master` (tables, then
   indexes, then triggers; skip `d1_migrations`, `sqlite_*` and `_cf_*`).
2. Keep the newest snapshot as `0000_snapshot.json`, with a zeroed `prevId`
   and a one-entry journal.
3. Prove the baseline builds the same schema as the old files, and give
   `check-migration-immutability.mjs` a reviewed exception for exactly that
   transition. The 2026-09-26 one (`COLLAPSE` and `collapseProblem` in
   21499fb) is a template; delete it again after the collapse merges.
4. Before merging, have the owner run
   `npx wrangler d1 execute grampacker --remote --command "INSERT INTO d1_migrations (name) VALUES ('NNNN_baseline.sql')"`.
5. After merging, reset any local dev database (delete `.wrangler/state`).

## 8. Never delete or weaken a test to make CI faster

Runtime is bought by moving a test to a cheaper tier that proves the same
thing, by not repeating a proof, or by removing setup a test never needed.
A moved test keeps its assertions byte for byte; git shows a rename.

Deleting a test for a reason other than speed has its own bar. A test may go
for one of three reasons:

1. **What it covers no longer exists.** The code, option or contract was
   removed, or its input can no longer occur. For an input, name the
   constraint or trace every production entry point that rules it out, and
   show this does not depend on the protection the test checks. A guard or
   constraint we still keep is not a removed contract: a test of it stays
   unless reason 2 applies. A test that only records that a removed
   feature is absent may go under this reason.
2. **Another named test proves the same thing.** Diff the two first. A
   different argument, input class, caller layer or request shape means the
   other test does not prove the same thing.
3. **It proves nothing.** An argument about the behavior shows that no
   realistic production bug can make it fail: the behavior cannot be
   reached, the type system or a library alone enforces it, or the
   assertion only repeats a constant or a mock. Library behavior counts
   only when it is not our own configuration or wiring.

   These do not show that a test proves nothing: it checks that something
   is absent, the code under it is simple, or two separate guards protect
   the behavior, so removing one guard leaves the test green. A behavior a
   user can reach keeps its test unless reason 2 applies, and so does an
   absence check that enforces a current product or security rule. A
   mutation the test fails to catch is a reason to look closer, never
   proof alone.

   Reason 3 exists because a test that cannot fail still costs run and
   reading time, and makes an unguarded behavior look guarded.

The change that deletes a test says, per test, which reason applies and its
evidence: the protection lost and why that is acceptable, or where the
protection remains. No behavior we still keep loses its only test: when
another test takes over, it exists before or in the same change as the
deletion. Speed alone is never the reason.

## 9. Measuring

Per-step CI timings: `gh api repos/joes703/grampacker/actions/runs/<id>/jobs`.
Per-file suite timings: `npx vitest run --reporter=json --outputFile=<scratch>/x.json`
(and `--config vitest.workers.config.ts`). Compare CI against CI on the same
runner class, before and after one change, at least two runs each. A local
number says how the pieces relate; it is not a CI saving.

## 10. GitHub Actions security

The rules are in AGENTS.md ("Git and supply chain") and `SECURITY.md`; the
decisions a workflow change must respect: least permissions per workflow
and job, with production credentials only on the steps that use them; SHA
pins with the tag in a comment, checked by `npm run check:action-pins`;
`pull_request`, never `pull_request_target`; no `workflow_dispatch` on a
workflow that names a secret; main protected by the ruleset (PR required,
`Verify` required and strict, squash only, no bypass), merged with
`--match-head-commit <sha>` after confirming CI yourself. Repository
secrets are visible to same-repository `pull_request` runs of any
workflow; only a `production` environment restricted to `main` would close
that, and it needs a plan that offers environments on private repositories.

`image.yml` builds the production image and runs `scripts/check-image.sh` on
every pull request, with a read-only token. It is not a required check. A
manual dispatch on main also reruns the build, unit, API and migration
checks, then publishes the image to GHCR. It names no secret; its publish job
alone has `packages: write`. It never deploys. Procedure: runbook
(`docs/vps-bootstrap-and-migration-runbook.md`) step 6.1; accepted risk:
`SECURITY.md`.

## 11. Deployment

**VPS deployment** is `deploy/`: the Compose file, the production and
rehearsal Caddyfiles, and `grampacker-deploy` (runbook section 7). CI does not
test these files yet. Before a change to any of them merges, run:

- shellcheck on `deploy/grampacker-deploy` (for example
  `docker run --rm -v "$PWD/deploy:/mnt:ro" koalaman/shellcheck:v0.10.0 /mnt/grampacker-deploy`);
- `docker compose config` with a production-shaped and a rehearsal
  `deploy.env`;
- `caddy validate` on both Caddyfiles with `caddy:latest`;
- the empty-database rehearsal (runbook 7.4): deploy, restart, maintenance
  and rollback against a built image. It needs Docker and root, and runs in
  an agent sandbox or on the VPS.

A CI job that runs these only when `deploy/`, the Dockerfile, migrations or
the server's startup code change is a possible later step.

**Worker deployment is off.** `main` is moving to a Node server with SQLite
on a VPS, which the Worker cannot run. Every job in `deploy.yml` and
`deploy-liveness.yml` is `if: false`, and the liveness check has no schedule.
After each CI run on main, a Deploy run still appears, with both jobs
skipped. The production Worker keeps serving the last commit it deployed and
is the rollback target; rollback never runs `deploy.yml`. The recovery below
(re-running a Deploy run) must not be used: a re-run uses the old copy of the
workflow file, without `if: false`, and can deploy main as it is now (header
of `deploy.yml`). The rest of this section describes the workflow as it ran.

Principles: CI passes first; production changes are serialized and never
canceled mid-flight; a database change works with the deployed Worker and
the next one (deploy migrates, then swaps the Worker; expand first,
contract a release later); production mutations require explicit human
authorization, and the protected PR merge is that authorization - merge
means deploy, including the migrations the PR carries.

Mechanism today: a push to main runs `ci.yml`; its completion triggers
`deploy.yml` (`workflow_run`); a preflight job drops stale events; the
deploy job, inside the `deploy-production` concurrency group, re-verifies
through the API that `ci.yml` is green for main's head, builds, migrates,
deploys, records a deployment marker; `deploy-liveness.yml` compares main
against that marker every six hours, via `scripts/deployed-sha.mjs`. The
watchdog trusts only the NEWEST deployment record in the page the API returns,
and only when that record's LATEST status is a success - the marker step
creates the record before posting its status, so a record alone is not
evidence that a SHA reached production. Anything else - no status, an
unsuccessful one, or records or statuses tied at the same second that
disagree - is reported as `unverified`, naming no deployed SHA, rather than
falling back to an older success that cannot speak for the newer deploy. Recovery is a
re-run of the failed run, never a manual dispatch; the header of `deploy.yml`
says which failures may be re-run and which must not. A migration that
APPLIED and damaged data is a different recovery whatever the run's final
status, because a re-run skips what already applied rather than repairing
it: a D1 Time Travel restore to just before the migration step, with
`docs/d1-restore.md` as its runbook.

**This is the intended shape, not a way station.** A replacement was designed
in full - `ci.yml` callable, `deploy.yml` calling it directly and gating
inside the lock, no `workflow_run` handoff - and dropped on 2026-09-06 without
being built, so nothing here estimates what it would have saved. What it would
have removed is nameable, though: the `workflow_run` handoff, the preflight
job, and the in-lock API query that re-checks `ci.yml` is green for main's
head (that query, not a second test run - `deploy.yml` never re-runs the
suites). Against that it rewrites the file with the largest blast radius in
the repository, whose ordering behavior under concurrent merges is the part
hardest to re-derive and the part its header spends most of its length on. It
would also have bought no credential isolation: that is a repository settings
question, recorded in `SECURITY.md` under "Deferred", not a property of the
workflow's shape. Revisit only if something in `deploy.yml`'s header stops
holding.

## 12. GitHub access from agent sandboxes

`gh` and `gh api` authenticate with the same fine-grained token supplied
through `GH_TOKEN`. The API is not a separate credential and cannot bypass
the token's permissions.

**Intended token profile.** Intended policy, not a claim derived from
`viewerPermission`; GitHub's token settings page is authoritative. Entries
the repository's own evidence has not confirmed say so. Do not probe
mutating endpoints to find out.

| Permission | Intended grant | Purpose |
| --- | --- | --- |
| Metadata | Read | Repository identity and basic metadata |
| Contents | Read/write | Read code and push task branches (intended - verify in token settings) |
| Pull requests | Read/write | Open and update pull requests (confirmed: PR #226 was opened from a sandbox) |
| Actions | Read | Runs, jobs and logs (confirmed; check-run annotations are not readable, see below) |
| Workflows | No access | Agents cannot push workflow-file changes (intended - verify in token settings) |
| Administration | No access | No settings or rules (confirmed: branch protection and secrets listing return 403) |
| Secrets and environments | No access | No credentials or production configuration (confirmed for reads) |
| Other permissions | No access unless explicitly documented | Fail closed |

**Command selection.** Prefer ordinary `gh` commands; use `gh api` for
machine-readable output or when a high-level command is incompatible with
the token. `gh api` is not read-only: GET reads, POST/PATCH/PUT/DELETE
mutate and need the same authorization as the equivalent command. Do not
try alternate routes around a denial or retry after one. Never print,
inspect, replace or refresh the token, run `gh auth token`, or start an
interactive login. Never request broader permissions for convenience.
Workflow-file commits are made and reviewed in the sandbox; Joe pushes them
from the host over SSH. `viewerPermission: ADMIN` describes Joe's account
relationship, not the token. Technical capability is not authorization.

**State-changing operations.** Push task branches and open or update PRs
when the approved task calls for it. Merge only with Joe's explicit
approval of the exact PR and reviewed head SHA. Re-running or canceling a
workflow is state-changing; never re-run a Deploy workflow without explicit
approval - it may apply D1 migrations or deploy production. Never change
branch rules, settings, environments, secrets, releases, deployments or
production resources without explicit authorization. Never force-push. An
available permission does not override any of this.

**CI monitoring.** `gh run watch` fails under this token with a 403 on
check-run annotations: a compatibility limitation, not an auth failure. Use
the Actions REST API, polling no more often than about every 30 seconds in
a bounded or background loop:

```bash
gh api repos/joes703/grampacker/actions/runs/<run-id> \
  --jq '{status, conclusion, head_sha, html_url}'
gh api repos/joes703/grampacker/actions/runs/<run-id>/jobs \
  --jq '.jobs[] | {name, status, conclusion, started_at, completed_at}'
```

**Failure classification.** `Blocked by network policy` in a body is a
Docker Sandbox network denial, not GitHub auth. 401: missing, invalid or
expired authentication. 403 from GitHub: insufficient token permission,
policy enforcement, or rate limiting - read the message and headers first.
`X-Accepted-GitHub-Permissions` names what an endpoint needs, not what the
token has. The `gh run watch` 403: switch to REST polling. A push rejected
for `.github/workflows/**`: the intentional absence of workflow-write; stop
and hand the exact commit SHA to Joe. A branch-protection rejection is not
a token problem and is never bypassed.

## 13. Checklist

- **Test:** tier by what it proves (section 2); `.node.test.ts` under
  `server/` only for pure or mocked code; jsdom only for rendering or a DOM
  API; `npm run test:api` as well as `test:unit` for anything under
  `server/`.
- **Migration:** `npm run test:migrations`; the PR says what a backfill
  wrote; the old Worker on the new schema is safe for the deploy window.
- **Workflow:** `npm run check:yaml`, `npm run check:action-pins`; the
  deploy invariants in section 11 still hold; the commit goes to Joe for a
  host-side push.
- **Done:** the complete diff read; every check named with its result and
  anything not run said so; Codex review with a `VERDICT:` line.
