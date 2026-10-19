# Code-quality remediation plan (2026-10-19, v2)

Remediation plan for `docs/code-quality-review-2026-10-18.md` (the
Codex-validated findings inventory). Finding ids (A1, K2, ...) refer to that
document. v2 incorporates Codex's adversarial review of v1 in full; the
material changes are: K1 narrowed to the FK branch only, config/CI cleanup
split out of Phase 1, the auth cache given a concrete feasible scope and its
own PR, `satisfies` dropped as a D7 option, Phase 4 split into presentation
vs concurrency PRs, the description-clearing fix extended to the write
boundaries, Phase 6 re-classified into mechanical moves vs designed
extractions with characterization tests first, and every previously orphaned
finding given a disposition.

Phases ship in order as separate PRs. Phases 4–6 repeatedly touch the same
page and row surfaces, so they are strictly sequential; earlier phases are
independent of each other except where a dependency is named.

## Ground rules (apply to every phase)

- **Tests first for behavior changes** (AGENTS.md): write the failing test,
  see it fail for the stated reason, make it pass. Pure refactors keep the
  existing suites green; "suite unchanged" is regression protection, not a
  ban on adding tests where a moved contract lacks coverage.
- **No behavior change unless the phase names it.** The complete named list:
  K1 (FK defects 500 instead of 400), K2 (retry copy), K3 (checker catches
  quoted `uses:`), D2 (food's three `'Invalid request'` become
  `'Invalid request body'`), E2 (food weight one-decimal bound), E6 (food
  empty-patch message changes AND `{field: undefined}` patches become
  rejected), description clearing (InlineText `allowEmpty` plus
  empty-string→`null` at both write boundaries), `GearOptionsButton` gaining
  the shared menu's viewport flip/clamp behavior when it adopts `KebabMenu`,
  FoodView busy granularity (contract to be defined in Phase 5 before
  implementation), GearItemRow's selection-mode editability rule (decided in
  Phase 5 before the failing test) and its description-column alignment fix
  (Phase 5.7), and the removal of the `preview` npm script (Phase 1b.2).
  Anything else observable is a defect.
- **Comment policy:** in files a phase touches, strip historical framing
  while keeping the current failure mechanism. No standalone sweep; whatever
  remains after Phase 6 is accepted unless the owner orders a dedicated,
  separately reviewed sweep.
- **Protected guarantees** (sharpened per Codex): what is protected is each
  *coordination guarantee*, not the current code shape —
  - add-category: atomic coordination of editor sessions with dialog
    replacement, and `mutateAsync` settlement ownership
    (`GearLibraryPage.tsx:82,252`). A controlled extracted editor may satisfy
    this; independent state + a departure effect cannot.
  - `CategoryGroup`: the public/authenticated food-channel boundary (`:235`)
    and the discriminated children/progress contract (`:300`).
  - Reorder repos: visible ownership checks and immediate-transaction
    boundaries; the drizzle-generics reason (`gear-items.ts:350`) stands
    unless a shared helper proves simpler types with equally visible checks.
  - Auth: per-request `AuthIncident` isolation (`auth.ts:75,100` — the
    options close over the holder; `onAPIError` writes into that object).
  - `Modal`: aria-only `title` stays backward compatible; opt-in chrome is
    allowed but the new X button must honor `preventDismiss`, and focus
    handling, toast hosting, and the content structure backdrop detection
    relies on must be preserved — "aria unchanged" alone is too narrow.
  - `ListDetailPage`'s deliberately un-memoized packing derivations
    (990–1059): the documented lint constraint beside them is an
    implementation constraint, not a profiling question.
- **Gates per phase:** `npm run build` + `npm run test:unit`; `test:api` for
  anything under `server/`; `check:yaml` and `check:action-pins` whenever
  workflows or the checker scripts change; full diff read before claiming
  done. Codex reviews each phase's diff before its PR opens.
- **Authz surface:** any change to a route's status codes updates
  `docs/authz-matrix.md` and its tests in the same commit.
- **Revertibility:** each extraction lands as its own commit, revertible
  without unwinding the phase.

---

## Phase 1 — Bugs, dead code, rotted comments (small PR)

Goal: everything wrong today, none of it structural, none of it config.

1. **K1 — stop classifying FK failures as client errors, narrowly.** The
   single catch in `server/repos/packing-locations.ts:~198` maps four
   conditions; **delete only the `isForeignKeyViolation` branch** (and its
   now-unused import), preserving `cap_exceeded`, `already_container` (which
   has no equivalent precheck in this method), and the same-list trigger
   mapping. Whether the same-list trigger should also be treated as a defect
   is out of scope — recorded as an open question in the findings doc (K1),
   not changed here. Tests, at the API boundary with real SQLite (the
   `food-transactions.test.ts:199` pattern): inject a real FK failure after
   prechecks pass and assert HTTP 500 + transaction rollback, covering BOTH
   named-location creation (where today's classification wrongly implicates
   a container that was never supplied) and container creation; keep the
   existing client-error-path tests green at their actual status codes
   (ownership 404, duplicate container 409, cap 422 —
   `routes/packing-locations.ts:43`).
2. **K2 — fix the unsafe retry copy.** `use-current-list-actions.ts:90`
   adopts the "Couldn't confirm the list was created. Refresh to check
   before retrying." wording `ListsEmptyState.tsx:21` already uses. Test
   first (component test asserting the copy). Consolidating the two create
   implementations is Phase 5.
3. **K3 — action-pin checker catches quoted `uses:`.** Extend the regex in
   `scripts/check-action-pins.mjs:42` to accept single/double-quoted values.
   Test first: fixture lines `uses: "actions/checkout@v4"` and
   `uses: 'actions/checkout@v4'` must be reported unpinned (today both are
   silently skipped). Gate: run `check:action-pins` itself.
4. **D1 — interpolate cap constants** into the remaining hardcoded error
   strings (`gear-items.ts:107,171`, `lists.ts:160,162,192,221,247,250,
   258,269`, `food.ts:61`, `packing-locations.ts:48`). Pure refactor; the
   rendered strings must not change — existing route tests pin them.
5. **E1 — caps.ts stops hand-copying bounds.** Export named constants
   (`MAX_NAME_LENGTH`, `MAX_DESC_LENGTH`, `MAX_CATEGORY_NAME`,
   `MAX_ITEM_WEIGHT_GRAMS`) from `shared/` where the zod literals live,
   build the schemas from them, make `src/lib/caps.ts` re-export — the
   pattern its own `MAX_LIST_ITEM_QUANTITY` comment prescribes. (Dependency
   for Phase 3.)
6. **H2 — delete genuinely dead code:** `packRowLocationId`,
   `packRowIsPacked` (`pack-rows.ts`), the `PackContainerSection`/
   `PackPlainSection` re-export (`PackLocationSection.tsx:219`),
   `rowsPerStatement` (`chunk-ids.ts`), `isAnyUniqueViolation` + its tests +
   misleading comment (`db-errors.ts:56-63`), the `isLegacyListPath` alias,
   `useAnchoredMenu`'s dead `right-anchored` variant (default: delete;
   Phase 4's `KebabMenu` re-adds a variant only if `GearOptionsButton`'s
   geometry needs one), and fold `selectPackGrouping` into its only wrapper
   (`packing-grouping.ts`) or un-export it.
7. **G2 — rotted comments:** dedupe the doubled drag-handle paragraph
   (`CategorySection.tsx:199-216`); fix the dangling `DECISIONS.md`/ADR
   citations (`GearLibraryPage.tsx:456,460`) by inlining the live rule or
   deleting; retire the stale "phase 2" note in `auth-ui.tsx` (visual
   convergence itself goes to PARKED.md unless Phase 4 tokens make it a
   two-line adoption); fix the "Used by MobileMenu" ghost in
   `use-anchored-menu.ts`.

Explicitly NOT in this phase (moved out per review): E2 (now Phase 3, it is
schema behavior), all config/CI items (now Phase 1b).

Risk: low. K1 is the only API-behavior change and is fully test-covered.

## Phase 1b — Config and CI cleanup (separate small PR)

Split from Phase 1 because these have different failure modes (dev startup,
compiler settings, workflow execution) and deserve their own review.

1. **Rename `vite.node.config.ts` → `vite.client.config.ts`.** All known
   references must move together: the `dev` and `build:client` npm scripts,
   `server/dev.ts:49`, and the `tsconfig.node.json:25` include list (v1
   wrongly claimed one reference). Verification: `npm run build` AND a real
   `npm run dev` startup check — build alone does not prove dev works.
2. **Delete the orphan `preview` script** (`package.json:21`).
3. **Drop the `.superpowers` eslint ignore** (`eslint.config.js:8`).
4. **`check:yaml` pin convergence:** move the yamllint version pin into the
   npm script and have CI call `npm run check:yaml`, or document in ci.yml
   why CI stays inline. Gate: run `check:yaml`.
5. **tsconfig strictness:** add `noImplicitReturns` (and
   `noUnusedLocals`/`noUnusedParameters` if the tree is clean under them) to
   `tsconfig.node.json`, or add a comment stating why a flag stays off.
6. **ci.yml ↔ image.yml verify duplication (J):** decide and record — either
   extract a reusable workflow (weighing the pinning/permissions overhead the
   findings doc notes) or add a load-bearing comment in BOTH files stating
   the copies must move together and why they are copies. Deferral with a
   reason is an acceptable outcome; silence is not.
7. **H3 (scripts):** drop dead `export` keywords in `scripts/`
   (`currentDefinitions` in `schema-sql.ts`, `FORBIDDEN` in
   `migration-rules.mjs` if truly in-file-only).

Risk: low-medium (dev-startup regression is the real hazard; it is named and
verified).

## Phase 2 — Mechanical server consolidation (one PR)

Goal: collapse route/repo boilerplate. Pure refactors except D2's named
wording change. The API suite is the net; add tests where a new shared
helper's contract (schema output typing, defaults, malformed-JSON handling,
middleware ordering) lacks direct coverage.

1. **D2 — `parseBody(c, schema)` helper** for all 25 sites. Named behavior
   change: food's three `'Invalid request'` become `'Invalid request body'`
   — update food route tests first. The helper must preserve each site's
   schema output type and the malformed-JSON → 400 path; add a direct test
   of the helper.
2. **D3 — one gear response mapper** (`toGearItemResponse` shared; delete
   `toEmbeddedGear`).
3. **D5 — one `ownsList(tx, userId, listId)`** next to `reposForUser`,
   replacing the three copies, one authoritative comment.
4. **D7 — food write routes get an explicit field-by-field mapper.** NOT
   `satisfies` — Codex is right that `satisfies` checks assignability and
   strips nothing at runtime, so it does not create the visible allowlist
   the finding is about. Keep raw-JSON response-contract assertions.
5. **D9 — unify cap-failure mapping:** extend the `listItemFailure` switch
   pattern over the four list-write if-chains and the gear import copy.
6. **D10 — one append-at-max idiom:** extract the
   `coalesce(max(sortOrder)+1, 0)` fragment into a shared repo helper (or a
   documented single pattern) and convert food's JS read-then-add to it, so
   sibling repos stop solving one problem two ways.
7. **D11 — small items:** authz-matrix header + visible-gate comment in
   `routes/packing-locations.ts`; narrow `GearWriteResult` per method so cap
   errors cannot map to 404; extract the `withFreshSlug` cap-catch wrapper
   inside `repos/lists.ts`; dedupe the suppression-announcement JSON in
   `error-handler.ts`; inline `nextPackSortOrderInCohort` keeping its
   comment.
8. **D6 — reorder consolidation, conditional:** attempt one shared
   owned-set reorder helper; it lands only if types are simpler and the
   ownership check stays as visible (protected guarantee). Otherwise keep
   the five copies and write one comment that covers all five sites.
9. **H3 (server/shared):** drop `export` from symbols used only in-file in
   the files this phase touches.

Risk: low-medium; wide but shallow, all behind the API suite.

## Phase 2b — Auth instance caching (own small PR, flagged authn)

Separated from Phase 2 per review: an authn-path change must not be buried
in mechanical consolidation.

Concrete scope (the only approach Codex confirmed feasible with the current
wiring): cache ONE instance constructed **without** an incident holder, keyed
on the env object (WeakMap, like the Drizzle cache), and use it only for
`requireSession` (`session.ts:20` already passes no holder). `/api/auth/*`
keeps per-request construction with its per-request holder. Make the
distinction explicit in `createAuth`'s API (e.g. separate
`sessionAuth(env)` vs `createAuth(env, incident)`) so a request-bound
instance cannot enter the cache. Do NOT attempt to thread a mutable holder
around a cached instance — concurrent requests would overwrite each other's
incident; any broader cache waits for a real request-local design with its
own isolation proof.

Tests (new, focused — existing suites passing does not prove cache
semantics): same-env reuse returns the same instance; distinct envs get
distinct instances; the `/api/auth/*` path retains per-request incident
correlation. If the explicit API split turns out not to be cleanly
achievable, drop the phase and record it in PARKED.md with the rationale and
a revisit trigger (e.g. "when auth-path latency is measured as a problem, or
when better-auth's API makes request-local context cheap").

Risk: medium (authn). Mitigation: smallest possible diff, dedicated review.

## Phase 3 — shared/ schema primitives (one PR)

Depends on Phase 1's exported constants. Independent of Phase 2.

1. **Primitives module** (leaf, like `shared/decimal.ts`): `idSchema`,
   `tempIdSchema`, `uniqueIds`, a shared `nonEmptyPatch` refine, and
   bounds-derived schemas — but **only genuinely identical shapes are
   extracted**: food names cap at 128, gear/list names at 256,
   packing-location names at 60 (v1's generic "name schema" would have been
   an unnamed behavior change). Distinct contracts keep distinct schemas
   built from named constants.
2. **E5 — parameterize the import relational-integrity refine** so
   `lists.ts` reuses `gear.ts`'s logic for both halves; dedupe the
   thrice-repeated worn/consumable refine. The 400-message strings must not
   change — pinned by existing import tests.
3. **E2 — food weight gets the one-decimal bound** (`shared/food.ts:87` →
   `decimalNumber({min:0, max:100000, decimals:1})`). Named behavior change,
   test first at the schema level; PR notes stored >1-decimal values remain
   readable — this gates new writes only.
4. **E6 — one empty-patch idiom.** Named behavior change, and tested at the
   **schema level**, not via HTTP copy (after D2 the HTTP response for an
   invalid body is the generic `'Invalid request body'`, so the refine
   message is not observable over HTTP): `{}` rejects with the chosen issue
   message; `{name: undefined}` flips from accepted to rejected (this
   explicit-`undefined` rejection is part of the named change, even though
   JSON clients cannot encode it); a defined field still passes.
5. **A4 — split `shared/lists.ts`** into lists / shares / list-import
   modules. Pure moves; `deep-strict.test.ts` and the share tests pin the
   DTOs; keep re-exports from `shared/lists.ts` if it keeps the diff
   smaller.
6. **H3 (shared):** drop in-file-only `export`s in files touched.

Risk: low-medium; the response-contract and import suites are the net.

## Phase 4a — Shared UI presentation primitives (one PR)

Phase 4 is split per review: presentation shells and concurrency machinery
do not share one landing decision. 4a is presentation only.

1. **B1 — `<KebabMenu>`** wrapping `useAnchoredMenu` + trigger + portal +
   surface/aria; props for width, items (children), and the mobile-modal
   escape hatch (`MoveToLocationMenu`'s contract). Convert all eight sites.
   `GearOptionsButton` adopts it — **named behavior change:** it gains the
   hook's viewport flip/clamp behavior it currently lacks.
2. **B2 — `useSortableRow`** returning `{outerRef, outerStyle, handleProps}`
   with options for the real per-surface differences (select-mode disable,
   placement tint → token, `SortablePackSection`'s divergent grip). Convert
   the six wrappers.
3. **B3 — `useInlineEdit` / `InlineRenameInput`** owning the
   draft/commit/Escape/blur machine on top of `useCommitOnce`; convert the
   four raw sites. Refactor `InlineText`/`InlineWeight`/`InlineQuantity`
   onto it only if the diff stays mechanical; otherwise park with a note.
4. **Description clearing — full path, not just the control.** Named
   behavior change, three coordinated parts (per Codex: `allowEmpty` alone
   would emit `""`, which the write contract rejects — it requires `null`
   to clear): (a) `InlineText` gains `allowEmpty`; (b) BOTH description
   write boundaries convert empty→`null` (`GearItemRow`'s
   `{description: v}` and `ListDetailPage`'s `sharedGroupProps` path); (c)
   tests at both levels — control test proves empty emission only when
   allowed; caller tests prove both surfaces send `null` and that name
   fields keep the non-blank rule.
5. **B4 — modal chrome:** opt-in rendered header (title + X honoring
   `preventDismiss`), a `SECONDARY_BUTTON` token replacing the 8 cancel
   strings, `ConfirmDialog` one-button variant. Preserve focus handling,
   toast hosting, and the backdrop-detection content structure (protected).
6. **C5 — column-width tokens** in `flat-table-styles.ts`; gear and list
   headers and rows compose the same tokens.

Risk: medium; wide surface, pure presentation, component tests at every
converted site. No copy changes beyond the ones named.

## Phase 4b — Shared flow/concurrency machinery (one PR)

1. **B6 — `useReauth`** extracted from PasskeySection/DeleteAccountSection
   (parameterized error codes + request decorator); both converted.
   Security-sensitive: flagged for extra review; existing section tests pass
   unchanged.
2. **B7 — one `InlineCreateCategory`** used by GearLibraryPage and
   GearItemDialog, carrying the protected coordination guarantees (and
   their trap comment) once. (Phase 6 consumes this; it does not re-extract
   it.)
3. **B5 — `runGuardedSave`** adopted only where the identity-guard pattern
   genuinely fits (the two GearLibraryPage sites, ListDetailPage's
   edit-gear save); these are variations, so adopt-don't-force.
4. **B8 — field-scoped optimistic machinery, incrementally.** Per Codex, the
   five lifecycles are NOT interchangeable (gear's last-one-out invalidation
   gate vs food's invalidate-on-settle; moves snapshot location AND rank
   with their own toasts; array vs `{items}` cache shapes; resets are plain
   async functions touching both caches and restoring only previously-set
   flags). So: extract a small **snapshot/apply/restore primitive** only —
   invalidation policy, promise ownership, and error reporting stay with
   each caller — and convert **one lifecycle per commit**, never converting
   resets into mutations and never unifying invalidation policy silently.
   The existing hook tests (concurrent sibling writes, placement
   preservation, the invalidation gate, two-cache resets) stay green;
   add direct tests for the primitive's contract (absent cache/row,
   food-document metadata preservation).
5. **F2 — one pack-filter predicate** exported from a planner module,
   imported by `CategoryGroup`, `list-reorder-plan`, `ListDetailPage`;
   delete the "keep them in step" note.

Risk: medium-high on B8 (hence per-lifecycle commits), medium elsewhere.

## Phase 5 — Desktop/mobile and gear/lists convergence (one PR)

Depends on 4a/4b. Mostly deletion.

1. **C1 — shared lists-surface pieces:** one `SortableListRow`
   (rename-inline + `KebabMenu` + handlers), one `NewListInline`, one
   `useListImportFlow` (file input + preview dialog + error modal) —
   consumed by `ListsPage`, `DesktopListsPanel`, `ListsEmptyState` (deleting
   the triplicated import wiring and ListsPage's internal duplication).
   Genuine divergences (share action, menu ordering) stay as props. Split
   the row props type so the DragOverlay clone stops stubbing 11 no-op
   handlers (closes the F3 presentation/behavior coupling note).
2. **C7 — one list-create implementation:** `ListsEmptyState` adopts
   `submitCreateList`; one variables shape under the mutation key.
3. **C4 — one `ImportPreviewDialog`** with `columns`/`notes` props; delete
   the gear copy.
4. **C2/C3 — shared row scaffolding:** extract the common leading scaffold +
   mobile tap-body for `GearItemRow`/`ItemRow` (component vs token recipe
   decided by diff size); tokenize the pack-row layout so
   `SortableFoodRow`/`FoodRow` stop copy-syncing `ItemRow`. Hard
   constraint: the share page must stay dnd-free — **verify the import
   graph/bundle** (extend or add the import-boundary test), do not assume.
5. **C6 — csv + options consolidation:** shared serialization core for
   `lib/csv/gear.ts`/`list.ts` and the twin `import-plan.ts` blocks; collapse
   the `use-gear-category-actions` ↔ `use-list-gear-actions` clone; unify
   `GearOptionsButton` ↔ `ListSettingsButton` on 4a parts. **H4 explicit
   step:** collapse the twin 8-prop forwarding lists
   (`GearLibraryPage.tsx:691-700,1081-1091` → `GearOptionsButton` /
   `MobileGearActionBar` → `GearOptionsContent`) into one `gearOptions`
   object passed through; shell consolidation alone does not do this.
   Phase 6 then only verifies no residue.
6. **FoodView fixes — contract first.** Remove the double invalidation
   (mechanical). For the busy flag: **define the concurrency contract before
   coding** — which food operations may overlap (day changes replace the
   cached food document; slot edits/deletes/creates/quantity changes do not
   all commute), which stay mutually exclusive, and how controls track
   per-item pending state. The existing global-freeze test is then
   deliberately replaced (named policy change), not deleted as redundant.
   If defining the contract stalls, ship only the double-invalidation fix
   and park the rest.
7. **GearItemRow selection mode — decide, then test.** Named policy change:
   pick the editability rule for select mode (recommendation: everything
   read-only during selection, matching the weight field) before writing
   the failing test; fix the description-column misalignment independently
   of that decision.

Risk: medium — mobile/desktop rendering differences; the per-page test
suites and the share-path boundary check are the net. Biggest negative line
count of the plan.

## Phase 6 — God components and the memo question (one PR, the careful one)

Depends on 4–5. Per review, the claimed "existing seams" are mixed — so the
phase is explicitly two-tier: mechanical moves first, designed extractions
second, each landing as its own revertible commit.

1. **Tier 1 — genuinely mechanical moves:** `PackLocationControls` to its
   own file; the wrapper's lists query into `ListDetailInner` (preserving
   `key={routeId}` and existing failure-state behavior — A5); the dialog
   JSX blocks that already form components. These are moves; existing
   suites must pass unchanged.
2. **Characterization tests before Tier 2.** The `ListDetailPage.*` suites
   cover much, but NOT all four drag kinds, cross-location gear/food moves,
   placement-to-mutation wiring, focus return, announcements, and nested
   packing actions (some DnD tests stub dnd-kit and invoke `onDragEnd`
   directly). Add targeted characterization tests for exactly the paths
   about to move, following AGENTS.md's rule: each must pass, then fail
   under a small temporary production break (restored before commit, break
   named in the commit message).
3. **Tier 2 — designed extractions, interface reviewed before coding:** the
   DnD + placement orchestration (it depends on query data, normalized
   locations, hidden ranks, grouping, mutation state, announcements, derived
   maps — the interface must be designed, not discovered) and
   `renderPackingLocationNode` (captures shared group props, food grouping,
   menu callbacks, placement actions, pending flags, recursion). The
   `requestMove`/`requestMoveFood` dedup and the announcement-trio dedup
   (F3) land as separate commits BEFORE or AFTER the move, never folded
   into it. The ~600-line target is guidance only — it must not force a
   props bag or hide coupling; if an extraction stalls, ship the completed
   tiers and park the rest with the reason.
4. **A2 — split `GearLibraryPage`:** import flow onto Phase 5's
   `useListImportFlow`-family parts, add-category editor onto Phase 4b's
   `InlineCreateCategory` (consume, not re-extract), dialog orchestration
   out; protected coordination comments move with the code. Verify (not
   re-plan) that H4's options prop bundle collapsed via Phase 5.
5. **F1 — profile, then decide, separately from the moves.** Profile
   pack-mode re-render cost at a realistic worst case (e.g. 300 items across
   30 locations — the findings cite the 300-checkbox pack view; the combined
   scenario is this plan's choice), AND the other affected compositions
   (location grouping,
   category fallback, picker interactions, realistic gear+food mix).
   Outcome: (a) memo pays → fix the `renderPackRowAction` defeat with
   stable per-section callbacks, keep the discipline, documented once; (b)
   it doesn't → remove the `[]`-deps/eslint-disable scaffolding where it
   buys nothing. Either way: the un-memoized packing derivations' lint
   constraint is preserved (protected), the placement-context system's
   independent purpose is preserved, and any callback-dependency change is
   followed by a stale-state check (fresh state observed after mutation).
   Memo-policy changes NEVER share a commit with orchestration moves.
6. **A3 — `CategoryGroup`, conditional:** only if a flavor split genuinely
   reduces the prop surface without breaking the protected contracts;
   otherwise one header block documenting the sentinel rules, and stop.

Risk: highest; mitigated by the two-tier structure, characterization tests,
per-commit revertibility, and profiling-before-memo-changes.

---

## Dispositions for everything else in the findings doc

- **D4** → Phase 2b. **D10** → Phase 2.6. **ci/image duplication** →
  Phase 1b.6. **H3** → Phases 1b (scripts), 2 (server), 3 (shared), and
  touched-file basis in 4–6; any residue after Phase 6 is accepted.
  **F3** → Phase 5.1 (DragOverlay props) + Phase 6.3 (announcement dedup).
  **A5** → Phase 6.1. **H4** → Phase 5.5 closes it, Phase 6.4 verifies.
  **Section I bugs** → Phase 4a.4 (description clearing), Phase 5.6
  (FoodView), Phase 5.7 (GearItemRow select mode), Phase 2.7
  (gear cap→404). **G1** → touched-file basis only.
- **Deliberately not done:** repo-wide comment sweep; redesigning the
  reorder loops, test tiers, or density system; auth-page visual
  convergence (PARKED.md unless Phase 4a makes it trivial); new
  dependencies; a formatter; any behavior change not in the named list.

## Sequencing and process

- Order: 1 → 1b → {2, 2b, 3 in any order} → 4a → 4b → 5 → 6. Phases 4–6 are
  strictly sequential (same surfaces).
- Each phase: tests-first for its named behavior changes, full gate run
  (including `check:yaml`/`check:action-pins` where applicable), Codex diff
  review, PR, human-approved squash merge on green. A merge does not deploy.
- Each phase updates `docs/code-quality-review-2026-10-18.md` to mark the
  findings it closed. After Phase 6, both documents leave the tree per
  AGENTS.md: live rules → AGENTS.md, **accepted risks → SECURITY.md**
  (e.g. anything consciously left open, like a deferred ci/image
  unification), deferred ideas with triggers → PARKED.md.
