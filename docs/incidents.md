# Incident log: the history behind the AGENTS.md rules

**BINDING for the platform facts it records; historical for the narrative
around them.** Read it when a rule's one-liner is not enough. An incident
explains a failure that actually happened - verify the mechanism still applies
to the current dependency versions before treating it as a live constraint.

AGENTS.md states the rules; this file holds the incidents and deep detail that
produced them. Read the section you need when a rule's one-liner is not enough.
Nothing here overrides AGENTS.md.

## Drizzle: unqualified columns inside sql`` fragments

Drizzle renders columns inside sql`` fragments UNQUALIFIED when the outer
select has a single table. A correlated subselect like
`sql`(select ${lists.id} from ${lists} where ${lists.foodPlanId} = ${foodPlans.id})``
silently becomes `(select "id" from "lists" where "food_plan_id" = "id")` -
BOTH sides resolve against the inner table and the predicate is vacuous. It
typechecks, parses, and returns wrong data (the Plans-index day/entry counts
shipped broken this way; caught 2026-07-16 by a wire-level API assertion -
page tests mock the fetcher and can never see it). Comparing an inner column
to a BOUND PARAM (`${userId}`) is safe - params render as `?`. For
outer-column correlation, use a real join (qualification turns on for the
whole query) and assert the VALUES on the wire in an API test, not just the
shape.

## Drizzle: raw SQL in db.batch() crashes the D1 driver

No longer reachable on the Node server: no repository batches since
2026-10-12 (each operation is a SQLite transaction). Kept as the record.

`db.run(sql)` / `db.all(sql)` / `db.get(sql)` typecheck as `db.batch()` items
but CRASH the D1 driver at runtime ("Cannot read properties of undefined
(reading 'bind')"): `SQLiteRaw._prepare()` returns itself with no `.stmt`,
which `d1/session.js` batch() dereferences (drizzle-orm 0.45.2; found at the
wire 2026-07-16 building the pack toggle). To get raw SQL into a batch, ride a
builder: `db.insert(t).select(sql\`select ...\`)` (renders the select verbatim
after the table's column list, in DEFINITION order - match it) or
`db.delete(t).where(sql\`...\`)` / `.update()`. Hand-write identifiers inside
such fragments (aliases like `l.id`, not `${lists.id}`) so the
unqualified-rendering trap above cannot reach them.

## D1: the queries-per-invocation limit, and what a batch counts as

Applies only to the Cloudflare Worker, which the Node server replaces; no
repository batches since 2026-10-12. Kept as the record.

As of 2026-07-16 the D1 limits table says 1000 (Paid) / 50 (Free) queries per
Worker invocation, but links that row to the Workers SUBREQUEST limits (one
`db.batch` = one call), and its batch-limits paragraph applies only per-QUERY
limits (100 params, 100KB) to each batched statement. Prefer multi-row inserts
over per-row statements to keep batch statement counts low, and treat any
failure of a large batch in prod as possibly THIS before debugging SQL. The
worst-case list duplicate has grown since this was first measured; no
maxed-out duplicate has been wire-verified in prod.

Re-checked 2026-09-10 (the engineering audit), because a comment in
`server/repos/pack-reorder.ts` had come to assert the opposite - that every
batched statement counts - and the two readings drove opposite designs
(per-row inserts in import/duplicate vs chunked multi-row writes in the pack
reorder). Evidence for the per-CALL reading: the limits table is unchanged and
still links to the subrequest limits, and the binding's own source (workerd
`src/cloudflare/internal/d1-api.ts`, `D1DatabaseSessionAlwaysPrimary.batch`)
serializes the whole statement list into ONE `fetch` to the D1 service (or
one RPC call on the JSRPC path). A subrequest is a fetch; a batch is one.
Nothing in Cloudflare's docs says the D1 service applies a separate
per-statement count. This is documentation-plus-source evidence, not a
production measurement - a maxed-out import (up to ~1,000 statements) has
still never been run in prod, so keep the multi-row habit and keep suspecting
this limit first.

Two more platform facts from the same check, recorded because nothing in the
repo says which plan the account is on (the dated planning docs say Workers
Free; treat that as the operating assumption until the dashboard says
otherwise):

- Since 2026-09-01 D1 on the Free plan FAILS queries once the account's daily
  row-read or row-write limit is hit, until midnight UTC, with the error text
  `Your account has exceeded D1's free tier daily row read limit ...` (or
  `... row write limit ...`). Every rate-limited auth request writes a row,
  `/api/health` reads on every hit, and the public share is unmetered by
  decision - so this is the first thing to check if the whole app starts
  answering 500 late in a UTC day.
- On Free the per-invocation query count is 50, not 1000. Under the per-call
  reading a request makes a handful of D1 calls and is nowhere near it.

## Env types differ between local and CI

`worker-configuration.d.ts` is generated by `wrangler types` and is NOT
committed. Locally wrangler reads `.dev.vars`, so secrets like
`BETTER_AUTH_SECRET` appear on `Env`; CI has no `.dev.vars`, so they do not.
A test that read a secret off `env` compiled locally and failed in CI
(2026-07-11). The API tests now run on Node and get a fixed configuration
from `server/test/node-env.ts`; use the value from there.

## better-auth: routes and hooks that are not what they look like

- The passkey challenge endpoint is an unauthenticated GET that writes a row,
  and `magic-link/verify` is a GET that CREATES A USER AND MINTS A SESSION.
  This is why the rate limiter is fail-closed across all methods with an
  explicit pure-read GET allowlist (`server/middleware/rate-limit.ts`).
- Removing `emailAndPassword` from config makes `/sign-in/email` 400, but
  `/reset-password` is mounted unconditionally: given a still-valid token it
  will re-create a credential account. Killing an auth method means purging
  its DATA, not just its config.
- `hooks.before` sees an UNVALIDATED body: `api/dispatch.mjs` runs
  before-hooks BEFORE the endpoint, and the endpoint is where the zod body
  schema runs. A before-hook is exactly as blind as our own Hono middleware.
  The magic-link mail quota is charged in `sendMagicLink` for this reason: it
  is the first point at which the address is known to be real
  (`server/auth.ts`; the DoS it fixes is in SECURITY.md). Do not "move it
  earlier" without re-reading dispatch.mjs.

## Hono: c.res assignment merges headers instead of replacing them

`c.res = res` does not REPLACE a response in Hono - it MERGES. The setter
copies the previous response's headers onto the new one with
`headers.set(k, v)`, so on any header present in BOTH, the OLD value wins and
your new value is silently discarded. No error, no warning. `securityHeaders`
gets away with the plain pattern only because CSP/X-Frame-Options/etc. do not
exist on the original response - which makes it a misleading model to copy.
Any middleware that CHANGES an existing header (e.g. `Cache-Control` on an
asset) must `c.res = undefined` first, then assign. Bit us in
`asset-cache.ts`; caught by CI, not by review or types (2026-07-12).

## Asset caching: 304s do not update a browser's stored cache policy

Browsers revalidate cached assets with `If-None-Match`; our asset pipeline's
`304` responses carry no `Cache-Control`, so the stored entry keeps its OLD
policy indefinitely. (RFC 9110 says a generated 304 SHOULD carry the headers
the 200 would have; this is observed behavior of the Assets binding path, not
a law of HTTP - hence the middleware.) A caching change can therefore be green
in tests, correct for new visitors, and a no-op for every existing user. If a
change must reach cached entries, force a validated `200` - see
`forceValidatedAssetResponse` in `server/middleware/asset-cache.ts`, which has
the full rationale and a regression test.

## Optimistic updates and the three meanings of an empty array

The rules live in AGENTS.md; this is the nuance behind them.

- Use `isLoadingError`, NOT `isError`: in TanStack Query v5 a failed
  BACKGROUND refetch sets status to 'error' while KEEPING the cached rows, and
  mutations invalidate constantly, so bare `isError` blanks a working page
  after any post-write blip. Use `isPending`, NOT `isLoading`: v5's
  `isLoading` is `isPending && isFetching`, so a cold load with the browser
  offline parks at fetchStatus 'paused' and reports FALSE with zero rows.
- Gate the ACTION, not just the render: page headers, mobile action bars and
  side panels routinely mount outside the render gate and stay live. Scope
  gating to collections the write is COMPUTED from. A client-side PREFLIGHT
  that the server independently enforces need not gate the write - `/gear`'s
  `listCount` defaults to 0 and is deliberately ungated, so a slow or failed
  `/api/lists` cannot take down the gear library; it blocks submission once
  resolved (`CreateListFromSelectionDialog`'s `canSubmit`).
- The resolved-data predicates prove "we have data to act on", NOT "the server
  answered": `initialData` is promoted to `status: 'success'` on construction
  (`query-core`'s `getDefaultState`), and `useReorderable` accepts it. Fine
  where the seed is authoritative (`DesktopListsPanel` gets rows from the
  parent's own resolved query); do not use these predicates on a query seeded
  with a placeholder or a guess.
- Never gate the way out: a Cancel that leaves a mode, and any action whose
  own preflight resolves the data authoritatively (`resolveRemovalPlan`), must
  stay enabled - see `MoveToLocationMenu`'s separate `locationsUnavailable`
  prop, which exists so the blanket `disabled` cannot take Remove from list
  with it.
- `makeOptimisticInsert` (`src/lib/queries/optimistic.ts`) leaves an ABSENT
  cache absent, and must keep doing so: writing a placeholder into a cache
  that never loaded flips `data` from undefined to defined - the signal every
  page reads as "resolved" - hiding a failed load behind a collection with
  only the new row. A loaded-but-empty `[]` still gets its placeholder (the
  first-list case). Absence is not emptiness.
- History: this class cost two PRs (4.1 on `/lists`, 4.2 on `/gear` and list
  detail).

## Failure feedback: the modal rule and honest error copy

The which-failures-earn-a-toast rule lives in
`src/lib/mutation-error-handler.ts`; read it before adding or removing a
toast. Supporting detail:

- `Modal.tsx` opens a native `<dialog>` with `showModal()`, which puts it in
  the browser's TOP LAYER and makes the rest of the page inert. While
  `ToastViewport` was an ordinary `z-50` element, a toast raised under an open
  modal sat behind the backdrop and expired unseen; several failures were
  silent that way. `ToastViewport` now renders inside the topmost open Modal
  (`src/lib/toast-host.ts`), which keeps the host stack in step with the
  NATIVE dialog (Escape and backdrop close it without the `open` prop
  changing, and the `close` event is queued). A `<dialog>` opened with
  `showModal()` outside `Modal.tsx` would bring the bug back.
- A write issued from a still-open modal reports inline (`saveError`), beside
  the form. Check the surface really stays put: an optimistic insert can
  unmount the component holding the error state (`ListsEmptyState` stops
  rendering when the placeholder lands, so its inline error has no owner by
  the time a rejection arrives - it reports through `meta.errorToast`, and
  `ListsEmptyState.test.tsx` pins the unmount-then-fail sequence).
- Say what you can prove: a rejected fetch never proves the server did not
  commit (the connection can drop after the write lands, and `apiFetch` also
  rejects when a 200 fails DTO validation). So "Couldn't confirm...", not
  "Couldn't delete...", and on a non-idempotent POST advise a refresh before
  retrying. This is the standard for new and touched code: the 2026-08
  remediation applied it to the gear and list-item paths and deliberately
  left list creation, list duplication, Quick Add and food creation still
  saying "Please try again"
  (`use-current-list-actions.ts`, `use-list-item-actions.ts`, and the food
  mutations in `ListDetailPage.tsx`). Sweeping those is unclaimed work; do not
  cite them as precedent.

## Migrations: the cascade wipe and why the freeze exists

drizzle-kit emits table rebuilds (`CREATE __new_x; copy; DROP x; RENAME`)
wrapped in `PRAGMA foreign_keys=OFF`. On D1 that pragma is a NO-OP: migrations
run with FK enforcement ON and the pragma cannot be toggled inside the
implicit transaction. So `DROP TABLE x` performs an implicit DELETE that fires
every `ON DELETE CASCADE` child - wiping that data in production (verified
against D1; API tests miss it because migrations run on an EMPTY db).
`defer_foreign_keys` does not help - it defers the CHECK, not the cascade
ACTION. Migration 0009 rebuilt `lists`, parent of `list_items`, and wiped it.
The grandfathered migrations had to back children up into a scratch table
before the DROP and restore after, recreating the parent's UNIQUE indexes
BEFORE the restore (or the child FK fails "foreign key mismatch"), plus any
hand-added triggers.

Why the destructive-DDL freeze: `deploy.yml` applies migrations and THEN
deploys the Worker, so in between - and indefinitely if the deploy step
fails - production runs the OLD code against the NEW schema, where a removed
or renamed object breaks it. The eventual answer is expand/contract, where the
removal lands in a later release than the code that stopped needing it.

REVISED 2026-08-19. The freeze banned drops, rebuilds and renames together,
because when it was written the rebuild had just cost this incident and the
two had not been told apart. A native `ALTER TABLE ... DROP COLUMN` is not a
rebuild: it rewrites rows in place, never issues `DROP TABLE`, and so fires no
cascade (verified against sqlite3 3.46.1 with `foreign_keys=ON` inside a
transaction). Rebuilds and renames stay banned. Column, trigger and index drops
ship one release after the code that used them has deployed. Migration 0027
cleared the backlog of dead objects.

REVISED 2026-09-26: history collapsed, harness retired. Between 2026-08 and
2026-09 `scripts/check-migration-safety.mjs` grew to about 4,500 lines. It
seeded a populated D1, replayed every post-baseline migration against it on
every run, digest-pinned the first 21 files, and carried per-migration
fixtures, expected rewrites, trigger probes and removal declarations. Most of
that weight came from re-proving shipped history on every run, and
grampacker has one production database, which had applied all 30 migrations
and whose schema matched a replay of them exactly (checked 2026-09-26). The
trade-off is explicit: a new migration is no longer proven to preserve
existing rows before merge. So:

- The 30 files became one `0000_baseline.sql`, generated from production's
  own `sqlite_master`. Production's ledger was given the baseline's name by
  hand, so it never runs it.
- The check became three things: Drizzle bookkeeping, snapshot matches
  schema, and no destructive statement in a new migration
  (`docs/testing-and-ci.md` section 7).
- What it no longer proves, that a migration preserves existing rows, is
  covered after the fact by D1 Time Travel (`docs/d1-restore.md`).
- The trigger behaviors only the harness exercised moved to the API suite
  first (#251).

## Supply chain: the npm audit fix --force incident

One `npm audit fix --force` run walked the Cloudflare toolchain back ten
months, reverted a deliberate sharp/libvips CVE fix, introduced two new
high-severity advisories via a `ws` downgrade, and left `npx wrangler` - the
binary that applies production migrations - on a different version from the
one the bundle was built with. Hence the ban. Plain `npm audit` to look is
fine.

## Supply chain: why the esbuild override is a range

Dependabot does not update `overrides`, so an exact one silently rots. Today
`@esbuild-kit/core-utils` (a deprecated transitive of drizzle-kit) asks for
`esbuild ~0.18.20`; the override lifts it to `^0.25.4`, which is drizzle-kit's
OWN range, so the two always resolve together. Pinned exactly, the next
esbuild patch would float drizzle-kit up and leave the override behind - two
versions of the same package, the nested-duplicate failure the wrangler
incident was made of.

## Action pins: the comment is checked, not trusted

`scripts/check-action-pins.mjs` resolves every pinned SHA against the upstream
tag and fails CI on a mismatch. Dependabot moves the SHA but has left the
comment reading the old major, so for one release the workflows said `# v6`
while running v7.

## Actions: a manual dispatch runs the chosen ref's copy of the workflow

`workflow_dispatch` lets the person dispatching pick a ref, and the run
executes THAT ref's copy of the workflow file with the repository's secrets
(same-repository refs receive them; forks and Dependabot do not). So a
dispatch trigger on a workflow that names a secret is a way for any branch
to run an edited privileged workflow. `deploy.yml` carried one from its
first version as the recovery path for a deploy that never fired, and the
pack-rank audit workflow (`audit-pack-ranks.yml`, dispatch-only, holding a
read-only D1 token) had the same shape. Found by Codex review 2026-09-04;
both removed the same day. The audit workflow had never been run: it gated
migration 0019's release, which shipped in August, and the triggers 0019
and 0023 installed now enforce what it probed. Migration 0019's comment
still names it - that file is frozen and cannot be edited.

Recovery without dispatch, both verified against GitHub's documentation: a
re-run (`gh run rerun`, `--failed` for just the failed jobs) keeps the
original run's `GITHUB_SHA`, `GITHUB_REF` and workflow file, so it can only
ever execute the copy on main; and re-running a CI run fires its
`workflow_run` `completed` event again (only `requested` is suppressed on
re-runs). One qualification, because `--failed` is job-granular: a Deploy
run that failed only at "Record deployment marker" has already changed
production, and re-running its deploy job would apply migrations and
deploy again - that step's own error message says not to. The marker is
repaired by hand (the same two API calls the step makes). The rule now
stands in SECURITY.md: no workflow that names a secret carries
`workflow_dispatch`. Since `deploy.yml` became legacy, no Deploy run is
re-run at all: an old run's copy of the file still deploys (its header).

## If this ever moves off D1 (self-hosted SQLite)

D1 pre-applies the SQLite settings this app's correctness depends on, so
nothing in the repo sets them. A future port to vanilla SQLite must apply
these pragmas on EVERY connection at startup:

- `PRAGMA foreign_keys = ON;` - correctness-critical. Stock SQLite defaults
  this OFF per connection; without it every cascade delete and same-owner
  composite FK silently stops enforcing.
- `PRAGMA busy_timeout = 5000;` - D1 serializes writes at the platform layer,
  so the codebase has never needed SQLITE_BUSY retry handling; self-hosted it
  will.
- `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = NORMAL;` -
  concurrent readers plus fsync savings; NORMAL is safe only under WAL.

Noted 2026-07-17: the schema is STRICT-compatible (every column is
`text`/`integer`/`real`) but tables are not declared STRICT because
drizzle-kit cannot emit it and drizzle's snapshots would not track it.
Revisit if drizzle-kit gains STRICT support.
