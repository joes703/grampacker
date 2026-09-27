# Code-quality review, 2026-09-26

Dated record, not binding (see AGENTS.md "Documents"). Findings only: nothing
in the code was changed by this review.

## Scope and method

- **Tree reviewed:** `main` at `7ab47ee`.
- **Not reviewed:** `scripts/check-migration-safety.mjs` and
  `scripts/check-migration-immutability.mjs`, which the migration-harness
  rewrite replaces and which were reviewed there.
- **Not repeated:** correctness and security were covered by the 2026-09-10
  engineering audit. Its findings are not repeated here unless they turned out
  not to be fixed.
- **Method:** seven parallel read-only reviewers, one per slice. Each read the
  source together with its tests, against a shared checklist:
  - structure;
  - AI-written tells (defensive checks for impossible states, comments that
    narrate history, one-off helpers that duplicate shared ones, type escapes,
    hand-rolled styling);
  - test quality.

  An eighth, cross-cutting pass then merged findings that recur between
  slices, and used git history to find the files that attract repeated fixes.
- **Verification:** every finding marked **confirmed** was checked against the
  code by the author of this report, not only by the reviewer that raised it.
  - Both bugs were reproduced with throwaway tests outside the repo tree.
  - Some reviewer findings were downgraded or corrected on checking; the
    entries below say so.
  - Findings not individually re-checked are marked **reported**. They come
    from a reviewer that cited file and line, but were not re-derived here.
- **Commands run:**
  - Reviewers: `npm run lint`, `npm run test:unit` (132 files, 1302 tests,
    all passing), and targeted `npx vitest run` on their slices.
  - Not run: the API suite (`test:api`). Findings that depend on workers-pool
    behavior say so.

**Guardrail used throughout:** anything touching an AGENTS.md contract is
tagged **contract**. Those items are product decisions for the owner, not
cleanups to be done on sight.

## Summary

The architecture holds up. The boundaries AGENTS.md cares about hold in the
code:
- scoped repositories;
- plan-then-batch writes;
- chunking under D1's 100-parameter limit;
- the strict share DTO;
- CSRF before auth.

The pure planners (`pack-rows`, `placement-plan`, `packing-tree`,
`import-plan`) are small and well tested. Where an area was fine, the slice
reports said so; those areas are listed at the end.

The debt is mostly **the same idea implemented several times**, and in several
places the copies have already drifted apart:

- **UI chrome:** six spellings of a primary button, 17 copies of the
  secondary-button class string, seven hand-built kebab popovers, and four
  copies of the inline-edit state machine.
- **Row layout:** pack-row column widths and print checkbox squares are
  retyped in every row and header. Only hand-copying keeps them aligned.
- **The pack-filter rule:** written three times, in the same "planner vs
  render" shape that caused audit F1.
- **Limits:** caps and field limits are copied as literals across `shared/`,
  the client, route error messages and the SQL triggers. Six caps have no
  test tying the TypeScript constant to the trigger, which contradicts
  AGENTS.md's own rule.
- **Test harnesses:** eight `ListDetailPage.*.test.tsx` files re-declare the
  same mocks and render helper. Six server test files each define their own
  `createList`, with different return types.
- **Comments:** many narrate review history ("GATE 2 round-4 finding 2",
  "Codex finding, PR #14") or no longer match the code. In the busiest files,
  comments are 40-63% of lines.

**Git history agrees with where the reviewers found the most.** Since
2026-07-01:
- `src/lists/ListDetailPage.tsx`: 54 commits, 28 of them fixes.
- `src/lists/CategoryGroup.tsx`: 27 commits, 13 fixes.
- `server/middleware/rate-limit.ts`: 9 fixes.
- `src/gear/GearLibraryPage.tsx`, `server/repos/lists.ts`,
  `server/db/app-schema.ts` and `server/auth.ts`: 8 fixes each.

The review found **two real bugs**. Both are small to fix and are the first
work package.

## Bugs (fix first)

### B1 - Category drag on /gear silently stops working after a delete (high, confirmed)

- **What goes wrong:**
  - `GearLibraryPage.tsx:123` passes `buildUpdates`, which renumbers every
    category 0..N-1 on each drag.
  - `makeOptimisticReorder` (`src/lib/queries/optimistic.ts:281-325`)
    accepts a payload only if its sort orders are a permutation of the values
    the rows already hold.
  - `categories.remove()` (`server/repos/categories.ts`) never renumbers.
    Deleting any category except the last one therefore leaves a gap, such as
    `[0, 2]`.
  - From then on, every category drag builds `[0, 1]` and fails validation.
- **What the user sees:** in production, `onMutate` logs to the console and
  throws `OptimisticReorderValidationError` (`optimistic.ts:575-580`). The
  mutation function never runs. `onError` deliberately skips the toast
  (`:600`), and the refetch snaps the list back. No error appears. Ordinary
  drags and reloads do not repair it. It persists while the stored ranks
  differ from the dense 0..N-1 ranks the drag handler generates.
- **Evidence:**
  - Reproduced by a throwaway test: 0 calls to the mutation function, with a
    "not a permutation" error.
  - Code path read end to end.
  - Not reproduced in a browser.
- **Fix:**
  - Drop the `buildUpdates` override so the default `assignSortOrderSlots`
    applies, then delete the `buildUpdates` option. This is its only caller.
  - Add a test that drags after deleting a middle category.
- **Effort:** S. **Contract:** no.

### B2 - "Cancel rename" on a gear category commits the rename (medium, confirmed)

- **What goes wrong:** the rename input commits on blur
  (`CategorySection.tsx`, `onBlur={() => commitOnce(commitRename)}`).
  Pressing the pointer on the Cancel button moves focus away from the input,
  so the rename commits before Cancel's `onClick` runs. `RowIconButton` does
  not prevent that focus move.
- **Evidence:**
  - A throwaway user-event test renamed "Shelter" to "Oops" and clicked
    "Cancel rename". It saw `onRenameCategory("cat-1", "Oops")`.
  - No existing test clicks Cancel.
  - Not checked in a real browser. Chrome and Firefox move focus on
    mousedown, which is the mechanism the test simulates.
- **Fix:**
  - `onMouseDown={e => e.preventDefault()}` on the Confirm and Cancel
    buttons, or have blur ignore a `relatedTarget` inside the row's action
    group.
  - Add the test.
- **Effort:** S. **Contract:** no.
- **Related, suspected, not reproduced:**
  - `SortablePackSection.tsx:232-274` commits on both Enter and blur without
    `useCommitOnce` (S5-9).
  - The same blur-before-click pattern should be checked in any other inline
    editor that has an explicit Cancel button.

## Work packages (PR-sized, in suggested order)

Each package lists the findings it closes, which are detailed in the next
section.

1. **Bugs.** B1 and B2, each with a regression test. Effort S.
2. **Repo tooling hygiene.** S7-1, S7-3, S7-4, S7-6, S7-8, S7-9.
   - `.claude/settings.json` auto-approves commands AGENTS.md and CLAUDE.md
     forbid or have retired.
   - `npm run deploy` bypasses the gated pipeline.
   - The Node-tier lint rule matches strings, so it misfires and can be
     bypassed.
   - Stale config comments.

   Effort S. The settings change is the owner's call.
3. **One source for limits and caps.**
   - Covers S1-5, S2-6, S3-3, S3-4, S5-10, S6-10, and contract item 9 from the
     agent-instructions review.
   - Export named limits from `shared/`, and build the schemas, client
     `maxLength`s and route error strings from them.
   - Add the missing constant-vs-database tests, in the style of
     `scripts/quantity-bounds.test.ts`:
     - row-cap triggers: `GEAR_ITEM_CAP`, `LIST_CAP`, `LIST_ITEM_CAP`,
       `PACKING_LOCATION_CAP` and `FOOD_ITEM_CAP`;
     - `FOOD_DAY_CAP`, which is a CHECK constraint (0017), not a trigger.

     `pack-rank-constants.test.ts` already ties `LIST_ITEM_CAP` and
     `FOOD_ITEM_CAP` to the rank guards. What is missing is the row-count
     thresholds.
   - Delete the two unused server copies of the cap constants.
   - Fixes a real mismatch: list rename is capped at 120 characters in
     settings but 256 on the server.

   Effort S-M. **Contract** (request schemas): the values must not change.
4. **Server test fixtures.**
   - Covers S2-3/S7-2, S7-7, S2-13, S1-11.
   - Add `server/test/fixtures.ts` with typed factories that assert 201 and
     parse the response with the shared schemas.
   - Add a `TEST_ORIGIN` constant, and derive the stale-session age from
     `FRESH_AGE_SECONDS`.
   - Move two tests to the Node tier.
   - Retarget the fixtures that name the removed `lists.food_plan_id`
     column. Keep what those tests assert: that a non-slug uniqueness
     failure is rethrown without a retry (`lists-slug.node.test.ts`), and
     the column classifier (`db-errors.node.test.ts`).

   Effort M. **Review note:** the authorization proofs depend on these
   helpers, so their owner, non-owner and anonymous behavior must be
   preserved exactly.
5. **Client test harness.**
   - Covers S4-9, S5-7, S6-12.
   - Add `src/test/list-fixtures.ts`, a `list-detail-harness.tsx`, and a
     gear-page harness.
   - Move the `showModal` polyfill into `vitest.setup.ts`.

   Effort M. It makes packages 10-12 cheaper, so do it before them.
6. **Route-layer helpers.**
   - Covers S2-1, S2-2, S2-7, S2-8, S2-5.
   - Add a `parseJson(c, schema)` helper, with one 400 message.
   - Keep one `toGearItemResponse`.
   - Reuse `listItemFailure` in the food routes.
   - Replace the drifted copies of the authorization matrix in route comments
     with pointers.
   - Register the session gate in one place.

   Effort S-M. **Contract** on S2-5 (CSRF-then-auth ordering).
7. **Boundary enforcement.**
   - Covers S2-4, plus the lint gap from the agent-instructions review.
   - Add one test that walks Hono's registered routes, driven by
     `docs/authz-matrix.md`:
     - assert 401 for anonymous callers;
     - assert 403 without the CSRF header, on unsafe methods only;
     - explicitly exempt the anonymous routes: `/api/health`, the public
       share read, and better-auth's `/api/auth/*`, which has its own origin
       check.
   - Extend the route lint so `c.env.DB` and `cloudflare:workers` `env` are
     refused in `server/routes/**`. Today the rule matches imports only; a
     probe showed a route calling `c.env.DB.prepare(...)` passes lint.

   Effort M. **Contract** (route handlers never touch the DB; anonymous and
   CSRF proofs).
8. **Repository layer.**
   - Covers S1-1, S1-2, S1-4 (contract-sensitive), then S1-3, S1-6, S1-7,
     S1-8, S1-9 (mechanical).
   - Add a shared `ownership.ts` and one parent-FK classifier.
   - Plan CSV import categories in one place.
   - Split `packingLocations.remove`.
   - Give PATCH `set` objects Drizzle's types.

   Effort M-L. Split it into a contract-sensitive PR (ownership and FK
   recovery, reviewed predicate by predicate) and a mechanical PR.
9. **Optimistic-update layer.**
   - Covers S3-2, S5-2.
   - Make the generic update and delete helpers restore only the fields they
     changed, then replace the four hand-written field-scoped copies.
   - Add the gear sibling-race test to food.

   Effort M.
10. **Shared UI vocabulary.**
    - Covers S6-3, S5-6, S4-8, S6-4, S5-13, S6-8, S6-7.
    - A `Button` with variants, plus `DialogHeader`, `InlineAlert`,
      `AnchoredMenu`/`RowKebabMenu` and a `useInlineEdit` hook.
    - One `ImportPreviewDialog` for gear and lists.

    Effort M. Update `docs/ui-density.md` in the same change.
11. **Pack-row vocabulary.**
    - Covers S4-2, S4-7, S5-5, S4-3, S5-3.
    - Column-width tokens, `PackChecklistCells`, one
      `isVisibleUnderPackFilters` predicate, and one exclusion builder.
    - Delete the parity test that checks a composition the page never
      performs.

    Effort M. Write the alignment test first.
12. **Split `ListDetailPage`.**
    - Covers S4-1, S4-4, S4-5.
    - Seams: `useListRouteSync`, a pure `derivePackView`, `usePackDnd` with a
      pure drop planner, `ListDetailDialogs`, and `PackLocationControls` in
      its own file.
    - Either make the memoization hold in pack view or stop claiming it does.

    Effort L. Do this after 5 and 11.
13. **Split `GearLibraryPage`.**
    - Covers S6-1, S6-5.
    - `NewCategoryInput` (also reused by `GearItemDialog`), `useGearCsv`,
      a pure `planGearItemReorder`, `useGuardedDialogSave` (shared with
      ListDetailPage), and `GearLibraryHeader`.
    - Adds the missing reorder and import tests.

    Effort L.
14. **List-management surfaces.**
    - Covers S5-1, S5-11, S5-12, S5-9, S5-14.
    - One CSV-import hook, `ListRowMenu` and `NewListInput`.
    - Delete-and-navigate lives in one place, so every surface lands on the
      same list.
    - Extract FoodView's day-count logic.

    Effort M.
15. **Settings re-authentication.**
    - Covers S6-2.
    - One `useFreshSessionReauth` hook plus a `ReauthPrompt`.
    - Fixes delete-account offering "Use a passkey" to users who have none.

    Effort M. Auth-adjacent, so it needs the extra review AGENTS.md
    "Security" asks for.
16. **Server middleware tidy.**
    - Covers S2-9, S2-10, S2-12.
    - Rate-limit path rules in one table, with no rule deleted.
    - Split `error-handler.ts`.
    - Split the 1725-line `packing-locations.test.ts`.

    Effort M. Security-sensitive.
17. **Comment pass.** Remove history narration and fix stale comments as
    each file is touched by packages 2-16. Do not run a repo-wide sweep. The
    reasons are mostly load-bearing: keep the "why", drop "round-7 finding"
    and "used to". Leftover files: S1-10, S2-11, S3-10, S4-6, S5-16, S6-11,
    S7-5.

**Product decisions, not scheduled:**
- **S3-9:** drop the legacy bare-array pack-order body. Contract: API shape.
- **S5-4:** move the food day-total rule out of render code. Contract: food
  weight. No change in behavior.
- **S6-6:** should bulk delete ask for confirmation?

## Findings by slice

Severity: high / medium / low / nit. Effort: S under 1h, M half a day,
L a day or more.

### S1 - `server/repos`, `server/db`

| ID | Sev | Finding | Fix | Eff | Status |
|---|---|---|---|---|---|
| S1-1 | med | Recovery from a concurrent parent delete is inconsistent. `packing-locations.ts:200` maps any FK failure to `invalid_container_item`. Gear create, update, import and bulk-move, `list-items` quickAdd and `lists` createFromSelection precheck a parent but catch no FK error, so a concurrent delete returns a 500. `list-items.ts:194-198` and `food.ts:128-134` state the intended rule. | One `classifyParentFk` helper applied at all seven sites, or record the 500s as accepted in SECURITY.md. Add `sabotaged()` race tests. | M | confirmed (gear create) |
| S1-2 | med | Owned-set ownership prechecks are written out about 10 times. `lists.createFromSelection` retypes a probe that already exists in the same closure. | `server/repos/ownership.ts`. Note: the chunked slot probe in `food.usableSlotIds` is deliberate and documented. It conflicts only with the guidance comment in `chunk-ids.ts`, so fix the comment, not the code. | M | confirmed (reviewer overstated the slot probe). **contract** |
| S1-3 | med | `packingLocations.remove` is a 340-line method. Its census/cleanup/delete tail exists twice (449-469 and 558-581). | Split into `readBagSnapshot`, `planDenseRenumber`, `planAppend` and `closingStatements`. | M | reported |
| S1-4 | med | The CSV import category planning is copied between `gear-items.ts:174-261` and `lists.ts:574-651`. Only the lists copy got FK recovery. | `planNewCategories()` in `categories.ts`. | M | reported |
| S1-5 | low | Duplicated column lists (`gearCols`, three food projections). Two unused cap constants (`gear-items.ts:87`, `list-items.ts:101`). Cap matchers spread over six files. | Export the projections, delete the dead constants, move the matchers into `db-errors.ts`. | S | confirmed (constants) |
| S1-6 | low | Food update reads full rows only to check existence. Its location check is a separate awaited read, against the file's own batching rule. | `itemProbe` / `locationProbe` builders. | S | reported |
| S1-7 | low | The "append at max+1" sort-order SQL is pasted about 10 times. Food create reads it outside the batch. | `nextCategorySortOrder` / `nextGearSortOrder` helpers. | S | reported |
| S1-8 | low | PATCH builders use `Record<string, unknown>`, which loses Drizzle's column typing (5 sites). | `SQLiteUpdateSetSource<typeof table>`. | S | reported |
| S1-9 | low | The `[first, ...rest]` / `if (!first)` batch boilerplate appears 30 times with 6 different fallbacks. Some guards are unreachable. There are casts on batch results. | `batchNonEmpty()` helper. | S | reported |
| S1-11 | low | Tests still exercise `lists.food_plan_id`, a feature removed in 0016. Two cap and guard matchers have no direct test. Pure mapper tests run on the workers pool. | Retarget the fixtures, add matcher tests, move the pure tests to the Node tier. | S | reported |

### S2 - routes, middleware, auth, email

| ID | Sev | Finding | Fix | Eff | Status |
|---|---|---|---|---|---|
| S2-1 | med | 25 copies of the parse-and-400 block. Food answers `'Invalid request'`, every other route `'Invalid request body'`. | `parseJson(c, schema)` helper, one message. | S | confirmed |
| S2-2 | med | `toEmbeddedGear` (`lists.ts:94-108`) is a line-for-line copy of `toGearItemResponse` (`gear-items.ts:48-62`). | Export one mapper; add `centsToDollars` to `money.ts`. | S | confirmed |
| S2-3 | med | Test setup helpers (`createList` etc.) are copied across 6 files, with hand-written response types. Merged into work package 4 with S7-2. | `server/test/fixtures.ts`. | M | confirmed |
| S2-4 | med | Each file keeps its own hand-written "anonymous gets 401" route table. Nothing checks it is complete. | One test that sweeps the registered routes. | M | reported. **contract** |
| S2-5 | low | The session gate is registered two ways: hoisted for `/lists/*` (`index.ts:98`, which carries an explanatory comment) and per-file for `/me`, `/categories` and `/gear-items`. The reviewer rated this medium; it is downgraded because the hoisted form is documented. | Hoist all of them into `index.ts`. | S | confirmed. **contract** |
| S2-6 | low | Cap error messages hard-code 500/100/300/30/200. | Build them from the shared constants. | S | reported |
| S2-7 | low | The 409 conflict and ordering-space-exhausted errors are each worded three different ways. Food routes bypass `listItemFailure`. | One failure mapper. | S | reported |
| S2-8 | low | Route-file copies of the authorization matrix have drifted from `docs/authz-matrix.md`. | Replace with pointers. | S | reported |
| S2-9 | low | Rate-limit path knowledge is spread across 5 places. `charge()` also cleans up the `verification` table. | One path table; separate cleanup function; delete no rule. | S-M | reported. security-sensitive |
| S2-10 | low | `error-handler.ts` does four jobs, and its suppression entry is built twice. | Split into `log-scrub.ts` and `incident-log.ts`. | M | reported |
| S2-11 | low | History narration. Comments are 52-63% of lines in `auth.ts` and `rate-limit.ts`. | Comment pass. | M | reported |
| S2-12 | low | `packing-locations.test.ts` (1725 lines) holds pack-order, trigger, migration-guard and cascade tests. `rate-limit.test.ts` has 33 tests under one flat `describe`. | Split by concern; nest by bucket. | M | reported |
| S2-13 | low | `listItemFailure` tests run on the workers pool. `food-days-route.test.ts` is mock-only but is in the API tier. | Move both to `.node.test.ts`. | S | reported |

### S3 - `shared/`, `src/lib`

| ID | Sev | Finding | Fix | Eff | Status |
|---|---|---|---|---|---|
| S3-1 | **high** | **Bug B1** (see above). | See B1. | S | confirmed |
| S3-2 | med | The generic update and delete helpers roll back the whole cached array. `moveItemMut` and `deleteItem` use them on the same cache that `use-list-item-actions.ts:102-110` hand-rolls field-scoped rollback for, because of exactly this hazard. The effect is a transient flash, since `onSettled` refetches server truth; no data is lost. | Field-scoped rollback in the helpers. | M | confirmed (impact is lower than the reviewer stated) |
| S3-3 | med | Name, description, category and weight limits are copied as literals in `shared/`, `caps.ts` and `money.ts`. The CSV date parser repeats the private `isoDateSchema`. | Named limit exports. | S-M | reported. **contract** (values unchanged) |
| S3-4 | low | `GEAR_STATUSES` is redefined in `src/lib/gear-status.ts`. Its test compares one hand-typed list to another. | Import from `shared/`. | S | reported |
| S3-5 | low | The two CSV parsers repeat column resolution and row mapping. There are two different ounce constants. `money.ts` has no test file. A comment in `GearItemDialog.tsx:104` claims a rule it does not follow. | Shared column resolver; `ozToGrams`; table-driven `money.test.ts`. | M | reported |
| S3-6 | low | The pack-reorder helper, which has a single caller, sits in the generic `optimistic.ts`. One payload shape has three type names. | Move it next to `pack-rows.ts`; one type. | S | reported |
| S3-7 | low | `groupByCore` has 7 parameters for two result shapes. `listItemsArrayEqual` lists its fields by hand, and fields missing from it have been found one bug at a time. | One result shape; a field table that `satisfies` the type. | S-M | reported |
| S3-8 | low | Four identical next-sort-order functions. The `offset` parameter is never used. Hook tests assert on a mocked pure function. | One `nextSortOrder`. | S | reported |
| S3-9 | low | The pack-order endpoint still accepts the pre-0022 bare-array body. | Remove it. | S | reported. **contract** (API shape) |
| S3-11 | nit | Type escapes: `tempId as string`, a missing type guard, an unvalidated error-body cast, `get(...)!` after `.has()`. | Narrow properly. | S | reported |

### S4 - `ListDetailPage`, `CategoryGroup`, `ItemRow`

| ID | Sev | Finding | Fix | Eff | Status |
|---|---|---|---|---|---|
| S4-1 | med | `ListDetailPage` (2610 lines) still holds five separable jobs. Audit F15 extracted only the reorder planners. | Split along the seams in work package 12. | L | reported (seams named) |
| S4-2 | med | The pack checklist row is built three times (`ItemRow`, `SortableFoodRow`, the container header). The print square is repeated 6 times and the flag slot 12 times. | `PackChecklistCells`, `PrintCheckboxSquare`, `FlagSlot`. | M | reported |
| S4-3 | med | The pack-filter predicate is written three times: `list-reorder-plan.ts:50-53`, `ListDetailPage.tsx:1067-1075` (inverted), and `CategoryGroup.tsx:452-462`. The planner assumes the page's filter matches what CategoryGroup renders, the same split that caused F1. | One `isVisibleUnderPackFilters`. | S | confirmed |
| S4-4 | med | `requestMove` and `requestMoveFood` are near-identical but pass different food arrays (`listFood.items` vs `packFoodItems`) to `nextUnionPackRankFor`. The move/announce pattern appears 4 times and the menu props 3 times. | `requestMoveRow(kind, ...)`, an `announced()` helper, shared menu props. | S | confirmed |
| S4-5 | med | Six eslint-disables and `useLatestRef` exist to keep `sharedGroupProps` stable, but in pack view fresh closures defeat the memoization anyway. The follow-up the comment says was filed is not in PARKED.md. | Destructure `.mutate`, then profile. Either make the memo hold or drop the claim. | M | reported |
| S4-6 | low | About 40% of lines are comments. Several are stale (a truncated "TRANSPLANT NOTE", a reference to an Organize branch that no longer exists, a claim about the aside that contradicts the code). | Comment pass. | S-M | reported |
| S4-7 | low | Column widths are "defined here" (`CategoryGroup.tsx:36`) but hard-coded in the header, the footer and `ItemRow`. | Column tokens. | S | reported |
| S4-8 | low | `PackLocationControls` input and button, the not-found block and the drag chip hand-roll styles that `FORM_INPUT`, `PrimaryButton` and `StatusPanel` already provide. | Compose the tokens. | S | reported |
| S4-9 | low | The page test setup is copied across 8 files. One `renderDetail` comment is already stale. | Shared harness (work package 5). | M | reported |
| S4-10 | nit | `CategoryGroup.test` puts unrelated tests under one `describe`. The editable ItemRow worn/consumable toggle has no direct test. There is a non-null assertion on `onDelete`. | Split the describe; add the tests before S4-2. | S | reported |

### S5 - rest of `src/lists`

| ID | Sev | Finding | Fix | Eff | Status |
|---|---|---|---|---|---|
| S5-1 | med | List management is built 3-4 times (ListsPage, DesktopListsPanel, ListsEmptyState, ListSettingsPanel), and the copies already disagree. Deleting the open list lands on a sibling list from the sidebar but on `/lists` from settings (only DesktopListsPanel uses `pickListAfterDelete`). Only one copy creates a list on blur. Menu order differs. Rename limits are none, 120 and 256. | `useListCsvImport`, `ListRowMenu`, `NewListInput`, delete-and-navigate in the actions hook. | M | confirmed (delete landing, the 120 limit) |
| S5-2 | med | The field-scoped optimistic patch is hand-rolled three ways. The food version invalidates on every settle, without the gear hook's last-one-out gate. | `makeFieldScopedPatch` (work package 9). | M | reported (flicker not reproduced) |
| S5-3 | med | Worn exclusion is derived three ways. `worn-reorder-exclusions.test.ts` checks a composition the page never performs. | One builder in `section-rows.ts`; delete the parity test. | S-M | reported |
| S5-4 | med | The food day-total dedupe rule (0024) lives inline in `FoodDaySection.tsx:52-62` render code. | `foodGramsForDay()` beside the weight helpers. | S | reported. **contract** (food weight) |
| S5-5 | med | Row column widths, print squares, the placing tint and the sortable style are retyped in every row. | Tokens plus `sortableRowStyle()`. | M | reported |
| S5-6 | med | 8+ outline-button and 5+ ghost-button variants. NotesEditor has a custom Save button. `FORM_INPUT` is retyped. | Button variants (work package 10). | M | reported |
| S5-7 | med | Test harness and `ListItemWithGear` factories are copied (15 files contain the full literal). | Shared fixtures. | M | reported |
| S5-8 | med | `exportCsv` has no test. A comment promising one refers to a slice that has since shipped. | Add tests. | S | reported |
| S5-9 | low | Pack-section rename commits on both Enter and blur without `useCommitOnce`. It has no focus ring and a literal 60-character limit. | `useCommitOnce`, the focus-ring token. | S | reported (double PATCH suspected) |
| S5-10 | low | Name bounds copied as literals; list rename is 120 in settings vs 256 on the server. | Import from `shared/`. | S | confirmed |
| S5-11 | low | `ListsEmptyState` builds its own create mutation. The shared hook's toast "Couldn't create the list" breaks the error-copy rule. | Reuse the hook's `submitCreateList`; fix the copy. | S | reported |
| S5-12 | low | FoodView has about 40 lines of logic inline in `onBlur`, the app's only `window.confirm`, a hand-rolled error panel, and a double invalidate. | `planDayCountChange`; `ConfirmDialog`. | S-M | reported |
| S5-13 | low | The kebab portal markup appears 5 times here and 8 times app-wide. | `AnchoredMenu` (work package 10). | S-M | reported |
| S5-14 | low | SharePage hand-builds its status screens (with no retry) and maps the DTO inline. Its notes block duplicates `NotesRead`. | `shareToRenderModel`; export `NotesRead`. | S | reported |
| S5-15 | low | Dead code: `packRowIsPacked`, `packRowLocationId`, an unused re-export, WeightTable's unread props, an ignored `onConfirm` argument. Four `outerRef` casts. | Delete; check with the build. | S | reported |

### S6 - gear, components, settings, auth, layout

| ID | Sev | Finding | Fix | Eff | Status |
|---|---|---|---|---|---|
| S6-1 | med | `GearLibraryPage` holds five jobs. Its new-category session machine duplicates `GearItemDialog`'s widget. | Split along the seams in work package 13. | L | reported (seams named) |
| S6-2 | med | The re-authentication flow is copied between PasskeySection and DeleteAccountSection, and has drifted: delete-account shows "Use a passkey" even with no passkeys (`DeleteAccountSection.tsx:191-197` vs `PasskeySection.tsx:401`). | `useFreshSessionReauth` + `ReauthPrompt`. | M | confirmed. auth-adjacent |
| S6-3 | med | No shared button, dialog-header or inline-error vocabulary: six primary-button spellings, 17 copies of the secondary-button class, four reds. | `Button` variants, `DialogHeader`, `InlineAlert`. | M | reported |
| S6-4 | med | The row-kebab popover is copied 7 times. Width is written as both `192` and `w-48`. `'left' in menuPos` narrowing is needed everywhere. | `RowKebabMenu`; a typed overload of `useAnchoredMenu`. | S | reported |
| S6-5 | med | Gear reorder math, CSV import glue and the export-failure toast have no tests. The page tests mock `DndContext`. | Pure extractions plus tests. | M | reported |
| S6-6 | low | The bulk-delete toast "Couldn't delete the selected items" breaks the error-copy rule, and the test pins it. Bulk delete has no confirmation (single delete does). | Reword; confirmation is a UX decision. | S | confirmed (copy) |
| S6-7 | low | Gear and list import-preview dialogs are near-duplicates. | One `ImportPreviewDialog`. | S | reported |
| S6-8 | low | The inline-edit state machine is copied 4-5 times. | `useInlineEdit`. | M | reported |
| S6-9 | low | `nav-order.test.ts` greps the `AppShell.tsx` source text. The desktop nav duplicates the mobile destinations list. | `PRIMARY_DESTINATIONS`; delete the grep tests. | S | reported |
| S6-10 | low | The gear-status `<option>`s are hard-coded, with an `as GearStatus` cast. | Map over `GEAR_STATUS_MENU_OPTIONS`. | S | reported |
| S6-11 | low | Wrong or stale comments: "DECISIONS.md ADR 11" (no such file), a desktop trash button that no longer exists, a duplicated comment block, "phase 2". | Comment pass. | S | reported |
| S6-12 | low | The `showModal` polyfill is in 11 files. About 19 gear factories. Page test mocks duplicated. | `vitest.setup.ts`; shared fixtures. | M | reported |
| S6-13 | nit | Dead props (`PrimaryButton.fullWidth`, `UnitSegmentedControl` label and hint, `Section.id`). A 7-prop set declared three times. Blob download and dnd sensor setup repeated. | Delete; share. | S | reported |

### S7 - scripts, config, CI, test infrastructure

| ID | Sev | Finding | Fix | Eff | Status |
|---|---|---|---|---|---|
| S7-1 | med | `.claude/settings.json` auto-approves `codex exec -s read-only *` (retired by CLAUDE.md), `gh run watch *` (403s in the sandbox), `git add *` (which covers `-A`), `git checkout *` (which covers `checkout .`) and `git push *` (which covers `--force`). | Remove the first two; add deny rules for the destructive forms. | S | confirmed |
| S7-2 | med | Same as S2-3, seen from test infrastructure. | Work package 4. | M | confirmed |
| S7-3 | low | `npm run deploy` runs `wrangler deploy` by hand, skipping migrations, the restore point and CI. `cf-typegen` is unreferenced. | Delete both scripts. | S | confirmed |
| S7-4 | low | The Node-tier lint rule compares import strings. It misfires on `server/email/index.ts`, which forced a workaround, and `'..'` or `'../index.ts'` bypass it. | Rules per directory depth. | S | confirmed |
| S7-5 | low | Config comments narrate history: "Codex finding, PR #15", "until 2026-09-04", "(Phase 3)". The PR #154 story is told three times. `eslint.config.js:86` cites `REWRITE_PLAN.md` as authority. | Comment pass. | S | reported |
| S7-6 | low | Three comments that no longer match the code (pack-rank test, `staleSession`, `tsconfig.node.json` allowJs). | Fix them. | S | reported |
| S7-7 | low | `'http://localhost:5173'` is copied in 13 places. The stale-session age is hard-coded. | `TEST_ORIGIN`; derive the age from `FRESH_AGE_SECONDS`. | S | reported |
| S7-8 | low | `no-floating-promises` does not cover `scripts/**/*.test.ts`. `tsconfig.node.json` lacks `noUncheckedIndexedAccess`. `check-action-pins.mjs` lacks `@ts-check`. | Align them. | S | reported |
| S7-9 | nit | The CI yamllint step repeats the body of `check:yaml`. | Call the npm script. | S | reported |
| S7-10 | nit | deploy.yml uses two steps to compute one boolean. | Merge them (security-relevant, so review). | S | reported |

## Areas that are fine

These came back clean. Leave them alone:

- **Server data layer:** `chunk-ids.ts`, `db-errors.ts` and `users.ts`; the
  `withFreshSlug` consolidation; the `sabotaged()` and `failing()` race
  harnesses.
- **Server middleware:** `session`, `csrf`, `body-limit` and `client-ip`.
  `routes/shares.ts` builds the public response field by field and then
  strictly re-validates it.
- **Client data layer:** `api.ts`, the `queries/*` fetch modules, `keys.ts`
  (with its no-prefix-collision test), `mutation-error-handler.ts`, the CSV
  core parser, `import-plan.ts`, and `weight.ts`.
- **Pure planners:** `pack-rows`, `packing-dnd`, `packing-tree`,
  `placement-plan` and `list-item-removal`.
- **List hooks already extracted:** `use-list-item-actions`,
  `use-list-gear-actions`, `use-list-food`, `use-packing-location-actions`,
  `use-list-reset-actions`, and `use-quick-add-form`.
- **Share bundling seam:** `CategoryGroup`'s `renderRows` injection keeps
  `@dnd-kit` out of the share bundle, and a test guards it.
- **Loading and error gating:** follows AGENTS.md. Pending, failed and empty
  are handled as different states.
- **Session handling:** `SessionCacheGuard`, `useSignOut`, `RootRedirect`, and
  routing with `app-routes.test.tsx`.
- **Tooling:** the test-tier split in the two Vitest configs,
  `deployed-sha.mjs`, and `check-action-pins.mjs`.
- **A model test file:** `GearLibraryPage.save-errors.test.tsx` uses deferred
  promises, proves absences, and renders the real dialog.

## Unconfirmed (worth a look, not scheduled)

- **S5-2:** food Packed/Ready checkboxes may flicker during rapid taps, given
  the missing last-one-out gate. Inferred, not reproduced.
- **S5-9:** a double rename PATCH on Enter, depending on whether the browser
  fires blur on unmount.
- **Food weight precision:** food weight accepts any number of decimals, while
  gear weight is limited to tenths (`shared/food.ts:86` vs `gear.ts:39`).
  Possibly deliberate. **Contract** (DTO).
- **Import description length:** the optional `description` in the
  gear-import schema is not length-capped before the planner trims it.
- **Dead setting:** `mcp__cloudflare__docs` in `.claude/settings.json` may be
  dead. There is no `.mcp.json` in the repo.
- **Pack-row weight display:** food rows show per-unit weight next to the
  unit count, while the carrying list shows the total. This matches gear rows,
  but the owner should confirm it is intended. **Contract** (food weight).

## Review record

Codex did a source-level adversarial review of the first draft (`7ac18a5`),
through the plugin. It is read-only and ran no suites. Its verdict: **accurate
with corrections**. All seven corrections were applied in the following
commit:
- B1's "permanent" claim is qualified.
- The removed-column fixtures are retargeted, not deleted.
- The route sweep exempts the anonymous routes.
- `FOOD_DAY_CAP` is recognized as a CHECK constraint, not a trigger.
- Three rules the proposal dropped are restored: never discard the user's
  changes; the full rejected-promise ownership rule; no slash-command
  hand-offs.
- The ownership wording allows the documented bounded-probe alternative.
- Contract #9 is described as partly followed, not violated outright.
