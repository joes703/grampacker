# Test audit after the VPS/SQLite migration

Date: October 18, 2026. Reviewed application commit: `eadb9d5`.

Revised after a second pass focused on testing application code rather than
third-party implementations, and a third pass tracing D1 workarounds through
the application and their Git history. F14 includes application changes, not
just test deletions.

This is one proposed cleanup, not a phased plan. No application code, tests,
workflows, dependencies, or deployment settings were changed for this audit.

## Assessment

The suite is using the new architecture correctly. API tests run the real
Node/Hono application, better-auth, repositories, migrations, and SQLite. They
are not passing against a simulated D1 database. Much of the detailed coverage
protects real ownership, data-loss, and stale-cache bugs and should stay.

There is still worthwhile cleanup: obsolete D1-era scenarios, tests that accept
failure as success, extensive class-string and DOM-structure assertions, and
test doubles that repeat production logic. There are also important gaps that
the large test count hides. Several deliberate, realistic defects survived the
relevant full suite.

Recommend deleting eight complete files containing 29 tests, trimming the
specific cases below, moving synthetic server tests to the cheaper tier, and
adding a small amount of useful coverage. Do not target a particular remaining
test count or coverage percentage. A smaller suite is useful when its failures
describe problems a backpacker or the operator would actually care about.

The boundary is **our decisions, callbacks, transformations, and observable
application outcomes**. Use real dependencies when needed to prove that wiring,
but trust them to implement hashing, token expiry, WebAuthn, SQL atomicity, and
ZIP compression. A dependency being on a security-sensitive path does not
justify duplicating its test suite. F2 and F13 apply that distinction to auth.

The active repositories have already shed D1's 90-ID chunks, JSON-based rank
writes, and reorder-guard writes. Remaining row caps are application policies,
not SQLite or D1 engine ceilings. Keep modest resource bounds; do not erase
them under a mistaken migration rationale. F14 identifies the actual leftovers
and distinguishes them from chunking and rank staging SQLite still needs.

Deleting those 29 tests will not, by itself, transform deployment time. The
local suites completed in seconds. Workflows repeat compilation and dependency
installation, and image readiness checks may impose avoidable waiting. Those
are better places to investigate substantial deployment savings.

## Evidence and limits

Inventory: **173 test files, 37,411 lines**. Of these, 128 files are under
`src/`, 37 under `server/`, four under `shared/`, and four under `scripts/`.
There are 144 unit-tier files and 29 API-tier files. Eighty-eight files request
jsdom; 50 use `vi.mock`. No skipped, todo, or focused-only tests were found.

The review covered the suite inventory and test descriptions, harnesses,
configs, workflows, production callers, and detailed source review of the
findings and overlapping coverage below. The appendix records a disposition
for every test file. A **Keep** entry means no specific removal or repair was
justified in this audit; it is not a claim that every assertion was individually
mutation-tested or every possible defect was ruled out.

Baseline results on Node **24.21.0**, matching the production image:

| Check | Result |
| --- | --- |
| Unit/components | 1,248 passed, zero failed |
| API/SQLite | 375 passed, zero failed |
| `npm run build` | Passed: project typecheck, lint, client and server bundles |
| `npm run test:migrations` | Passed after fetching `origin/main` |
| `deploy/test-grampacker-deploy-ssh.sh` | Passed using its local fake deploy command |
| Production image build | Blocked fetching the pinned Node image: Docker Hub HTTP 403 |
| Running-container checks | Not run because the image could not be built |
| GitHub Actions timing lookup | Unavailable: supplied GitHub credential received HTTP 401 |

YAML and action-pin checks were not run: this change edits only the audit.
The second pass repeated the full API suite for the isolated callback mutation
below; it did not repeat build, unit, migration, or container checks because
the repository change remains documentation only.

The host initially had Node 22.22.1. Dependencies were installed with `npm ci`
with install scripts still disabled. Verification used the isolated
`node-linux-x64@24.21.0` npm package, without changing repository dependencies
or the lockfile. No real configuration secrets or production database were read.

One local JSON-report interval, from report start to the last file finishing,
was approximately **12.8 seconds unit** and **4.7 seconds API**. These are local,
single-run observations, not CI timings or predicted savings. Parallel file
durations cannot be added to estimate wall time. Some costly local files were
`ListDetailPage.pack` (4.0 seconds), `ListDetailPage.edit-gear` (3.6), `FoodView`
(3.4), and `queries/keys` (3.3, including ESLint initialization).

### Deliberate breaks that remained green

Each break was made separately in an isolated copy of the tracked tree and
restored afterward. The working repository's production files were untouched.
These demonstrate testing gaps, **not defects present in production**.

| Deliberate production change | Verification that still passed | Implication |
| --- | --- | --- |
| Resend `to: msg.to` replaced with a fixed wrong recipient | Full unit and API suites: all 1,623 tests | Nothing checks the actual provider request recipient |
| Magic-link `storeToken: 'hashed'` changed to `'plain'` | Full API suite: all 375 tests | Our selected plugin option is unguarded; check the option we supply, not the plugin's hashing implementation |
| Magic-link lifetime changed from five minutes to one hour | Full API suite: all 375 tests | Our selected lifetime is unguarded; check our configuration without a token-expiry lifecycle suite |
| Disable both custom passkey user-verification checks in `server/auth.ts` | Full API suite: all 375 tests | Our own registration/authentication callbacks have no exercised enforcement proof |
| Food export `unitCount: item.unitCount` changed to `item.quantity` | Full unit suite: all 1,248 tests | Export fixtures cannot distinguish per-meal from carried quantity |
| Pack reorder returns `{ ok: true }` without doing any work | The named concurrent-reorder test passed | This individual test does not prove either reorder applied; other tests do catch no-op reorders |
| Add `void import('@dnd-kit/core')` to `SharePage.tsx` | All three share-import-graph tests passed | The bespoke graph guard misses a dependency shape it claims to reject |

## Findings and required changes

### F1. Check the real email-provider request

Files: `server/email/resend.ts`, `server/email/index.node.test.ts`,
`server/auth-error-logging.test.ts`.

Normal authentication helpers send to the console outbox. Sender-selection
tests check the chosen class. The Resend refusal test stubs `fetch` to return
422 and asserts the URL with `expect.anything()` for the request. All of that
can pass while production sends every sign-in link to the wrong mailbox.

**Change:** add one Node-tier Resend contract test with fake `fetch` returning
success. Assert the method, authorization using a synthetic key, configured
sender, intended recipient, subject, text, and HTML from a supplied message.
Assert the request as one object; do not make a separate test per field.
Keep the provider-refusal and log-redaction coverage. If testing the generated
magic-link message through the real auth endpoint, inspect the actual request
payload rather than adding another sender-instance assertion. No live email.
The existing API refusal case already tests our non-OK handling; add no matrix
of provider status codes, delivery receipts, retries, or email deliverability.

**Acceptance:** the wrong-recipient mutation above fails, as do omitted message
content and incorrect provider authorization. This touches authentication's
delivery boundary and needs extra security review during implementation.

### F2. Check our auth configuration and callbacks; trust plugin internals

Files: `server/auth.ts`, `server/test/auth-helpers.ts`, proposed Node-tier
auth-options test; contracts: `SECURITY.md`, passwordless-auth and user-
verification sections.

The helpers prove successful sign-in through a real emailed fragment token.
Account-deletion tests prove that a purged outstanding link is rejected.
Those are useful application integration checks. They do not need to become a
second better-auth lifecycle suite.

**Change:** add one compact Node-tier configuration case that calls the real
`authOptions` and captures the options supplied to the plugin factory. Mock
the database wrapper and plugin construction at that boundary; do not open
SQLite, read source text with regexes, or mirror the plugin's implementation.
Check our explicit `storeToken: 'hashed'`, five-minute `expiresIn`, and
`disableOriginCheck: false`. These are deliberate application choices with
documented consequences. Do not snapshot the whole configuration or pin every
default, callback name, and cosmetic setting.

Do **not** add tests that inspect the plugin's exact hash representation,
advance its expiry clock, repeat redemption, or race its token-consumption
implementation. Those are third-party responsibilities. Record in maintained
docs that the app chooses hashing/TTL and relies on better-auth to enforce
them; do not claim this suite independently proves atomic token consumption.

In contrast, `registration.afterVerification` and
`authentication.afterVerification` contain **our own enforcement code**. They
reject ceremonies without `userVerified`; the installed plugin does not
enforce that requirement itself. Disabling both checks in an isolated copy
left all 375 API tests passing in this second pass.

**Change:** capture those callbacks through the same plugin-factory boundary
and test each with a supplied verified and unverified result. Assert acceptance
versus our `USER_VERIFICATION_REQUIRED` error and intended status. This is two
small callback cases, without manufacturing WebAuthn keys, signatures,
authenticators, counters, or challenge storage. Do not claim direct callback
tests prove the plugin invokes them at a particular transaction boundary.

**Acceptance:** the two configuration mutations and disabling either custom
verification check fail focused Node tests. Keep successful application
sign-in through the existing helpers. Extra review applies to our auth code;
it does not require more tests of library internals.

### F3. Several auth controls accept an outage as success

Files: `server/auth-origin-validation.test.ts`,
`server/passkey-gate.test.ts`.

The trusted-origin control calls the disabled password endpoint
`/api/auth/sign-in/email` and only requires a status other than 403. Its comment
still describes bad password credentials. A 404, 429, or 500 can satisfy it.
Fresh-session, re-authentication, and stale-session rename cases in the passkey
suite also use `not 403`; the anonymous sign-in availability case excludes
401/403/404 but still accepts 500.

**Change:** combine the trusted-origin positive control with the forged-origin
case, using the live magic-link endpoint and exact 200 plus outbox message for
the positive result. Keep a cookieless forged-origin refusal, since sending
email is a side effect even without a session. Delete the separate originless
server-to-server carve-out test: it characterizes upstream CSRF behavior for
a client this browser application does not use.

For passkeys, delete the broad fresh-session probe of all plugin endpoints
and the deliberately invalid ceremony probes. Test our freshness gate with a
real seeded credential: stale delete refused, sign in again, fresh delete
succeeds, old session remains refused. Consolidate the existing separate
re-authentication/old-session cases into that story. Keep anonymous refusal
and the table of gated mutations. Fold stale-session rename into the existing
owned rename/delete scenario. Check our ungated-path allowlist in a focused
hook test; do not send malformed WebAuthn payloads to prove a plugin endpoint
answered. Retain the small owner/non-owner/anonymous credential contract, as
explained in F13.

**Acceptance:** a 500 or unavailable endpoint fails every positive control.
No browser authenticator emulator or full WebAuthn ceremony is required.

### F4. A concurrency test does not check the requested changes

File: `server/repos/pack-transactions.test.ts`, test
`concurrent reorders of the same bag both apply; neither loses a race`.

It checks two 204 responses and the sorted multiset of ranks. Any permutation,
including the original unchanged order, satisfies it. The isolated no-op
mutation confirmed that. `Promise.all` against this synchronous SQLite
transaction implementation also does not establish independent database
connections or reproduce the old distributed D1 race.

**Change:** delete this individual case. The same file's
`a failure after the first rows moved rolls every row back` already retries
successfully and checks the exact ID-to-rank result, while route tests cover
valid reorder behavior. Retain the real rollback and mixed gear/food reorder
coverage. If the overlapping-request behavior is deliberately retained as a
separate contract, replace this assertion with the exact final mapping from
one of the two valid serial executions and name its limited scope honestly.
Do not add a multiprocess concurrency framework to rescue this test.

### F5. Remove obsolete D1-era test obligations

Files: `server/routes/packing-locations.test.ts`,
`server/routes/categories.test.ts`, `server/routes/gear-items.test.ts`,
`server/routes/lists.test.ts`, `docs/authz-matrix.md`.

The packing-locations describe block still names a reorder guard and migration
0019. Its `leaves the guard table empty, and a SECOND reorder still succeeds`
test inspects `packReorderGuard`, although the current repository never writes
it. The schema explicitly marks that table unused; the food reorder guard is
also unused. Transactional checks replaced those defenses. This is not true of
the live packing-location/food delete-state tables, which triggers still use.

**Change:** delete that obsolete guard-cleanup test, its table import/helper,
and stale explanatory text. Retain rank bounds, scratch-band protection, exact
swap results, rollback, and live delete-state cleanup tests. Do not drop schema
objects or write a migration as part of test cleanup.

Several large fixtures still use **100 parameters** as the interesting
threshold: category reorder at 120, gear import at 120 category references,
gear bulk at 150, list creation/reorder at 150 items, and list import at 120
existing gear references. Current SQLite permits **32,766** bound parameters.
Crossing 100 now proves neither an actual engine boundary nor the absence of
an unbounded query.

**Change:** replace those fixtures with small, visibly distinct owned and
foreign rows that prove ordering, mixed-input ownership refusal, and no partial
writes. Consolidate duplicate success scenarios at the same endpoint. Keep
actual product row-cap tests, including the 100-list cap: a product cap is not
the obsolete parameter cap. Keep the real large-copy outcome in
`list-duplicate-size.test.ts`, whose food associations exceed the engine's
parameter budget. Trim its statement-count machinery and the helper's arbitrary
budget assertions as described in F14. Keep SQL/TypeScript-constant
synchronization tests for retained contracts.

Correct the authorization matrix's claim that current 409s report a concurrent
winner or park guard, and its attribution of real database error shapes to
`constraint-races.test.ts`. That file now stubs repository results. Describe
actual fallback conflicts and point database-error claims to real SQLite
transaction tests. Remove the lingering `100-param cap` comment in categories.

### F6. Delete tests with poor material value

These are explicit deletion recommendations, not an instruction to replace
every removed assertion with a browser test.

| Delete file | Tests | Reason and what remains |
| --- | ---: | --- |
| `src/components/DraftBadge.test.tsx` | 1 | Checks a passed `ml-2` class; draft state remains covered in the actual list surfaces |
| `src/components/RowMenuItem.test.tsx` | 1 | Checks literal responsive height classes; review shared-control density visually when changing it |
| `src/components/RowIconButton.test.tsx` | 3 | Checks size and print class strings; central control sizing remains a UI contract, verified visually on changes |
| `src/components/flat-table-styles.print.test.ts` | 13 | Checks strings inside other strings, without proving emitted CSS, paper layout, or pagination; retain `ListDetailPage.print.test.tsx` for restoring all printable content |
| `src/gear/CategorySection.alignment.test.tsx` | 5 | Pins DOM order, parent rails, and dimensions as class strings; jsdom cannot prove alignment; retain category editing tests and check keyboard access while reviewing the real header |
| `src/lists/share-path-imports.test.ts` | 3 | Approximately 190 lines implementing and defending a regex import resolver for a small bundle optimization; proven blind to direct dynamic package imports |
| `shared/health.test.ts` | 2 | Rechecks that Zod accepts a boolean and rejects a string; retain live `/api/health`, healthcheck body/timeout behavior, and running-image readiness checks |
| `server/auth-account-sql.test.ts` | 1 | Records and parses the SQL of an internal better-auth account read; this passwordless app has no account-model hooks or password/OAuth account rows; retain observable account deletion and our purge/cascade tests (F13) |

Some class/structure tests can catch real presentation regressions. The
recommendation is a judgment about their low impact and maintenance cost, not
a claim that they can never fail. Deleting them accepts less automated
protection for those cosmetic changes. Keep the density, print, and keyboard
access requirements; use a targeted visual check when changing those surfaces.
For share bundle changes, inspect the emitted bundle when relevant instead of
building a more sophisticated custom parser or a new performance platform.

**Policy change needed with implementation:** `docs/testing-and-ci.md` section 6
currently allows deletion only for obsolete behavior, a named equivalent at the
same boundary, or inability to catch a realistic defect. Several deletions
above are a broader value decision requested by the owner. Amend that policy
to allow a documented low-material-value decision with the accepted gap and
appropriate manual check. Do not mislabel a cosmetic test as impossible to fail
just to fit the existing wording. This audit proposes the policy change; it
does not silently change the binding document.

### F7. Trim structural assertions from useful component suites

Keep these files and their behavior tests. Remove only the named assertions:

| File | Trim | Preserve |
| --- | --- | --- |
| `src/layout/AppShell.test.tsx` | Exact settings-icon dimensions and repeated breakpoint class checks | Navigation destinations, settings access, and actual drawer behavior |
| `src/lists/CurrentListHeader.test.tsx` | Draft badge parent-element identity and rename opacity strings | Heading, draft meaning, rename and menu actions |
| `src/lists/ListViewNav.test.tsx` | Separator child order/test IDs and repeated CSS per mode | Real destinations and selected/current view |
| `src/lists/CategoryGroup.test.tsx` | One-line-box and explicit-font-role class assertions | Category totals, filtering, and meaningful controls |
| `src/lists/ItemRow.test.tsx` | Literal print classes | Editing weight must not toggle packed state; quantities and actions |
| `src/lists/ListDetailPage.pack-food.test.tsx` | Weight typography token substring | Real food checkbox mutation and combined gear/food progress |
| `src/lists/LibraryPanel.test.tsx` | Reserved mark-column DOM structure | Whether gear is already on the list and whether it can be added |
| `src/document-head.test.ts` | SVG MIME-attribute and nonempty-description assertions | One cheap check that referenced icons exist, so SPA fallback does not return HTML as an image |

The document-head file currently starts jsdom for three markup checks. Reduce
it to a small Node file/asset check if that stays simple; do not introduce an
HTML parsing framework just to avoid one jsdom file. Keep accessibility
assertions about reachable, named controls even when the adjacent layout
assertions go away.

### F8. Export coverage assumes shared food only

File: `src/lib/export/food-json.test.ts`.

The only populated example has `quantity: 1`, `isPerMeal: false`, and
`unitCount: 1`. Its weight calculation uses `quantity`, although the exported
carried count is `unitCount`. The implementation currently exports correctly;
the deliberately broken count passed the full unit suite.

**Change:** keep the shared-across-meals example and add one per-meal item:
quantity two, assigned to three slots, carried unit count six. Assert the
exported authored fields, six carried units, and one serialized item with slot
references. Use `unitCount` when demonstrating carried weight. Keep the current
slot allowlist and empty-export behavior; these define a real file contract.

**Acceptance:** changing exported `unitCount` to `quantity` fails. Avoid a test
for every exported property in a separate case; one representative document is
clearer and stronger.

### F9. Mocks leave gaps between UI actions and HTTP requests

Files: `src/lib/queries/packing-locations.test.ts`,
`src/lists/use-current-list-actions.test.ts`, repeated UI fixtures.

Packing-location query tests exercise only create. The fetch, rename, delete,
and reorder wrappers are mocked in their component/hook callers. Server tests
do not exercise those client wrappers. The other layers being green therefore
does not prove their URL, method, or body wiring.

**Change:** extend the existing transport suite with one compact table for the
remaining operations, checking actual fetch URL/method/body and successful
response handling. Reuse `api.test.ts` for shared CSRF/error behavior rather
than retesting every header/error combination for every wrapper. Alternatively,
exercise the real wrappers from the existing action tests with fake fetch;
choose one boundary and avoid duplicate assertions at both.

The current-list-actions suite reimplements `nextListSortOrder` and an
optimistic placeholder while trying to test their lifecycle. Use the real
cheap pure helpers and keep mocks at network/navigation boundaries. Preserve
the existing onMutate-before-mutationFn regression proof and unmount behavior.

Some UI fixtures use broad casts to claim incomplete or stale data are valid
DTOs, including `shareSlug` instead of `slug`. Replace repeated list/gear/item
fixtures in the affected suites with a few small typed factories and explicit
overrides, using `satisfies` or return types. Keep intentionally malformed
fixtures explicit. Do not turn this into a universal fixture-builder framework
or a repository-wide production refactor.

### F10. Synthetic server cases run in the integration tier

Files: `server/middleware/error-handler.test.ts`,
`server/middleware/security-headers.test.ts`,
`server/repos/constraint-races.test.ts`.

About 19 error-handler cases construct a small Hono app with synthetic errors;
they do not need the real app or SQLite. The first **three** security-header
tests inspect a pure header map. The four constraint-races cases test pure
mapping or route modules with stubbed repositories. Their API suffix gives the
wrong impression of database integration.

**Change:** move the synthetic cases to `*.node.test.ts`, retaining their
assertions and real Hono behavior where applicable. Keep real Drizzle failures
and app-level error/header wiring in the API tier. Keep the remaining four
security-header cases against the real API/error/404/SPA paths. Split shared
test helpers only as needed; do not extract production code just to move tests.

Update the matching `PARKED.md` entry when implemented. Its trigger is now met;
its count of four pure security-header tests should be three. Moving cases
reduces unnecessary setup but is not a proven CI saving. The D1-shaped SQL
adapter in `server/test/node-env.ts` is a small convenience wrapper over real
SQLite, not a fake database. Use native SQLite calls in new tests, but do not
rewrite every existing setup call just to remove its old syntax.

### F11. Avoid confusing repetition with useful boundary coverage

In `src/lib/queries/sort-keys.test.ts`, combine the sparse-maximum and
order-independence examples using one unsorted sparse input per helper; keep
the empty case. Keep each live helper represented. Leave the two small CSV
deduplication-key tests and `packRowName` checks alone: they are cheap and
meaningful enough, and deleting every tiny test would create work without
material savings. There is not evidence here for deleting whole categories
of regression tests.

Retain these protections:

- Owner, non-owner with real foreign rows, anonymous, and wrong-parent API
  cases. Distinct endpoints are distinct authorization boundaries.
- Raw public-share allowlists, CSRF-before-auth ordering, real session/auth
  middleware, rate-limit budgets, cookie/token log redaction, and account purge.
- Real SQLite foreign keys, pragmas on file-backed connections, triggers,
  migration rules, deployed-migration immutability, and parameter chunking.
- Multistatement rollback for import, duplicate, quick-add, reorder, and bag
  deletion. Test-only aborting triggers are useful failure injection here.
- Shared versus per-meal food totals, quantities, CSV injection/compatibility,
  cost parsing, actual user caps, and exports that preserve user data.
- Loading/error/write gating, visible modal failures, rejected-promise
  ownership, unmount cleanup, and optimistic update rollback/invalidation.
  Repeated-looking component cases often exercise different live callers.
- Grouping and memoized-reference tests where a stale identity suppresses a
  render. These can protect real stale UI despite looking implementation-heavy.
- Observable account deletion, erasure of our content, and our verification
  purge hooks. The separate internal account-query recorder is removed under
  F13; internal adapter query success is not itself an application feature.
- The mutation-key prefix invariant and lint-rule behavior in `queries/keys`.
  This file is relatively costly because it loads type-aware ESLint, but the
  cache-invalidation failure it guards is real. Optimize initialization only
  with measurements, rather than deleting the gate for being complicated.

Keep the food test `delete: a failure in the cascade keeps the item and every
placement` and gear test `bulk delete: a failure in the list-item cascade keeps
every gear row and membership`. They partly exercise SQLite's own statement
atomicity, but also assert the real endpoint's refusal and dependent-row state.
There is no demonstrated same-endpoint replacement for that combined proof.
Likewise, retain the distinct constraint-error catches: one helper unit test
does not prove every route uses it correctly. The recommendation is to trim
the specific obsolete or weak cases identified above, not these mixed suites
as a group.

Do not add blanket browser E2E, property-based, snapshot, or load-test tiers as
part of this cleanup. A future cross-layer bug that existing tiers cannot
express can justify one targeted browser test. The absence of a browser tier
is not itself a finding for this application.

### F12. Streamline CI work before blaming the test count

Files: `.github/workflows/ci.yml`, `.github/workflows/image.yml`, `Dockerfile`,
`scripts/check-image.sh`.

Observed work, not measured GitHub durations:

| Path | Current repeated work |
| --- | --- |
| Pull request | Verify installs dependencies, typechecks/lints/builds, and runs tests. A separate parallel job installs Docker build/runtime dependencies and compiles the client/server again |
| Manual publish/deploy | Pre-publish installs dependencies, typechecks/lints/builds, runs unit/API/migrations; then a new runner builds the Docker image, installing full and production dependencies in separate stages and compiling client/server again |
| Main push before manual dispatch | Verify runs again; the later dispatch repeats validation of its selected commit |

Tests do **not** run inside the Dockerfile. The duplicate work is compilation
and installation, plus separate workflow validation. On pull requests, parallel
job durations are not added together to determine elapsed time.

**Change together with the test cleanup:**

1. Keep local `npm run build` intact. In host CI verification, run typecheck,
   lint, tests, and migration checks; let the mandatory image build perform
   client/server compilation. Preserve the required `Verify` check and require
   the image check for landing. Update the documented workflow contract.
2. Add persistent Docker layer caching on ephemeral runners. Keep cache writes
   restricted to trusted main jobs; pull requests may read appropriate caches
   without gaining publish or deploy credentials. Pin any added Actions.
   Continue checking the actual image that is subsequently published by digest.
3. Cancel superseded **pull-request validation** runs. Scope cancellation so
   main publishing and production deployment retain their current noncanceling
   behavior. Do not cancel an in-progress deploy to save CI time.
4. Investigate startup readiness latency. The image healthcheck interval is
   30 seconds with a 20-second start period; `check-image.sh` starts and waits
   for healthy servers twice. It polls every second, but polling does not
   schedule Docker health probes. Measure the observed first-probe timing;
   the 30-second steady-state interval alone does not establish startup latency,
   and newer Docker engines can already use a shorter default start interval.
   If startup probes cause a meaningful wait, set a short health **start
   interval** on a supported Docker version, keeping the actual shipped
   healthcheck and normal steady-state interval. No 60-second saving has been
   demonstrated here.
5. Batch independent runtime filesystem/package inspections in
   `check-image.sh` into fewer one-off containers where straightforward. Keep
   non-root execution, real native SQLite, explicit migrations, startup refusal
   before migrations, restart persistence, read-only filesystem, log redaction,
   and secret/source exclusion. Exact filesystem listings and every absent
   tool are lower-value than those behaviors, but some encode deliberate
   security policy; do not remove them without checking/updating that policy.
6. Run the cheap local SSH forced-command regression script in CI when its
   wrapper/test changes. It currently relies on manual invocation. Keep the
   existing targeted deployment rehearsal for deployment configuration changes;
   do not rehearse the whole VPS on every ordinary application change.

As a secondary simplification, action-pin network verification and pipx/YAML
setup can be limited to relevant workflow, Dependabot, linter, checker-script,
and dependency/runtime-input changes. Keep required jobs reporting a result;
do not introduce path filters that strand required checks. Measure their cost
before spending much implementation effort on that optimization.

Keep one complete pre-publish validation of the dispatched commit for now.
Do not skip tests simply because the branch is main or a previous PR was
green. Reusing a prior result safely requires the exact commit and complete
required checks; that redesign is unnecessary for this cleanup. Deployment
remains owner-dispatched and no audit action should operate on the VPS.

### F13. Second-pass decisions at third-party boundaries

This pass traced assertions to the code responsible for the result, rather
than treating every dependency-related test as essential because it mentions
security. It also checked non-auth boundaries: SQLite, Zod, TanStack Query,
Markdown rendering, native dialogs, and ZIP export. These decisions are part
of the same cleanup.

| Area | What belongs to us | Decision |
| --- | --- | --- |
| Magic-link storage/lifetime | Passing our selected plugin options | One configuration case under F2. No new hash, expiry, replay, atomic-consume, cookie-signing, or token-format suite |
| Passkey verification | Our two `afterVerification` rejection callbacks | Two small direct callback cases under F2. Trust the library's signature/challenge/attestation/counter machinery |
| Passkey freshness | Our deny-by-default hook and exemptions | Consolidate actual stale/fresh behavior; remove malformed-plugin-input probes under F3. No upstream error-code catalog |
| Credential ownership | The effective access policy of our mounted app | Keep one compact owner/non-owner/anonymous contract for rename/delete/list. Drop assertions of unused library-specific error wording; preserve status, unchanged foreign rows, and own-row success |
| Auth origin checks | Our explicit configuration and exposing an email-sending endpoint | Two application cases: trusted/forged origins and cookieless forged send. Delete the upstream originless carve-out case |
| Account deletion | Our identity header, erasure schema, and before/after purge hooks | Keep their real-app tests. Delete the supplied-password case and internal account-SQL recorder described below |
| Email adapter | Selecting our sender and building/handling an HTTP request | Keep one sender-selection table, one request-contract test, and existing API error/redaction proof. No live-provider delivery tests |
| Markdown | Our configured untrusted-content surface and custom external-link renderer | Reduce four cases to one representative unsafe-markup smoke check and one external-link behavior case. Do not enumerate the library's protocol/sanitization rules |
| Zod response handling | Our `deepStrict` walker and the behavior of our API wrapper on malformed responses | Keep these. Delete the trivial boolean-schema suite under F6; add no general Zod acceptance/rejection catalog |
| TanStack Query | Our optimistic transforms, rollback, cancellation calls, and invalidation choices | Keep tests that execute those helpers. Do not test QueryClient get/set mechanics in isolation; using a real QueryClient as a fixture is appropriate |
| SQLite | Our connection setup, schema/trigger rules, migration runner, and repository atomicity | Keep integration outcomes. Add no generic SQL semantics suite; do not treat real SQLite use as testing third-party internals |
| Native dialogs | Our open/close wiring, dismissal rules, focus override, and toast host | Keep callback/wiring tests. A jsdom shim is test setup, not proof of browser focus trapping, top-layer rendering, or Escape implementation |
| ZIP export | Our file contents, filenames, fetch behavior, and download action | Keep the existing fflate mock boundary. No ZIP algorithm, compression ratio, or round-trip library tests |

Specific additional cuts:

- **Delete `server/auth-account-sql.test.ts` (one test).** It proxies SQLite,
  records the SQL better-auth emits during deletion, parses quoted identifiers,
  and checks them against `pragma_table_info`. It can catch schema drift, but
  its justification is an internal account read whose failure the library
  swallows before skipping account-model hooks. This app registers no such
  hooks: `databaseHooks` covers `user` only, and supported passwordless sign-ins
  create no password/OAuth `account` rows. Keep
  `auth-delete-user.test.ts` for completed deletion, sessions, our cascades,
  bystander preservation, and our verification purges. Accept less diagnostic
  coverage of this unused internal read. If a future feature introduces real
  account records or hooks, test that feature's observable behavior then.
- **Delete `refuses to resurrect a password: a supplied password is rejected,
  not honored` from `server/auth-delete-user.test.ts`.** It supplies a password
  to a passwordless app, omits our required account-identity header, and asserts
  the plugin's `CREDENTIAL_ACCOUNT_NOT_FOUND` path. It does not prove our
  passwordless cutover, password-route disabling, or identity check. Keep the
  real identity-header refusals and passwordless deletion scenario. Existing
  credential/reset-token absence rules remain; do not replace this with tests
  of upstream password validation or password hashing.
- **Delete the originless carve-out case from
  `server/auth-origin-validation.test.ts`.** Keep the two application cases
  described above. Record that originless server-to-server authentication
  behavior is delegated to better-auth, rather than a locally tested feature.
- **Consolidate `server/email/index.node.test.ts`.** Its six tests mostly
  repeat the same missing-key branch across origins. Use a small selection
  table for configured key, local development without a key, and a nonlocal
  origin without a key; the last must reject without logging or recording a
  token. Drop the separate empty-key, second-public-host, and malformed-origin
  variants. Our existing API tests retain real failure correlation/redaction
  for missing configuration and a refused provider request.
- **Trim `src/components/MarkdownContent.test.tsx` from four cases to two.**
  Keep one representative rendered document containing unsafe markup and a
  dangerous link, to catch an unsafe change to our renderer configuration.
  Keep our custom external-link target/rel behavior separately. Drop the
  separate `data:` protocol case. Remove its stale comment claiming auth
  tokens are in localStorage: this app uses better-auth session cookies.

Some retained tests execute third-party code. Their reason to exist must be a
named application outcome or our configuration/callback, not a desire to
verify the library itself. Preserve the small HTTP authorization contract
because the repo explicitly requires proof of the app's access boundary.
Neither "third party" nor "security" is a blanket deletion or retention rule.

For the implementation's policy update, add this test-ownership rule to
`docs/testing-and-ci.md`. Update the magic-link matrix row and `SECURITY.md`
to distinguish configured guarantees and reliance on better-auth from behavior
independently tested here. Do not remove the guarantees themselves. F1's
provider request, F2's few settings/callbacks, and the existing sign-in helpers
provide the intended auth/email scope; no new auth lifecycle framework.

### F14. Remove D1 leftovers from the app without removing real SQLite safeguards

Files: `server/repos/chunk-ids.ts`, `server/repos/pack-reorder.ts`,
`server/repos/packing-locations.ts`, `server/repos/gear-items.ts`,
`server/db/app-schema.ts`, `shared/gear.ts`, `shared/lists.ts`,
`shared/food.ts`, `src/lib/csv/import-plan.ts`, and related tests/docs.

This pass inspected active callers and the commits that introduced the limits.
It found **no active 100-parameter restriction or 90-ID chunking helper left to
undo**. Removing all remaining batching or row bounds would discard safeguards
that still have a purpose on the VPS.

| Mechanism | Current status | Recommendation |
| --- | --- | --- |
| D1's 100-bound-parameter ceiling; 90-ID chunks | Removed from ordinary bulk, reorder, import, and food writes; no active `MAX_IDS_PER_STATEMENT`/`chunkIds` callers | Retire the old threshold fixtures and descriptions in F5. Do not add a new chunk layer to these already bounded requests |
| D1 `batch` rank writes, JSON-encoded ID/rank input, census guard writes | Replaced by synchronous immediate transactions and checked writes | Keep the transaction implementation; remove obsolete guard tests and claims |
| `_pack_reorder_guard` and `_food_pack_reorder_guard` tables | Unused schema declarations; no active writes | Leave these empty inert tables in this cleanup. Deleting them has no runtime benefit and would require an explicit exception to the repo's no-`DROP TABLE` rule; remove test obligations, not migration history |
| `_packing_location_delete_state` and `_food_location_delete_state` | Live SQL-trigger state for correct orphan reranking | Keep. Similar names do not make these unused reorder guards |
| Temporary negative pack ranks | Live two-stage updates avoid collisions with SQLite's unique indexes | Keep staging, exact final order, rollback, and scratch-range protection; a transaction alone does not defer unique-index checks |
| `chunkForParamCap` during list duplication | Real SQLite parameter bound: 200 food items × 90 slots × four parameters = 72,000, above 32,766 | Keep the small table-width-based splitter. Its quarter-limit margin is conservative, not a surviving D1 limit; no measured reason to tune it |
| Skip reranking doomed rows during parent-list/account deletion | Avoids repeated updates to rows the same cascade will delete | Keep the linear deletion path. Its migration comment mentions D1's 30-second timeout, but redundant work is still redundant on SQLite |
| Owned-ID query plus JS `Set` membership | Simple scoped scans inside the write transaction, bounded by current app caps | Keep unless a measured problem or a cap change justifies a targeted query. This is not an obsolete database API that needs rewriting |

The history supports these distinctions. `fa4eb79` introduced the D1 90-ID
splitter; `50804f2` removed the D1 transaction workarounds. Gear/list storage
caps existed separately (`9d1bace`, `92d7022`). Category cap commit `7b2de25`
closed repeated-import category growth, but also used the API's existing
500-entry reorder limit to justify the storage cap. That second argument is
circular: an implementation's request limit is not an engine storage limit.

**Row-cap disposition:** retain the following values as explicit, modest
storage/response/work bounds for this small app. This is a recommendation to
keep a product policy, not a claim that SQLite requires the values or that
each exact number has been performance-tuned. No evidence found here requires
raising them for the migration, and no reported user operation exceeds them.

| Scope | Current cap and enforcement | Decision |
| --- | --- | --- |
| Categories / gear inventory | 500 each per user; insert triggers, import schemas and client preflight | Retain; document bounded account growth as the reason, not D1 or the reorder schema |
| Lists | 100 per user; insert trigger | Retain as a resource policy; the number 100 is unrelated to D1's parameter ceiling |
| Gear on a list | 300 per list; insert trigger | Retain; also bounds pack operations and negative scratch ranks |
| Packing locations | 30 per list; insert trigger | Retain as a UI/resource bound |
| Food entries | 200 per list; insert trigger | Retain; also bounds food pack operations and scratch ranks |
| Trip days / meal slots | 30 days; `day_number` CHECK and request schema; three meals gives 90 slots | Retain as the current trip-length policy. Ninety slots is a derived domain count, not 90-ID D1 chunking |
| Quantity / committed pack rank | 9,999 / 1,000,000,000; request and DB bounds | Retain as value/algorithm contracts; neither is a D1 row cap |

The 128 KB request-body bound and 90-per-day global email budget are also
unrelated to D1: they bound request work and paid-provider usage. Keep them.
Do not infer that a VPS makes request or account growth free.

**Concrete application work in the same cleanup:**

- Correct `shared/lists.ts`'s `PACK_RANK_MAX` explanation. It describes parking
  above the maximum and an exact guard-table check; current repositories park
  at `-1, -2, ...` and check writes in a transaction. Keep the actual rank
  bounds and copied-constant tests. Correct other obsolete explanations in
  the affected files; do not rewrite shipped migration SQL just to remove a
  historical D1 timeout comment. Preserve its current linear-cascade reason
  in maintained documentation or beside the schema's trigger explanation.
- Remove the duplicate `GEAR_ITEM_CAP = 500` from
  `server/repos/gear-items.ts`. The live route and UI already use the shared
  constant; the repository declaration has no runtime consumer. Point the
  nearby explanation to the shared contract and update any test imports.
  Keep the DB trigger as final enforcement. This is one source of truth for
  the app's policy, not a new abstraction for all limits.
- Fix both inventory-cap messages in `src/lib/csv/import-plan.ts`.
  Splitting an import into smaller batches cannot solve
  `existing inventory + new items > 500`. Advise reducing the new entries or
  deleting unused inventory; smaller batches still hit the same total cap.
  Category advice to reuse existing categories is meaningful and may stay.
- Update the retained limits' maintained explanation to distinguish resource
  policy, request bounds, rank requirements, and real engine constraints.
  Do not leave D1 as a rationale for current behavior.

**Test work:** keep the real SQLite large-copy test, but remove its SQL
`prepare` proxy and assertions for an exact chunk count or at most ten
statements. Those pin the current quarter-budget knob. Assert successful copy,
preserved associations, and source preservation; other duplication cases
already prove copied values and ownership. Keep the fixture large enough that
one food-association INSERT would exceed 32,766 parameters. In
`chunk-ids.node.test.ts`, remove the separate test pinning 8,191 and the
quarter-limit ratio. Retain a compact example for splitting without lost or
reordered rows, and the omitted-JS-default-column regression. Test the
configured budget's safety, not the exact choice of margin. The installed
SQLite limit check stays because our query budget relies on that build
assumption; it is not an invitation to test SQLite generally.

Keep an actual DB refusal at each retained cap and meaningful import rollback
coverage. Avoid multiplying the same cap into a separate test for every
number, UI label, and SQL error string. Copied SQL/constants need a focused
consistency check; end users need correct refusal and useful advice.

If implementation deliberately changes a cap, finish **all** of its effects in
that same change: shared/request schemas (including literal 500 reorder/bulk
bounds and import maxima), UI controls and import preflight, repository scans
and `inArray` budgets, DB trigger/CHECK, scratch-range triggers, duplication
size, messages, tests, and maintained docs. Increasing storage while leaving a
smaller full-reorder request bound would make some valid collections impossible
to reorder. Removing bounds while retaining whole-account scans would change
their cost. Generate any necessary migration; never edit the shipped baseline
or rebuild a table casually. A trigger-only cap change can use a generated
custom migration; the food day CHECK is a different schema constraint.

**Acceptance:** no current test or comment treats 100 parameters as the VPS
limit. Ordinary operations use the simple bounded SQLite paths already in
place. A genuinely over-limit food copy still succeeds whole. Ownership,
atomic rollback, pack swaps, and account deletion still work. Obsolete guard
tables require no tests or operational attention. The application changes
above ship with the test cleanup, not as a later D1-removal phase.

## Completion criteria for the one cleanup

- Apply the explicit deletions, targeted trims, focused auth configuration and
  callback checks, stronger export assertions, transport coverage, tier moves,
  and F14's application/comment/import-message changes together. Name retained
  coverage when consolidating behavior tests; record accepted presentation gaps
  honestly.
- Update `docs/testing-and-ci.md` for the material-value deletion policy,
  test ownership at dependency boundaries, in-memory API isolation, and workflow
  changes. Update `docs/authz-matrix.md` for current conflict behavior and actual
  auth test evidence, and `SECURITY.md` for the distinction between our tested
  configuration/callbacks and delegated library enforcement. Remove the completed
  tier-move entry from `PARKED.md`. Update `AGENTS.md`/`SECURITY.md`/UI rules only
  where the resulting implementation or accepted risk changes their claims.
- For new coverage of existing behavior, see it pass, deliberately break the
  protected behavior, see the expected failure, and restore production code.
  For any behavior fix discovered during implementation, follow the existing
  failing-test-first rule. Do not smuggle unrelated production fixes into test
  cleanup without identifying them.
- Read the complete diff. Run build, unit, API, and migration checks. Run YAML
  and action-pin checks for workflow changes, plus the required shell/deployment
  checks for any affected deployment files. Build and check the actual image
  when registry access is available; report a blocked check explicitly.
- Obtain CI timings when GitHub access works. Compare at least two before and
  two after runs on the same runner class, separating verification, image build,
  image check, and deployment. Report maintenance savings separately from
  measured elapsed-time savings. No speed claim based only on fewer tests.
- Remove this audit after its recommendations are resolved. Put enduring rules
  and accepted risks in maintained policy, and only genuinely deferred ideas
  with a real trigger in `PARKED.md`; Git retains this record.

## Review handoff to another sandbox

The report branch is `audit/tests-vps-2026-10-18`. A sandbox with repository
access can retrieve it without relying on this sandbox's filesystem path:

```bash
git fetch origin audit/tests-vps-2026-10-18
git show FETCH_HEAD:docs/audits/2026-10-18-test-audit.md > /tmp/grampacker-test-audit.md
```

Use a clean checkout of that fetched commit to reproduce the audit baseline;
do not overwrite another sandbox's working changes. Read `AGENTS.md` and
`CLAUDE.md`, use Node 24 and `npm ci`, then run `npm run build`,
`npm run test:unit`, `npm run test:api`, and `npm run test:migrations`
(fetch `origin/main` for the last). These use fixed test configuration; no
production credentials or database are needed. The failures-to-catch table
records temporary mutations in an isolated copy, not defects to reproduce by
altering a shared checkout. Recreate those probes only in a disposable copy.

Review this as one complete proposal. The owner requested the report before
authorizing implementation; producing this document does not apply the fixes,
approve a merge, or dispatch a deployment.

## File-by-file disposition

**Keep** means retain meaningful coverage, not certify perfection. **Trim**
means keep the file and remove only identified low-value or redundant cases.
**Strengthen**, **Move**, and **Delete** refer to the findings above. No deletion
is implied for a file merely because it has many tests or mocks.

| File | Disposition | Basis |
| --- | --- | --- |
| [`scripts/check-migration-immutability.test.ts`](../../scripts/check-migration-immutability.test.ts) | Keep | F11: migration safety or copied SQL/TypeScript constants |
| [`scripts/migration-rules.test.ts`](../../scripts/migration-rules.test.ts) | Keep | F11: migration safety or copied SQL/TypeScript constants |
| [`scripts/pack-rank-constants.test.ts`](../../scripts/pack-rank-constants.test.ts) | Keep | F11: migration safety or copied SQL/TypeScript constants |
| [`scripts/quantity-bounds.test.ts`](../../scripts/quantity-bounds.test.ts) | Keep | F11: migration safety or copied SQL/TypeScript constants |
| [`server/auth-account-sql.test.ts`](../../server/auth-account-sql.test.ts) | Delete | F13: internal adapter SQL read without app account-model hooks or supported account rows |
| [`server/auth-delete-user.test.ts`](../../server/auth-delete-user.test.ts) | Trim | F13: drop supplied-password plugin probe; keep our identity, purge, and cascade behavior |
| [`server/auth-error-logging.test.ts`](../../server/auth-error-logging.test.ts) | Keep | F1/F11: real failures and secret redaction; inspect provider payload if extending |
| [`server/auth-origin-validation.test.ts`](../../server/auth-origin-validation.test.ts) | Trim / strengthen | F3/F13: two live app cases; drop originless upstream carve-out |
| [`server/db/sqlite.test.ts`](../../server/db/sqlite.test.ts) | Keep | F11: actual file-backed SQLite settings and limits |
| [`server/email/index.node.test.ts`](../../server/email/index.node.test.ts) | Trim + extend boundary | F1/F13: three selection states; one Resend request-contract test nearby |
| [`server/healthcheck.node.test.ts`](../../server/healthcheck.node.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/middleware/asset-cache.test.ts`](../../server/middleware/asset-cache.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/middleware/body-limit.test.ts`](../../server/middleware/body-limit.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/middleware/client-ip.node.test.ts`](../../server/middleware/client-ip.node.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/middleware/csrf.test.ts`](../../server/middleware/csrf.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/middleware/error-handler.node.test.ts`](../../server/middleware/error-handler.node.test.ts) | Keep | F10/F11: cheap error/log behavior; destination for synthetic cases |
| [`server/middleware/error-handler.test.ts`](../../server/middleware/error-handler.test.ts) | Split / move | F10: synthetic cases to Node; retain actual app/SQLite cases |
| [`server/middleware/rate-limit.test.ts`](../../server/middleware/rate-limit.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/middleware/security-headers.test.ts`](../../server/middleware/security-headers.test.ts) | Split / move | F10: first three pure cases to Node; keep four integration cases |
| [`server/node.test.ts`](../../server/node.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/passkey-gate.test.ts`](../../server/passkey-gate.test.ts) | Trim / strengthen | F3/F13: consolidate our freshness gate; drop malformed plugin probes; retain access contract |
| [`server/passkey-rp-id.node.test.ts`](../../server/passkey-rp-id.node.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/repos/chunk-ids.node.test.ts`](../../server/repos/chunk-ids.node.test.ts) | Trim | F14: retain real splitting/default-column regression; drop exact quarter-budget knob |
| [`server/repos/constraint-races.test.ts`](../../server/repos/constraint-races.test.ts) | Move / rename | F5/F10: synthetic mapping, not a database race |
| [`server/repos/db-errors.node.test.ts`](../../server/repos/db-errors.node.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/repos/food-transactions.test.ts`](../../server/repos/food-transactions.test.ts) | Keep | F11: multistatement rollback and actual endpoint refusal/cascade behavior |
| [`server/repos/gear-transactions.test.ts`](../../server/repos/gear-transactions.test.ts) | Keep | F11: import atomicity and actual endpoint refusal/cascade behavior |
| [`server/repos/list-duplicate-size.test.ts`](../../server/repos/list-duplicate-size.test.ts) | Trim | F5/F14: keep real over-limit copy outcome; drop SQL proxy/exact statement count |
| [`server/repos/list-transactions.test.ts`](../../server/repos/list-transactions.test.ts) | Keep | F11: actual multistatement rollback and error mapping |
| [`server/repos/lists-slug.node.test.ts`](../../server/repos/lists-slug.node.test.ts) | Keep | F11: real runtime/security behavior or focused server unit boundary |
| [`server/repos/pack-transactions.test.ts`](../../server/repos/pack-transactions.test.ts) | Trim | F4/F11: delete false-green concurrency case; preserve multistatement rollback |
| [`server/routes/categories.test.ts`](../../server/routes/categories.test.ts) | Trim | F5: shrink obsolete parameter-threshold fixture |
| [`server/routes/food-packing.test.ts`](../../server/routes/food-packing.test.ts) | Keep | F11: actual routes, ownership, DTOs, or middleware boundary |
| [`server/routes/food.test.ts`](../../server/routes/food.test.ts) | Keep | F11: actual routes, ownership, DTOs, or middleware boundary |
| [`server/routes/gear-items.test.ts`](../../server/routes/gear-items.test.ts) | Trim | F5: smaller bulk/import ownership examples; retain actual caps |
| [`server/routes/lists.test.ts`](../../server/routes/lists.test.ts) | Trim | F5: smaller threshold fixtures; retain caps, ownership, and ordering |
| [`server/routes/me.test.ts`](../../server/routes/me.test.ts) | Keep | F11: actual routes, ownership, DTOs, or middleware boundary |
| [`server/routes/packing-locations.test.ts`](../../server/routes/packing-locations.test.ts) | Trim | F5: delete unused reorder-guard case; keep live trigger/state rules |
| [`server/routes/response-contracts.test.ts`](../../server/routes/response-contracts.test.ts) | Keep | F11: actual routes, ownership, DTOs, or middleware boundary |
| [`server/routes/session-gate.test.ts`](../../server/routes/session-gate.test.ts) | Keep | F11: actual routes, ownership, DTOs, or middleware boundary |
| [`server/routes/shares.test.ts`](../../server/routes/shares.test.ts) | Keep | F11: actual routes, ownership, DTOs, or middleware boundary |
| [`shared/deep-strict.test.ts`](../../shared/deep-strict.test.ts) | Keep | F11: meaningful data/schema/privacy invariant |
| [`shared/food-unit-count.test.ts`](../../shared/food-unit-count.test.ts) | Keep | F11: meaningful data/schema/privacy invariant |
| [`shared/gear-cost.test.ts`](../../shared/gear-cost.test.ts) | Keep | F11: meaningful data/schema/privacy invariant |
| [`shared/health.test.ts`](../../shared/health.test.ts) | Delete | F6: trivial schema assertion; retain real health boundaries |
| [`src/app-routes.test.tsx`](../../src/app-routes.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/auth/MagicLinkPage.test.tsx`](../../src/auth/MagicLinkPage.test.tsx) | Keep | F11: sign-in/account flows and visible failure handling |
| [`src/auth/SignInPage.test.tsx`](../../src/auth/SignInPage.test.tsx) | Keep | F11: sign-in/account flows and visible failure handling |
| [`src/auth/auth-errors.test.ts`](../../src/auth/auth-errors.test.ts) | Keep | F11: sign-in/account flows and visible failure handling |
| [`src/components/ChunkErrorBoundary.test.tsx`](../../src/components/ChunkErrorBoundary.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/components/DraftBadge.test.tsx`](../../src/components/DraftBadge.test.tsx) | Delete | F6: passed-through class |
| [`src/components/InlineText.test.tsx`](../../src/components/InlineText.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/components/MarkdownContent.test.tsx`](../../src/components/MarkdownContent.test.tsx) | Trim | F13: one renderer-safety smoke and our external-link behavior; correct stale auth comment |
| [`src/components/Modal.test.tsx`](../../src/components/Modal.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/components/RowIconButton.test.tsx`](../../src/components/RowIconButton.test.tsx) | Delete | F6: presentation strings; accept visual review |
| [`src/components/RowMenuItem.test.tsx`](../../src/components/RowMenuItem.test.tsx) | Delete | F6: literal height classes |
| [`src/components/Toast.modal.test.tsx`](../../src/components/Toast.modal.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/components/WeightInput.test.tsx`](../../src/components/WeightInput.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/components/flat-table-styles.print.test.ts`](../../src/components/flat-table-styles.print.test.ts) | Delete | F6: token containment rather than rendered print |
| [`src/document-head.test.ts`](../../src/document-head.test.ts) | Trim / cheaper tier | F7: retain only simple icon-file integrity |
| [`src/gear/BulkActionsToolbar.test.tsx`](../../src/gear/BulkActionsToolbar.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/gear/CategorySection.alignment.test.tsx`](../../src/gear/CategorySection.alignment.test.tsx) | Delete | F6: layout proxies; retain editing and keyboard checks |
| [`src/gear/CategorySection.rename.test.tsx`](../../src/gear/CategorySection.rename.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/gear/GearItemRow.test.tsx`](../../src/gear/GearItemRow.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/gear/GearLibraryPage.bulk-actions.test.tsx`](../../src/gear/GearLibraryPage.bulk-actions.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/gear/GearLibraryPage.save-errors.test.tsx`](../../src/gear/GearLibraryPage.save-errors.test.tsx) | Keep | F11: resolved-data gating and recoverable visible failures |
| [`src/gear/GearLibraryPage.search-reorder.test.tsx`](../../src/gear/GearLibraryPage.search-reorder.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/gear/use-gear-bulk-actions.test.tsx`](../../src/gear/use-gear-bulk-actions.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/gear/use-gear-category-actions.test.tsx`](../../src/gear/use-gear-category-actions.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/gear/use-gear-item-actions.test.tsx`](../../src/gear/use-gear-item-actions.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/layout/AppShell.test.tsx`](../../src/layout/AppShell.test.tsx) | Trim | F7: remove dimensions/breakpoint strings; retain navigation |
| [`src/layout/RootRedirect.test.tsx`](../../src/layout/RootRedirect.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/layout/mobile-action-bars.test.tsx`](../../src/layout/mobile-action-bars.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/layout/nav-order.test.ts`](../../src/layout/nav-order.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/layout/session-cache-guard.test.tsx`](../../src/layout/session-cache-guard.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/layout/sidebar-drawer-context.test.tsx`](../../src/layout/sidebar-drawer-context.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/layout/use-sign-out.test.tsx`](../../src/layout/use-sign-out.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/lib/api.test.ts`](../../src/lib/api.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/csv/core.test.ts`](../../src/lib/csv/core.test.ts) | Keep | F11: user data conversion, compatibility, or export boundary |
| [`src/lib/csv/gear.test.ts`](../../src/lib/csv/gear.test.ts) | Keep | F11: user data conversion, compatibility, or export boundary |
| [`src/lib/csv/import-plan.test.ts`](../../src/lib/csv/import-plan.test.ts) | Keep | F11: user data conversion, compatibility, or export boundary |
| [`src/lib/csv/list.test.ts`](../../src/lib/csv/list.test.ts) | Keep | F11: user data conversion, compatibility, or export boundary |
| [`src/lib/csv/sort-keys.test.ts`](../../src/lib/csv/sort-keys.test.ts) | Keep | F11: live Unicode deduplication and distinct field semantics |
| [`src/lib/csv/units.test.ts`](../../src/lib/csv/units.test.ts) | Keep | F11: user data conversion, compatibility, or export boundary |
| [`src/lib/export/food-json.test.ts`](../../src/lib/export/food-json.test.ts) | Strengthen | F8: realistic per-meal carried count |
| [`src/lib/export/takeout-files.test.ts`](../../src/lib/export/takeout-files.test.ts) | Keep | F11: user data conversion, compatibility, or export boundary |
| [`src/lib/gear-status.test.ts`](../../src/lib/gear-status.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/grouping.test.ts`](../../src/lib/grouping.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/last-list-path.test.ts`](../../src/lib/last-list-path.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/mutation-error-handler.test.ts`](../../src/lib/mutation-error-handler.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/passkey-authenticator-names.test.ts`](../../src/lib/passkey-authenticator-names.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/queries/food.test.ts`](../../src/lib/queries/food.test.ts) | Keep | F9/F11: client HTTP contract and distinct document/pack endpoints |
| [`src/lib/queries/gear-list-items-fan-out.test.ts`](../../src/lib/queries/gear-list-items-fan-out.test.ts) | Keep | F9/F11: client HTTP contract and distinct document/pack endpoints |
| [`src/lib/queries/gear.test.ts`](../../src/lib/queries/gear.test.ts) | Keep | F9/F11: client HTTP contract and distinct document/pack endpoints |
| [`src/lib/queries/keys.test.ts`](../../src/lib/queries/keys.test.ts) | Keep | F11: prefix collision and configured lint-rule enforcement |
| [`src/lib/queries/list-items.test.ts`](../../src/lib/queries/list-items.test.ts) | Keep | F9/F11: client HTTP contract and distinct document/pack endpoints |
| [`src/lib/queries/lists.test.ts`](../../src/lib/queries/lists.test.ts) | Keep | F9/F11: client HTTP contract and distinct document/pack endpoints |
| [`src/lib/queries/optimistic.test.ts`](../../src/lib/queries/optimistic.test.ts) | Keep | F9/F11: client HTTP contract and distinct document/pack endpoints |
| [`src/lib/queries/packing-locations.test.ts`](../../src/lib/queries/packing-locations.test.ts) | Strengthen | F9: cover live wrappers hidden by caller mocks |
| [`src/lib/queries/sort-keys.test.ts`](../../src/lib/queries/sort-keys.test.ts) | Trim | F11: combine sparse and order-independent input; keep empty cases |
| [`src/lib/report-failure.test.ts`](../../src/lib/report-failure.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/session-hint.test.ts`](../../src/lib/session-hint.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/session-revalidation.test.ts`](../../src/lib/session-revalidation.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/toast-host.test.ts`](../../src/lib/toast-host.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/use-commit-once.test.tsx`](../../src/lib/use-commit-once.test.tsx) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/use-grouped-list-items.test.tsx`](../../src/lib/use-grouped-list-items.test.tsx) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/use-reorderable.test.ts`](../../src/lib/use-reorderable.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/use-stable-worn-items.test.tsx`](../../src/lib/use-stable-worn-items.test.tsx) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/weight-breakdown.test.ts`](../../src/lib/weight-breakdown.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lib/weight.test.ts`](../../src/lib/weight.test.ts) | Keep | F11: calculation, cache identity, session state, or failure ownership |
| [`src/lists/AddFoodForm.test.tsx`](../../src/lists/AddFoodForm.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/AddItemRow.test.tsx`](../../src/lists/AddItemRow.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/CategoryGroup.test.tsx`](../../src/lists/CategoryGroup.test.tsx) | Trim | F7: remove layout/font strings; retain totals and controls |
| [`src/lists/CurrentListHeader.test.tsx`](../../src/lists/CurrentListHeader.test.tsx) | Trim | F7: remove parent identity/opacity assertions |
| [`src/lists/DesktopListsPanel.delete.test.tsx`](../../src/lists/DesktopListsPanel.delete.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/FoodCarryingList.test.tsx`](../../src/lists/FoodCarryingList.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/FoodDaySection.test.tsx`](../../src/lists/FoodDaySection.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/FoodSlotPicker.test.tsx`](../../src/lists/FoodSlotPicker.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/FoodView.test.tsx`](../../src/lists/FoodView.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/InlineTitle.test.tsx`](../../src/lists/InlineTitle.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ItemRow.test.tsx`](../../src/lists/ItemRow.test.tsx) | Trim | F7: remove print class check; keep actual edit/packed behavior |
| [`src/lists/LibraryPanel.test.tsx`](../../src/lists/LibraryPanel.test.tsx) | Trim | F7: remove reserved-column structure; retain add/on-list behavior |
| [`src/lists/ListDetailPage.category-footers.test.tsx`](../../src/lists/ListDetailPage.category-footers.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListDetailPage.detail-failure.test.tsx`](../../src/lists/ListDetailPage.detail-failure.test.tsx) | Keep | F11: resolved-data gating and recoverable visible failures |
| [`src/lists/ListDetailPage.edit-gear.test.tsx`](../../src/lists/ListDetailPage.edit-gear.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListDetailPage.food.test.tsx`](../../src/lists/ListDetailPage.food.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListDetailPage.lists-failure.test.tsx`](../../src/lists/ListDetailPage.lists-failure.test.tsx) | Keep | F11: resolved-data gating and recoverable visible failures |
| [`src/lists/ListDetailPage.locations-failure.test.tsx`](../../src/lists/ListDetailPage.locations-failure.test.tsx) | Keep | F11: resolved-data gating and recoverable visible failures |
| [`src/lists/ListDetailPage.notes.test.tsx`](../../src/lists/ListDetailPage.notes.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListDetailPage.pack-food.test.tsx`](../../src/lists/ListDetailPage.pack-food.test.tsx) | Trim | F7: remove typography assertion; retain food mutation and progress |
| [`src/lists/ListDetailPage.pack.test.tsx`](../../src/lists/ListDetailPage.pack.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListDetailPage.pending-container.test.tsx`](../../src/lists/ListDetailPage.pending-container.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListDetailPage.print.test.tsx`](../../src/lists/ListDetailPage.print.test.tsx) | Keep | F6/F11: restores filtered/collapsed content for printing |
| [`src/lists/ListImportPreviewDialog.test.tsx`](../../src/lists/ListImportPreviewDialog.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListSettingsPanel.lifecycle.test.tsx`](../../src/lists/ListSettingsPanel.lifecycle.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListSettingsPanel.test.tsx`](../../src/lists/ListSettingsPanel.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListViewNav.test.tsx`](../../src/lists/ListViewNav.test.tsx) | Trim | F7: keep destinations and selected view |
| [`src/lists/ListsEmptyState.test.tsx`](../../src/lists/ListsEmptyState.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/ListsPage.test.tsx`](../../src/lists/ListsPage.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/MoveToLocationMenu.test.tsx`](../../src/lists/MoveToLocationMenu.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/PackLocationSection.test.tsx`](../../src/lists/PackLocationSection.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/PackingProgress.test.tsx`](../../src/lists/PackingProgress.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/PrivacyPanel.test.tsx`](../../src/lists/PrivacyPanel.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/SharePage.test.tsx`](../../src/lists/SharePage.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/WeightTable.test.tsx`](../../src/lists/WeightTable.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/add-food-preview.test.ts`](../../src/lists/add-food-preview.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/list-card-sortable.test.tsx`](../../src/lists/list-card-sortable.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/list-detail-mode.test.ts`](../../src/lists/list-detail-mode.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/list-detail-reorder-planning.test.ts`](../../src/lists/list-detail-reorder-planning.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/list-item-removal.test.ts`](../../src/lists/list-item-removal.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/list-unit-control.test.tsx`](../../src/lists/list-unit-control.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/pack-reorder-exclusions.test.ts`](../../src/lists/pack-reorder-exclusions.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/pack-rows.test.ts`](../../src/lists/pack-rows.test.ts) | Keep | F11: actual union ordering and rank planning; tiny name checks are cheap |
| [`src/lists/packing-dnd.test.ts`](../../src/lists/packing-dnd.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/packing-grouping.test.ts`](../../src/lists/packing-grouping.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/packing-tree.test.ts`](../../src/lists/packing-tree.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/pick-list-after-delete.test.ts`](../../src/lists/pick-list-after-delete.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/placement-context.test.tsx`](../../src/lists/placement-context.test.tsx) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/placement-plan.test.ts`](../../src/lists/placement-plan.test.ts) | Keep | F11: retain user behavior; do not delete solely for suite size |
| [`src/lists/share-path-imports.test.ts`](../../src/lists/share-path-imports.test.ts) | Delete | F6: custom graph with a proved blind spot |
| [`src/lists/use-current-list-actions.test.ts`](../../src/lists/use-current-list-actions.test.ts) | Simplify setup | F9: real pure helpers and valid fixtures; keep lifecycle assertions |
| [`src/lists/use-list-flag-toggle.test.tsx`](../../src/lists/use-list-flag-toggle.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/lists/use-list-food.test.tsx`](../../src/lists/use-list-food.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/lists/use-list-gear-actions.test.tsx`](../../src/lists/use-list-gear-actions.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/lists/use-list-item-actions.test.tsx`](../../src/lists/use-list-item-actions.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/lists/use-list-reset-actions.test.tsx`](../../src/lists/use-list-reset-actions.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/lists/use-packing-location-actions.test.ts`](../../src/lists/use-packing-location-actions.test.ts) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/lists/use-quick-add-form.test.tsx`](../../src/lists/use-quick-add-form.test.tsx) | Keep | F11: distinct action lifecycle, cache, or rejected-promise boundary |
| [`src/settings/DeleteAccountSection.test.tsx`](../../src/settings/DeleteAccountSection.test.tsx) | Keep | F11: sign-in/account flows and visible failure handling |
| [`src/settings/DownloadAllData.test.tsx`](../../src/settings/DownloadAllData.test.tsx) | Keep | F11: sign-in/account flows and visible failure handling |
| [`src/settings/PasskeySection.test.tsx`](../../src/settings/PasskeySection.test.tsx) | Keep | F11: sign-in/account flows and visible failure handling |
| [`src/settings/SettingsModal.passkeys.test.tsx`](../../src/settings/SettingsModal.passkeys.test.tsx) | Keep | F11: sign-in/account flows and visible failure handling |
| [`src/settings/SettingsModal.test.tsx`](../../src/settings/SettingsModal.test.tsx) | Keep | F11: sign-in/account flows and visible failure handling |
