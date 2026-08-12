# Architecture, TDD, and code quality review

> **DATED RECORD (2026-07-31), not binding.** Raw review output. See
> `docs/review-remediation-plan.md` for what was acted on.

Date: 2026-07-31

## Executive verdict

The app is fundamentally well designed for its current size. It does not need a
rewrite. The strongest parts are the server-side authorization boundary, the use
of database constraints as correctness backstops, the shared request/response
contracts, and the unusually realistic D1 API and migration tests.

There are, however, two high-priority design flaws that should be corrected
before the app has meaningful production usage:

1. Production migrations run before the new Worker is deployed, but destructive
   or otherwise backward-incompatible migrations are neither prevented nor
   staged. A failed deploy after a successful migration can leave the old Worker
   running against a schema it cannot use.
2. Destructive food changes rely on a client-side warning computed from stale
   state. The subsequent refetch happens after the warning decision and its
   result is ignored, so concurrent work can be silently removed.

The test suite is strong at unit, component, API, authorization, and migration
levels. It is not yet a complete TDD safety net for the shipped app because it
has no real-browser end-to-end layer, no completed passkey ceremony test, no
accessibility automation, and no coverage or route-matrix enforcement.

The largest code-quality issue is concentrated rather than systemic:
`ListDetailPage.tsx` has become a 2,217-line orchestration component spanning
queries, mutations, food, drag and drop, placement, dialogs, responsive layout,
optimistic cache behavior, and rendering. Most surrounding modules are much
better factored. Put plainly, the server does not look Frankensteined. The
authenticated list workspace does show incremental bolt-on debt, especially
where food planning was attached directly to the page instead of adopting the
controller/action-hook seams already used by neighboring features.

## Scope and method

This review traced the production paths from React through the shared DTOs,
Hono middleware and routes, user-scoped repositories, Drizzle, D1 migrations,
and CI/deploy workflows. It also sampled the component, mutation, API,
authorization, migration, and security tests and reviewed the complete current
worktree state.

Verification performed during the review:

- `npm run build`: passed (typecheck, lint, Worker bundle, client bundle).
- `npm run test:unit`: passed, 94 files and 809 tests.
- `npm run test:api`: passed against workerd/D1, 19 files and 201 tests.
- `npm run test:migrations`: passed as a no-op because there are no migrations
  newer than `origin/main`.
- The worktree was clean before this report was added.

Wrangler emitted non-fatal `EACCES` messages while attempting to create its log
directory under `/home/dev/.config/.wrangler`; all commands above exited 0.

## Prioritized findings

### F1 - High: production schema changes are not deployment-safe

Evidence:

- `.github/workflows/deploy.yml:57-69` applies remote D1 migrations first and
  deploys/builds the new Worker second.
- The workflow itself says this order is safe for additive migrations and that a
  destructive migration needs a separate ordering plan, but nothing enforces
  that rule.
- `migrations/0016_remove-food-planning.sql:1-76` rebuilds `lists`, removes
  `lists.food_plan_id`, and drops ten tables.
- The Worker immediately preceding that migration still mounted food routes and
  imported repositories that queried the removed tables (commit `17a8b2e^`).
- The migration-safety harness checks data survival and schema objects. It does
  not run the previously deployed Worker against the post-migration schema.

Impact:

- Between migration and Worker deployment, the old Worker can fail on affected
  routes.
- If `npm run deploy` fails after the migration succeeds, that incompatibility
  persists until a later successful deployment or manual intervention.
- A larger future table rebuild or column rename could turn a short outage into
  a wider production failure. There is no staging environment to expose it first.

Recommendation:

- Treat expand/contract as a required release protocol, not a comment:
  introduce the compatible schema, deploy code that tolerates old and new
  shapes, backfill, switch reads/writes, and only remove the old shape in a later
  release.
- Build the exact deploy artifact before making any remote change, so build
  failure cannot occur after migration.
- Add a CI compatibility check that boots the base revision's Worker against the
  migrated branch database, or fail closed on drops/rebuilds/renames unless the
  change declares and tests a multi-release plan.
- Keep the existing populated-database migration test; it solves a different and
  valuable problem.

### F2 - High: stale confirmation can silently remove concurrent food work

Evidence:

- `src/lists/FoodSection.tsx:145-167` decides whether shortening a trip needs a
  confirmation from the currently rendered `food` snapshot.
- `src/lists/ListDetailPage.tsx:471-479` refetches only after that decision, then
  ignores the refreshed value and calls `setFoodDays` unconditionally.
- `server/repos/food.ts:149-208` deletes every slot after the requested day in an
  atomic batch, with no version, expected state, or destructive-impact
  precondition.
- `src/lists/FoodSection.tsx:225-242` has the same class of race when marking a
  currently empty slot as not needed; `server/repos/food.ts:211-263` clears all
  associations without checking what the client observed.

Concrete failure sequence:

1. Tab A renders a later day with no food and therefore plans to shorten without
   warning.
2. Tab B schedules food onto that day and commits.
3. Tab A blurs the day input. Its mutation refetches and sees Tab B's work, but
   does not recompute or re-request confirmation.
4. Tab A deletes the later slots and their associations. The user was never told
   that planned work would be removed.

This is not fixed by the current refetch; the safety decision has already been
made when the refetch occurs.

Recommendation:

- Move destructive-impact detection to the server. A safe shape is: submit the
  observed revision (or an expected set/hash), return `409` with impact details
  when it changed or when populated slots would be removed, then retry only
  after an explicit confirmation against that server result.
- Apply the same contract to marking a populated slot not needed.
- Add a workerd API test that interleaves two clients and proves stale destructive
  writes conflict instead of silently succeeding, plus a component test for the
  retry/confirmation flow.

### F3 - Medium: categories are the one unbounded user-owned collection

Evidence:

- `shared/gear.ts:19-20,66-69` bounds a category name but defines no category
  count cap.
- `server/routes/categories.ts:39-46` accepts every valid create request and maps
  no cap error.
- `server/repos/categories.ts:31-46` inserts unconditionally.
- `server/db/app-schema.ts` has no category-count trigger, while gear items,
  lists, list items, packing locations, and food items all have explicit caps.
- `server/repos/categories.ts:23-28,89-107` reads the entire collection and can
  generate one reorder statement per submitted row.

Impact:

An authenticated account can create an unbounded number of rows and make every
category fetch and ownership scan progressively more expensive. This is both a
resource-abuse gap on D1's free tier and a product failure mode for an accidental
client loop. The otherwise consistent cap model makes this omission stand out.

Recommendation:

- Choose a product cap, enforce it with a database trigger (the race-free house
  pattern), map the abort to `422`, expose the constant through the shared
  contract, and add API tests for the last allowed row, the first rejected row,
  and atomic import behavior at the boundary.

### F4 - Medium: the claimed Node/SQLite portability is not currently real

Evidence:

- `README.md:3-6` says the app is deployable to any Node + SQLite box, and
  `REWRITE_PLAN.md:168-172` calls that a proven exit hatch.
- `server/db/index.ts:1-16` accepts only `D1Database` and returns the D1 Drizzle
  driver.
- Production repositories and middleware contain 23 `db.batch(...)` call sites.
  That API and its semantics are D1-specific; a typical Drizzle SQLite driver
  exposes transactions differently.
- `server/index.ts:27-114` is typed around Cloudflare `Env`, `DB`, and `ASSETS`.
- There is no Node server entry point, SQLite driver dependency, Node migration
  runner, start command, or Node-target integration test.

Impact:

The domain schema and Hono routes are portable in spirit, but moving hosts is not
a factory swap. It requires a new database/transaction abstraction, runtime
composition root, static-file path, environment adapter, migration mechanism,
and test target. If the exit hatch is needed under time pressure, its untested
parts are exactly the risky ones.

Recommendation:

- Either describe portability as a design goal rather than a current capability,
  or make it executable.
- For the latter, define a small persistence transaction/batch boundary that has
  both D1 and Node implementations, add a Node composition root, and run the same
  repository/API contract suite against both databases in CI. A periodically
  green deployment smoke test is the only honest meaning of "proven exit hatch."

### F5 - Medium: critical browser/auth journeys are not tested end to end

Evidence:

- There is no Playwright, Cypress, Webdriver, or Vitest browser configuration in
  the project scripts or CI.
- `src/settings/PasskeySection.test.tsx` mocks `authClient.passkey` and
  `authClient.signIn.passkey`.
- Server passkey tests verify rate limits and fresh-session middleware, but no
  test completes WebAuthn registration or authentication and proves the cookie,
  passkey row, counter, and UI transition together.
- Magic-link API tests redeem tokens and component tests exercise navigation,
  but no browser test spans email link -> SPA landing -> redirect -> cookie ->
  authenticated route.
- Responsive drag/drop, focus restoration, native dialog behavior, browser
  history, caching across a deploy, and service integration are necessarily
  approximated by jsdom or tested in pieces.

Impact:

The app's only sign-in methods depend on browser security APIs, cookies, redirects,
and route transitions. Those are the areas where individually correct unit and
API pieces most often fail to compose. Passkeys in particular are a high-impact
untested production path.

Recommendation:

- Add a very small real-browser smoke suite, not a second giant test pyramid:
  magic-link sign-in, passkey registration/authentication with a virtual
  authenticator, create/edit a list, a public share read, and one representative
  mobile/keyboard packing action.
- Run it against the built app and real local Worker/D1 path.
- Add automated accessibility checks to these few stable pages and retain the
  existing role-based component assertions.

### F6 - Medium: `ListDetailPage` is an unsafe concentration of responsibilities

Evidence:

- `src/lists/ListDetailPage.tsx` is 2,217 lines.
- Its main inner component directly calls `useState` 9 times, `useMemo` 7 times,
  `useCallback` 6 times, `useEffect` 5 times, and `useMutation` 9 times, plus six
  exhaustive-deps lint suppressions.
- The component coordinates routing, last-list persistence, five data queries,
  food mutations, inventory mutations, item mutations, two reorder models,
  packing hierarchy, placement mode, responsive behavior, dialogs, confirmation
  flows, weight calculation, and most of the page rendering.
- `src/lists/ListDetailPage.tsx:1299-1311` records a known render fan-out where a
  checkbox can re-render every location section, up to the 300-item/30-location
  product caps, without a cap-sized profile.

Impact:

The pure planners and extracted action hooks are good seams, but the remaining
orchestrator is beyond the size where dependency arrays and cross-feature cache
effects are easy to audit. The six exhaustive-deps exceptions may each be
justified today; their combined maintenance cost is that future changes can
invalidate those justifications without a lint failure. The known render fan-out
also sits on the most interaction-heavy screen.

Recommendation:

- Refactor by cohesive behavior, preserving current tests: a food controller,
  packing/placement controller, detail-query gate, and dialog/action coordinator
  are plausible boundaries. Avoid splitting JSX merely to reduce line count.
- Prefer controllers that expose stable commands and derived state so the page
  does not need to know mutation lifecycle details.
- Add a cap-sized render/profile regression before choosing the packing row-action
  optimization; the source correctly notes that this should be measured.

### F7 - Medium-low: several quality policies are documented but not executable

Evidence:

- The CI workflow runs build, tests, and migration safety, but no coverage
  collection or threshold exists.
- `docs/authz-matrix.md:3-5` says every route must have a row and tests, but no
  test or lint rule compares mounted routes with that matrix. The current matrix
  appears complete; future completeness depends on review discipline.
- Response schemas are ordinary `z.object(...)` schemas rather than strict
  objects. `src/lib/api.ts:45-52` therefore rejects missing/wrong fields but Zod
  silently strips unexpected fields. The comment that all response shape drift
  fails loudly is too broad.

Impact:

The present suite is extensive (21,406 lines of tests against 29,790 lines of
production TypeScript), but raw volume does not prevent an entirely untested new
module or route. Additive response drift can also pass client validation. For a
public response, validation after receipt would not prevent a wire-level leak in
any event; the server allowlist and API tests remain the real controls. Repository
history and regression comments are consistent with test-driven work, but static
review cannot prove that every change followed strict red-green-refactor order.

Recommendation:

- Add coverage reporting with modest, ratcheted thresholds and review uncovered
  branches rather than chasing 100%.
- Make route/matrix/test completeness machine-checkable, or generate the matrix
  from route metadata that also declares auth and DTOs.
- Make response schemas strict where additive drift should fail and validate
  sensitive responses at the server boundary as well as the client boundary.

### F8 - Low: expired/revoked sessions are not reconciled by the app API layer

Evidence:

- `src/lib/api.ts:25-52` turns every non-2xx response, including `401`, into an
  ordinary `ApiError`.
- `src/App.tsx:88-101` gates the authenticated tree on better-auth's session
  store, not on API errors.
- There is no central query/error path that invalidates or refetches the auth
  session on a `401` from `/api/*`.

Impact:

When a session expires or is revoked server-side while the app is open, the UI
can remain in the authenticated shell while queries fail and mutations roll back.
Better-auth's focus refresh reduces the window but does not make the application
API and session state one coherent failure path in an active tab.

Recommendation:

- Give `rawFetch` a single 401 policy: trigger a session refresh/invalidation and
  transition to sign-in once unauthenticated state is confirmed. Test that a
  failed data query leaves neither stale authenticated chrome nor a redirect
  loop.

## Additional code-quality and DRY observations

The codebase does not have a general copy-paste problem. Several repetitions are
deliberate and valuable: route-level authorization comments are easy to audit,
DTOs explicitly allowlist fields, and concurrency-sensitive optimistic
mutations genuinely need different rollback behavior. Those should not be
collapsed into a large generic abstraction merely to reduce line count.

There are, however, four places where duplication or accreted compatibility
state now creates real maintenance risk.

### CQ1 - The list workspace is the one recognizably bolted-on area

Evidence:

- The neighboring gear, list-item, list-level, reset, and packing-location
  behaviors have dedicated hooks such as `useListItemActions`,
  `useCurrentListActions`, and `usePackingLocationActions`.
- Food is different: `src/lists/ListDetailPage.tsx:458-532` declares its query,
  invalidation callback, five mutations, error policy, and aggregate busy state
  inline. The page then adapts those mutation objects again when passing them to
  the 613-line `FoodSection`.
- `ListDetailPage` is also the compatibility junction for the retired Organize
  mode and the current Pack mode. `src/AuthenticatedApp.tsx:42-53` retains two
  legacy Organize routes, while the page performs mode derivation and rewrites.
  Preserving bookmarks is reasonable, but the compatibility behavior shares
  the same component as current feature orchestration.
- `readyChecksEnabled` is now pinned to `true` in
  `src/lists/ListDetailPage.tsx:1230-1244`, yet the inert field remains in the DB
  row, shared DTO, route mapping, export data, duplication path, and numerous
  tests. Keeping the physical column avoids a dangerous SQLite table rebuild,
  but carrying the dead concept through application contracts is a broader
  compatibility cost than the migration constraint requires.

Assessment:

This is not a reason to rewrite the screen, and the legacy redirects themselves
are good product behavior. It is evidence that features have been integrated at
the page seam faster than obsolete concepts and orchestration have been retired.
That makes the page the location where otherwise well-separated domains know
about one another's query keys, mutations, error messages, and compatibility
rules. The stale food-confirmation defect in F2 is an example of the kind of
cross-layer lifecycle error this shape makes easier.

Recommendation:

- Extract a `useFoodActions`/food controller that owns the query, destructive
  confirmation input, mutations, invalidation, error mapping, and busy state.
- Isolate legacy URL normalization before the detail workspace renders.
- Keep the physical `ready_checks_enabled` column until a safe migration is
  worthwhile, but deprecate it at one boundary and stop threading it through new
  DTO/UI code. Document the compatibility promise if old clients still require
  the field.

### CQ2 - Resource limits do not have one TypeScript source of truth

Evidence:

- `LIST_CAP` is independently declared as `100` in `shared/lists.ts:16` and
  `server/repos/lists.ts:107`.
- `LIST_ITEM_CAP` is independently declared as `300` in
  `shared/lists.ts:17` and `server/repos/list-items.ts:109`.
- `GEAR_ITEM_CAP` is independently declared as `500` in
  `server/repos/gear-items.ts:83` and `src/lib/caps.ts:21`; bulk request schemas
  also hard-code `500` in `shared/gear.ts:137-154`.
- The import row limit is `MAX_CSV_ROWS = 2000` in `src/lib/csv/core.ts:14`,
  while `shared/gear.ts:183-198` independently hard-codes `.max(2000)` and
  relies on a comment to keep the two aligned.
- Database triggers necessarily repeat the numeric limits in SQL. Comments in
  the TypeScript repeatedly say to keep values "in lockstep", but there is no
  check that proves that lockstep.

Assessment:

The database must remain authoritative, and old migration files cannot import a
TypeScript constant. That SQL duplication is unavoidable. The duplicate live
TypeScript constants and schema literals are avoidable, though, and some of the
repository exports are not the constants used to define request bounds. A limit
change can therefore update the friendly UI, request schema, repository
documentation, or trigger without updating all the others.

Recommendation:

- Put every live cap used by TypeScript in a dependency-neutral shared policy
  module and import it into schemas, repositories, and UI preflight code.
- Add a small invariant test that reads the current schema/trigger definitions
  and compares their active limits and abort messages with those shared values.
  Do not edit historical migrations to achieve this.

### CQ3 - Small boundary transformations are copy-pasted

Evidence:

- Five route modules contain 26 copies of the same JSON-read, parse, and
  `400 { error: 'Invalid request body' }` sequence.
- `server/routes/lists.ts:89-104` duplicates the complete gear-row-to-DTO
  conversion from `server/routes/gear-items.ts:46-59` for embedded list items,
  including cents-to-dollars, status parsing, and timestamp conversion.

Assessment:

This duplication has not yet produced a visible defect, and explicit per-route
schemas are preferable to magical middleware. The gear conversion is semantic
duplication, however: adding or changing a gear response field requires knowing
that the same public representation is assembled in two route files. The JSON
parsing repetition is mostly noise that makes the meaningful handler behavior
harder to scan.

Recommendation:

- Extract one typed, deliberately small JSON-schema parser that preserves the
  current uniform 400 response and leaves authorization and domain errors in
  each handler.
- Extract the gear DTO mapper into a server boundary module and use it for both
  top-level and embedded responses. Keep field-by-field mapping; do not replace
  it with object spreading from database rows.

### CQ4 - The visual component layer is only partially DRY

Evidence:

- `src/components/PrimaryButton.tsx` defines a shared primary action, but at
  least `FoodSection`, `ListDetailPage`, `GearLibraryPage`,
  `ChunkErrorBoundary`, and `PasskeySection` repeat close variants of its blue
  button class string directly.
- The same secondary-button class string is repeated across `AppShell`,
  `PasskeySection`, `DeleteAccountSection`, and `DownloadAllData`.
- Local constants in `src/auth/auth-ui.tsx` and individual pages solve the same
  styling problem within one feature, not across the application. The variants
  already differ in radius, padding, focus behavior, and disabled cursor.

Assessment:

This is a modest design-system gap rather than an architectural flaw. It does
make visual and accessibility behavior drift as new dialogs and settings panels
are added, and it is the clearest ordinary DRY failure in the JSX layer.

Recommendation:

- Add a small shared button primitive with primary, secondary, and destructive
  variants plus size options, then migrate call sites mechanically with visual
  checks. Do the same for form fields only after inventorying actual variants;
  a large general-purpose component library would be disproportionate here.

## What is designed well

### Authorization and security boundaries

- `requireSession` constructs repositories closed over the authenticated user;
  handlers cannot choose a wider user scope.
- ESLint enforces the handler/database/import boundary and disables inline
  overrides for that boundary.
- Parent-child repository methods consistently include the route parent and user
  in predicates, and the database uses composite same-owner keys or explicit
  triggers as backstops.
- Public shares use a separate anonymous repository, an `is_shared` gate, and a
  field-by-field response mapping.
- CSRF, body limits, security headers, fresh-session checks, magic-link token
  handling, and auth rate limiting are centralized and tested on real workerd.

### Data architecture

- The schema is explicit about ownership, cascading lifecycle, integer money,
  fractional weight, and SQLite's type-affinity limitations.
- Caps that exist are generally enforced by triggers rather than racy
  read-then-write checks.
- Multi-row changes are planned before one D1 batch, and many tests assert
  all-or-nothing behavior.
- The code accounts for D1's 100-bound-parameter limit through owned-set scans
  and chunked multi-row inserts.
- The migration-safety script is exceptional: it tests populated data, indexes,
  triggers, schema objects, and direct invariant probes, and it rejects edits to
  already-applied migrations.

### Test design

- API tests run the real Hono app on workerd with D1, not a mocked repository
  approximation.
- Authorization tests cover owner, non-owner, anonymous, and cross-parent cases.
- Tests frequently assert values on the wire, rollback state, exact forbidden
  fields, and production-specific error behavior.
- Complex optimistic updates and reorder planners are extracted into pure or
  focused units with concurrency-oriented tests.
- Regression comments generally explain the user-visible failure and why the
  selected test layer can catch it. This is substantially better than tests that
  merely mirror implementation branches.

### Code quality outside the main hotspot

- Shared Zod contracts keep client and server inputs aligned.
- `src/lib/api.ts` is a useful single door for CSRF, error normalization, and
  response parsing, backed by a lint rule that bans raw fetch in production SPA
  code.
- Repositories keep storage shapes out of route handlers, and routes map DTOs
  explicitly.
- The code is unusually honest about accepted trade-offs and D1/Drizzle traps.
  That institutional memory has already prevented repeat defects.

## Recommended order of work

1. Make incompatible database changes use an enforced expand/contract release
   process and build the artifact before remote migration.
2. Add server-side conflict detection for destructive food day/slot changes and
   tests with two interleaved clients.
3. Add the category cap.
4. Add one real-browser authentication and core-workflow smoke suite.
5. Decide whether Node portability is a real supported target; either implement
   and continuously test it or correct the documentation.
6. Decompose `ListDetailPage` along behavior/controller seams and profile the
   cap-sized packing view.
7. Consolidate live TypeScript resource caps and the duplicated gear DTO mapper;
   remove route-body parsing boilerplate with a small typed helper.
8. Finish the existing UI primitive layer for common button variants.
9. Ratchet coverage, route-matrix enforcement, strict response validation, and
   centralized 401 handling.

## Bottom line

The app's foundations are better than average. In particular, authorization and
database correctness were designed rather than bolted on, and the test suite
contains real adversarial thinking. The remaining major risks are at composition
boundaries the current tests do not fully own: old code versus new schemas,
concurrent browser state versus destructive writes, and browser security APIs
versus mocked components. Correcting those boundaries is a focused hardening
program, not a reason to replace the architecture.
