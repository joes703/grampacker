# grampacker — Phase 1 fix summary (2026-05-04)

## Shipped

- **F1** — `dc0b924` — `public/_headers` added (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS, Permissions-Policy, COOP).
- **M10** — `5cafad7` — `usePortalPopover` effect deps stabilized with `[onClose]`. Removes ~800 scheduled passive-effect tasks per render at full row count.
- **B-1** — `b0b6ded` — `WeightTable` routes orphan `category_id` references to Uncategorized so cache-drift between `['categories']` and `['list-items']` no longer drops grams from the headline pack-weight number. Calculation extracted into pure `computeWeightBreakdown()` helper to enable testing without a DOM environment.
- **B-3** — `3667904` — `ListDetailPage.deleteGearItemMut` switched to `makeOptimisticDelete`. Both entry points for "Delete from inventory" (gear page kebab and list page kebab) now behave identically.
- **F6** — `2f356a2` — `MarkdownPage` header comment pins the safe configuration (no rehype-raw, build-time content only).
- **F3** — `d196bf7` — Delete-account flow now requires current-password re-auth in addition to the typed-confirmation dialog. Mirrors the `ChangePasswordForm` pattern. RPC unchanged.
- **B-3 follow-up — `02bc49a`** — Codex (2026-05-05) flagged that the original Commit 4 was only optimistic against `['gear-items']`, but the list-page row is rendered from `['list-items', listId]` — so the user's row stayed visible until the settled invalidation/refetch round-trip. Extended `deleteGearItemMut` in `src/lists/ListDetailPage.tsx` to compose with the helper: snapshot every affected `['list-items', _]` cache, optimistically filter rows whose `gear_item_id` matches, restore on error, invalidate per-key on settled. Also added an error toast (`"Couldn't delete that item. Please try again."`) since the helper alone has no toast hook. The gear-page entry point in `src/gear/GearLibraryPage.tsx` was NOT touched — its `removeItem` has the same helper-only shape, but the user is not on a list page when deleting from gear, so the lag is invisible there. Symmetrical fix deferred unless flagged.

## Verification results

- `npm run build`: pass after each of the six commits.
- `npm test --run src/lists/WeightTable.test.ts`: 3/3 pass (orphan-category regression test, quantity multiplier, empty-array zero-state).
- `npm test --run src/lib/csv.test.ts`: 13/13 pass (no regressions in existing suite).
- Manual smoke (popover dismiss, delete-account flow): pending — single-tenant verification recommended after deploy.

## Scope notes / surprises

- **B-1 small refactor.** The project has no jsdom or `@testing-library` dependency. To write the regression test without adding a new test environment, the calculation in `WeightTable` was extracted into a pure `computeWeightBreakdown()` helper exported from the same file. Component still renders identically. This was the smallest scope expansion that produced a real regression test.
- **F3 UI shape.** The audit specified the verifyError block but didn't prescribe UI placement. The current-password input renders inside the `DeleteAccount` component immediately after the typed-confirm dialog closes — kept inside the same component, no new file. Cancel button resets state.
- **B-3 was a scope expansion.** REVIEW-PHASE1.md listed B-3 as out of scope, but the four-item batch instruction included it ("for B-3, follow the pattern from GearLibraryPage.removeItem"). The Commit 4 mirroring fix was correct relative to the gear-page entry point, but the original `makeOptimisticDelete` only filters `['gear-items']` — the list-page row stayed visible until the settled `['list-items']` invalidation/refetch completed (the user's perspective). Codex flagged this on 2026-05-05; corrected in the follow-up entry below.
- **Out-of-scope held.** B-2, B-4, H1, H2, H3, M1, M6–M12, H4–H6, W-1, F2, F4, F5, F7 — none touched.

## Next phase

Phase 2: cache invalidation cluster (B-2, B-4, H2, H3) — optimistic-helper extension for cross-cache fan-out, bulk-delete/move optimistic helpers with onError toasts. See REVIEW-quality.md and REVIEW-performance.md for full details.

---

## Phase 2 — broad-invalidation cluster (2026-05-04)

### Shipped

- Commit 1 (H3, B-4 infra) — `00c41d7` — `makeOptimisticBulkDelete` + `makeOptimisticBulkMove` helpers added to `src/lib/queries/optimistic.ts`. 7 unit tests in new `src/lib/queries/optimistic.test.ts` against a real `QueryClient` (happy path, empty-input no-op, rollback, partial match for delete; happy path, rollback, nested-field patching for move). First test coverage for `optimistic.ts` — partially closes T-7.
- Commit 2 (H2, B-2) — `4ebcc07` — `editItem` mutation rewritten at both `GearLibraryPage` and `ListDetailPage`. Each call site now enumerates the `['list-items']` caches that actually contain the affected gear, snapshots them, writes the patch into each cache's embedded `gear_item` (including `category_id`), rolls back on error, and invalidates only those specific caches on settled. Fixes the H2 fan-out cost AND the B-2 reorder-corruption race in one pass. Hand-rolled at both sites per spec; helper extraction deferred.
- Commit 3 (H3, B-4, B-2-at-scale) — `935ed1b` — `bulkDelete` and `bulkMove` on the gear page rewired through Commit 1's helpers with explicit composition (`onMutate` from helper, `onError` calls helper rollback then `showToast`, `onSuccess` only fires `exitSelectMode`). `bulkDelete` narrows list-items invalidation to caches that actually contained one of the deleted ids. `bulkMove` adds the same optimistic `category_id` fan-out as Commit 2 across the full id-set, closing B-2 at scale. Two dead `invalidate*` callbacks removed.

### Verification results

- `npm run build`: pass after all three commits.
- `npm test --run`: 23/23 pass (4 skipped — pre-existing bulk-reorder integration tests with no test-account data, unrelated to this phase).
- Manual smoke (drag-reorder race, bulk-delete error toast, bulk-move + reorder race, hard-refresh): **pending user verification** — these gates require a running browser. Per CLAUDE.md ("hard-refresh after a write to confirm the server accepted"), recommend confirming on real data before considering Phase 2 field-tested.

### Blockers / surprises

- **Toast utility was already present.** `showToast` in `src/lib/toast.ts` is used by `makeOptimisticReorder` and `makeRollback`. Used directly rather than introducing local error state — my pre-flight assumption 1 was wrong, which meant Commit 3's UX shape converged on the rest of the app instead of diverging.
- **Barrel re-export needed.** `src/lib/queries/index.ts` re-exports the optimistic helpers; the two new ones had to be added there too. One-line addition; no callsite-shape impact.
- **Two dead invalidator callbacks removed.** `invalidateItems` / `invalidateListItems` in `GearLibraryPage` were the only callers of the old bulk `onSuccess` shape. With both bulk paths inline-narrow now, they were unused. Per CLAUDE.md ("If you are certain that something is unused, you can delete it completely") — removed in Commit 3.
- **`useMutation` spread-vs-override.** Mixing a spread helper with a custom `onError` overrides the helper's rollback. Resolved by explicit composition: `onMutate: helper.onMutate`, then `onError: (err, vars, ctx) => { helper.onError(err, vars, ctx); showToast(...) }`. Pattern reads cleaner than inheritance and makes the rollback path obvious.

### Next phase

Phase 3: bundle splitting (H4 react-markdown lazy, H5 vaul lazy, H6 fflate dynamic, L7 route code-split). Independent fixes verifiable with build size before/after.

---

## Phase 3 — bundle splitting (2026-05-04)

### Shipped

- **Commit 1 (H6) — `8dcdcbb`** — fflate dynamic-import in SettingsPage download handler. Main bundle gzip: **261.02 → 256.48 KB (-4.54 KB)**. New `browser-*.js` chunk (4.44 KB gzip) holds the fflate browser entry. Smaller delta than the audit's ~20 KB estimate because only `zipSync` + `strToU8` are imported and fflate tree-shakes aggressively.
- **Commit 2 (H4) — `b33b144`** — react-markdown lazy-load on About + Help routes. Main bundle gzip: **256.48 → 209.95 KB (-46.53 KB)**. New `MarkdownPage-*.js` chunk (46.08 KB gzip) holds the entire markdown stack. **Largest single bundle win in Phase 3.**
- **Commit 3 (L7) — `4e77846`** — auth pages + SharePage code-split. Main bundle gzip: **209.95 → 204.91 KB (-5.04 KB)**. Five new auth/share chunks (1.0–1.3 KB gzip each) plus a shared jsx-runtime chunk (3.26 KB).

**Cumulative gzip delta: 261.02 → 204.91 KB = -56.11 KB (−21.5% off baseline).**

### Held — H5 (vaul)

H5 was attempted and reverted. Lazy-loading the mobile drawer in `ListSelector` alone yielded **+0.55 KB** to the main bundle (Suspense/lazy machinery cost slightly more than the drawer wrapper saved) because vaul stays eagerly required by `ListDetailPage.tsx`'s sidebar drawer, which renders unconditionally on every list view (only hidden by `lg:hidden` CSS, no JS render gate). Adding a JS viewport gate to ListDetailPage's drawer is M11 scope. Per the Phase 3 spec's "stop and surface rather than expand scope" rule, H5 is deferred until M11 lands; structural prerequisite is unchanged (extract the drawer wrapper) and can be re-attempted then.

### Verification results

- `npm run build`: pass after each commit; new async chunks visible in `dist/assets/`.
- `npm test --run`: 23/23 pass (4 skipped pre-existing).
- Manual smoke (download zip, /about + /help render, auth routes, /r/:slug): **pending user verification** — the build can't catch chunk-fetch errors or Suspense-fallback flash.

### Blockers / surprises

- **H5 doesn't deliver in isolation.** The audit's expected ~15-20 KB win for vaul-lazy is gated on M11's JS viewport gate; without it, lazy-loading just one of the two vaul consumers leaves vaul in main and adds Suspense overhead. Reverted cleanly. Keeping the same H5 entry in the next phase that includes M11.
- **fflate delta smaller than expected.** Audit estimated ~20 KB; actual ~4.5 KB. Tree-shaking is more aggressive than the audit assumed. Pattern still valid for future cold-path deps.
- **Vite chunks default-export deduplication works as expected** — both `AboutPage` and `HelpPage` reference `lazy(() => import('../components/MarkdownPage'))` and end up sharing one chunk.

### Next phase

Phase 4 candidates: render-perf cluster (M6, M7, M8, M11, M12) — closing M11 then re-attempting H5 would land vaul in async. Or DB indexes (H1, M1) for backend perf. Recommend render-perf next so H5 can complete.

---

# grampacker — Phase 4 fix summary (2026-05-05)

## Shipped

- **Commit 1 (M11) — `d8c1032`** — Two breakpoint hooks (`useIsBelowLg` at 1023px, `useIsMobile` at 767px) hoisted to `src/lib/use-breakpoint.ts`, implemented with `useSyncExternalStore`; row-level listener blowup is avoided by page-level prop drilling (one hook call per page rather than per row). Three `<lg` branches JS-gated via prop-drilled `isBelowLg` from page-level: `ItemRow.tsx` (mobile/desktop bodies), `GearItemRow.tsx` (same), `ListDetailPage.tsx` (sidebar drawer mount). Main bundle gzip: **204.91 → 205.09 KB (+0.18, expected — vaul still statically imported here, structural prep only).**
- **Commit 2 (H5 retry) — `88041c0`** — Both vaul drawers now `React.lazy`-loaded behind their `isMobile` / `isBelowLg` JS gates. Re-created `ListSelectorDrawer.tsx` (reverted in Phase 3) and added new `ListSidebarDrawer.tsx`. Main bundle gzip: **205.09 → 186.40 KB (-18.69 KB).** Vaul moved to two async chunks (`ListSelectorDrawer-*.js` 0.54 KB gzip, `ListSidebarDrawer-*.js` 0.64 KB gzip) plus the shared vaul runtime in the existing dist chunk. Phase 3's H5 carry-over closed.
- **Commit 3 (M8) — `560a5a8`** — `sharedGroupProps` deps in `ListDetailPage.tsx` no longer churn on every list-items / gear-items mutation. `gearItems` and `listItems` arrays now read through refs; both removed from the memo dep array. Closures inside the memo see the freshest data via the ref bindings; the memo itself only rebuilds when the truly-stable inputs (mutation handles, modal setters, primitives) change.
- **Commit 4 (M7, M12) — `db98e75`** — `LibraryPanel.tsx`: `filtered`, `sortedCats`, `groups`, `uncategorized` wrapped in `useMemo`; inner `CategoryGroup` wrapped in `React.memo` after API change to `(toggleKey: string, onToggle: (key: string) => void)` so the parent can pass a stable `useCallback`'d toggleCollapse instead of fresh inline arrow closures (which would have defeated the shallow-compare). **Initial pass missed two upstream prop-stability holes** — corrected in the follow-up commits below. Build flat (186.40 → 186.49 KB, +0.09 — render-perf fix, no bundle motion expected).
- **Follow-up — `8862315`** — Codex review pass on Phase 4 surfaced four issues:
  1. **Lint failure (high).** Commit 3's `gearItemsRef.current = gearItems` / `listItemsRef.current = listItems` during render tripped React 19's new `react-hooks/refs` rule. Switched to a new `useLatestRef<T>(value)` helper in `src/lib/use-latest-ref.ts` that updates the ref in `useEffect`. Behavior unchanged for our use case (all reads are inside post-commit event handlers); rule satisfied.
  2. **`onAdd` / `onRemove` were inline arrows on each render.** LibraryPanel's React.memo barrier on the inner CategoryGroup was being defeated by fresh closures from the parent. Stabilized via `useCallback` + `listItemsRef.current` lookup in `onLibraryRemove`. Same eslint-disable / mutation-ref convention as `sharedGroupProps`.
  3. **`listItemGearIds` Set churned on pack-mode toggles.** The naive `useMemo([listItems])` minted a fresh Set on every is_packed toggle even though gear-id membership was unchanged. Switched to a derived primitive key (`gearIdsKey = sorted gear_item_ids joined`) computed during render and used as the memo dep. The Set keeps its prior reference until membership actually changes.
  4. **Inaccurate listener-sharing comment in `use-breakpoint.ts`.** Reworded to clarify that `useSyncExternalStore` does NOT dedupe `matchMedia` 'change' listeners at the DOM level — the protection against listener-per-row blowup comes from page-level prop-drilling (one hook call per page, ~3 listeners total app-wide).

**Cumulative bundle delta from Phase 3 baseline: 204.91 → 186.51 KB = -18.40 KB (−9.0%).**
**Cumulative bundle delta from Phase 0 baseline: 261.02 → 186.51 KB = -74.51 KB (−28.5%).**

## Verification results

- `npm run build`: pass after each commit. Two new vaul chunks visible after Commit 2.
- `npm test --run`: 23/23 pass after each commit (4 skipped pre-existing).
- Manual smoke: **pending user verification.** Specifically:
  - Mobile / tablet (<1024 px): hamburger drawer mounts, ListSelector bottom sheet works, all row interactions preserved.
  - Desktop (≥1024 px): React DevTools shows no `Drawer` component in the tree on `/lists/:id`; Network panel shows no vaul chunk fetched on initial load.
  - Pack-mode rapid toggle: LibraryPanel prop churn has been reduced (`sharedGroupProps` memo holds; `onLibraryAdd`/`onLibraryRemove` are stable callbacks; `listItemGearIds` Set is stable across pack toggles). The list-page `CategoryGroup` (`src/lists/CategoryGroup.tsx`) is NOT yet `React.memo`-wrapped, and `groupListItemsByCategory()` still produces fresh group/item array references whenever `listItems` changes, so a pack-checkbox mutation can still re-render category sections on the right column. **Scoped-render behavior on the list page still needs profiler verification** and likely a follow-up phase to memoize the list-page CategoryGroup + stabilize the grouping output.

## Blockers / surprises

- **Codex pre-flight catch — breakpoint mismatch.** Initial Phase 4 spec used `useIsMobile()` (767 px) for all three M11 sites, but Tailwind's `lg:hidden` switches at 1024 px. Without the fix, tablets (768–1023 px) would have rendered desktop bodies the CSS layer expected to hide. Patched the spec to introduce a separate `useIsBelowLg()` hook (1023 px) for `<lg` sites, kept `useIsMobile()` for the genuinely-md-only ListSelector bottom sheet. Both hooks share one `useSyncExternalStore` subscription factory.
- **Codex pre-flight catch — listener proliferation.** Naive `useIsBelowLg()` per row would have meant ~300 matchMedia listeners on a long list. Two defenses landed: (1) `useSyncExternalStore` dedupes inside React, (2) hook is called once at the page level and prop-drilled to rows. Belt-and-braces.
- **Codex pre-flight catch — React.memo defeated by inline closures.** First-pass M12 plan was `React.memo(CategoryGroup)` alone; would not have helped because `onToggle={() => toggleCollapse(id)}` mints a fresh arrow per render and breaks shallow-compare. Actual fix changed the component API to accept `toggleKey` + `onToggle(key)` so the parent can pass a stable callback. Documented as Parts A/B/C in the patched spec.
- **Phase 3 H5 closure.** Once M11 landed, H5's vaul-lazy retry produced the expected double-digit win (-18.69 KB) instead of Phase 3's +0.55 KB regression. Confirms the diagnosis that vaul couldn't be moved off the main graph until both consumer sites were JS-gated.
- **No bundle motion in Commits 1, 3, 4.** Expected: M11 is structural prep, M8 + M7 + M12 are render-time fixes that don't change what code ships. The whole Phase 4 bundle delta lives in Commit 2.

## Next phase

Phase 5 candidates:
- **Lower-leverage perf cleanups** — M6 (single-pass bucket map in grouping helpers), L1 (WeightTable memo), L2 (SharePage categoryIds memo), L9 (hoisted Intl formatter).
- **W-1** — `useAnchoredMenu` refactor (extract the recurring popover-position calculation across HamburgerMenu, PrivacyButton, RowKebab variants).
- **W-7** — rename inner `CategoryGroup` in `LibraryPanel.tsx` to break the name shadow with `src/lists/CategoryGroup.tsx`.
- **DB indexes (H1, M1)** — backend perf, requires migration. Separable phase.
- **Test-coverage cluster T-2…T-9** — Phase 7 territory; would benefit from adding jsdom + @testing-library first.

Recommend Phase 5 as the small-perf cleanup pass plus W-1 (mechanically distinct from render perf, but the same surface area). DB indexes are a clean separable phase whenever convenient.

---

# grampacker — Phase 5 fix summary (2026-05-05)

## Shipped

- **Commit 1 (M6 + Codex Phase 4 follow-up) — `6491c7c`** — `groupListItemsByCategory` rewritten as single-pass bucket map (O(N+C) instead of O(N×C)) with structural per-group stability merge AND top-level identity invariant (returns `prior` itself when no group changed). The new `src/lib/use-grouped-list-items.ts` calls `setState` during render under the loop guard provided by the top-level identity invariant — `react-hooks/refs` rejects render-time ref writes (Phase 4 follow-up fixed this in ListDetailPage), but React explicitly allows setState-during-render for the "store information from previous renders" pattern when guarded against loops. 8 new grouping tests cover the structural-stability invariants, including a description-edit regression case (Codex finding 1 from the Phase 5 spec review).
- **Commit 2 (CategoryGroup memo + stable onAddItem) — `5c18013`** — `src/lists/CategoryGroup.tsx` exported via `React.memo` (default shallow compare). `onAddItem` API widened from `(data) => void` to `(categoryId, data) => void` so the parent passes a single `useCallback`'d handler instead of two fresh per-call-site curried arrows that defeated memo on every render (Codex finding 3 from the Phase 5 spec review). The `categoryId` flows in from `CategoryGroup`'s own `categoryId` prop at the `AddItemRow.onSubmit` site.
- **Commit 3 (L1) — `bf59093`** — `WeightTable` breakdown wrapped in `useMemo([items, categories])`. Empty-list early return moved below the memo so the hook is called unconditionally. Signature corrected: `computeWeightBreakdown(items, categories)` takes only two args; `weightUnit` formatting happens at the JSX layer (Codex finding 5 from the Phase 5 spec review).
- **Commit 4 (L2) — `545327b`** — `SharePage.categoryIds` Set-spread wrapped in `useMemo([items])`.
- **Commit 5 (L9) — DROPPED** — audit claim was stale. `formatItemWeight` does not use `Intl.NumberFormat`; current implementation uses `toFixed(1)` for ounces and string interpolation for grams. Hoisting an `Intl.NumberFormat` would change displayed grams from `1250 g` to `1,250 g` (added thousands separator) and ounce precision — that's a UX-visible policy decision, not a perf fix. Filed as audit-stale here; if locale-aware grouping is desired, propose it as a separate user-visible commit with explicit before/after screenshots in a future phase. (Codex finding 4 from the Phase 5 spec review.)
- **Follow-up — `ba7dfab`** — Codex (2026-05-05) flagged that with `groupWorn` enabled, the Phase 5 render-scope goal broke down. The page-level `displayedGrouped` useMemo did `grouped.map(g => ({ ...g, items: g.items.filter(i => !i.is_worn) }))`, minting fresh group objects AND fresh items arrays for EVERY category on every list-items mutation — defeating `React.memo(CategoryGroup)` exactly the way Phase 5 was meant to prevent. Two-part fix: (1) drop `displayedGrouped` and hide is_worn at the leaf via a new `hideWorn` prop on CategoryGroup, mirroring the existing `showUnpackedOnly` shape (primitive bool, doesn't churn); (2) replace `wornItems` useMemo with a new `useStableWornItems` hook (`src/lib/use-stable-worn-items.ts`) that uses the same setState-during-render pattern as `useGroupedListItems`, returning the cached array when worn-item references are unchanged. With Phase 5 Commit 1's structural stability already in place upstream, referential equality at each index is sufficient.

**Bundle gzip:** 186.51 → 186.86 KB (+0.35 KB). Tiny regression from the new hook + memo wrapper + extra refs; offset is render-perf, not bundle.

## Verification results

- `npm run build`: pass after each commit.
- `npm run lint`: pass — react-hooks/refs and react-hooks/set-state-in-effect both clean.
- `npm test --run`: 31/31 pass (was 23/23; +8 grouping tests).
- Manual smoke: **pending user verification.** Specifically:
  - Pack-mode rapid toggle on a list with 3+ categories of 3+ items, **with AND without Group Worn enabled**: React DevTools profiler should show only the affected `CategoryGroup` + `ItemRow` re-rendering on each tick; other categories should appear gray (skipped). The Group-Worn-on case was added by the `ba7dfab` follow-up — earlier the page-level `displayedGrouped` map+filter would have re-rendered every category in this mode. **This is the verification step Phase 4 skipped — running it is what closes the pack-mode render-scope claim.**
  - Add new item via "+ Add new item" footer in any category (categorized AND uncategorized): item adds to the correct category. The widened `onAddItem` signature is a wire-protocol change, so this confirms the categoryId flows correctly.
  - Share-view (L2): open `/r/<slug>` for any shared list; categories render unchanged.
  - Description edit on a list-item's gear (regression for Codex finding 1): edit description, save, confirm new text appears immediately (the comparator now includes `gear_item.description`).

## Blockers / surprises

- **Codex pre-flight catch — comparator missing `description` field.** First-pass comparator excluded `gear_item.description` on the assumption that timestamps and metadata could be skipped. Desktop ItemRow renders and edits description, so excluding it would have produced stale UI after a description edit. Patched into the spec before execution.
- **Codex pre-flight catch — render-time ref writes were going to repeat the Phase 4 lint failure.** Initial spec used `useRef` + render-time write for the prior-result cache. React 19's `react-hooks/refs` rule rejects this. Switched to `useState`-during-render under the React-blessed "store info from previous renders" pattern. The loop guard required adding a top-level identity invariant to `groupListItemsByCategory` so `next === cached` short-circuits when nothing changed.
- **Codex pre-flight catch — `onAddItem` was missing from the prop-stability audit.** First-pass audit table listed all CategoryGroup props but missed `onAddItem`. Fix shape required widening the component API rather than just memoizing the closure (the per-call-site categoryId currying made closure-memoization awkward). Widened to `(categoryId, data) => void`.
- **Codex pre-flight catch — L9 premise was stale.** The audit claimed `Intl.NumberFormat` was constructed per call; the file actually uses `toFixed`. Dropped L9 entirely with a documentation entry for the audit ledger.
- **Codex pre-flight catch — WeightTable signature wrong in spec.** Spec showed `computeWeightBreakdown(items, categories, weightUnit)`; actual signature is `(items, categories)`. Fixed before execution.
- **Hooks ordering.** WeightTable's empty-list early return was BEFORE any hook calls; adding `useMemo` required moving the early return below the memo so the hook is called unconditionally on every render. Caught by the linter.
- **Profiler verification still pending.** All five Codex findings on the spec were patched before execution, and the structural design is consistent with the goal, but a user-side React DevTools profiler trace is the only thing that confirms `React.memo(CategoryGroup)` actually skips unchanged categories on pack-mode toggles.

## Next phase

Phase 6 candidates:
- **W-1** — `useAnchoredMenu` refactor (extract the recurring popover-position calculation across HamburgerMenu, PrivacyButton, RowKebab variants).
- **W-7** — rename inner `CategoryGroup` in `LibraryPanel.tsx` to break the name shadow with `src/lists/CategoryGroup.tsx`.
- **DB indexes (H1, M1)** — backend perf, requires migration. Separable phase.
- **Test-coverage cluster T-2…T-9** — Phase 7 territory; would benefit from adding jsdom + @testing-library first.
- **Locale-aware weight formatting** — if thousands-separator grouping is desired, propose as user-visible UX commit with before/after screenshots.

Recommend W-1 + W-7 as a small quality refactor pass next, OR jump to DB indexes if backend perf is the higher priority.

---

# grampacker — Phase 6 fix summary (2026-05-05)

## Shipped

- **Commit 1 (H1 + M1) — `9482882`** — four covering indexes added in `supabase/migrations/20260509000000_list_items_and_lists_indexes.sql`:
  - `list_items_user_list_sort_idx (user_id, list_id, sort_order)` — covers AUTHED `fetchListItems` end-to-end. Index range scan on the predicate, no extra sort step.
  - `list_items_list_sort_idx (list_id, sort_order)` — covers ANON `fetchSharedListItems` (no user_id predicate; the composite above's leftmost prefix is unusable here), the `lists.id → list_items.list_id` cascade, `resetPackedForList`, and the per-list-item cap trigger. The trailing `sort_order` column gives the share-view an index-ordered scan.
  - `list_items_gear_item_id_idx (gear_item_id)` — covers the `gear_items.id → list_items.gear_item_id` cascade. Pre-fix, deleting a gear_item degraded to a seq scan to find matching rows.
  - `lists_user_sort_idx (user_id, sort_order, name)` — covers `fetchLists`. Mirrors `categories_user_sort_idx` and `gear_items_user_idx`.

  Codex pre-flight catch: the original spec used `(list_id)` alone for index #2, which would not have helped `fetchSharedListItems` skip a sort step and would have left the share-view query plan partially optimized. Rewrote to `(list_id, sort_order)` before execution.

  Pre/post `EXPLAIN ANALYZE`: not captured. Optional follow-up if planner traces are wanted in the audit ledger.

## Verification results

- `npm run build`: pass; bundle gzip 187.02 KB (DB-only change; no source delta — the small drift from Phase 5's 186.86 is from interim follow-up commits, not this migration).
- `npm run lint`: pass; no source files changed.
- `npm test --run`: 31/31 pass.
- **Migration applied to production and verified** (2026-05-05). User ran `supabase db push` and `select indexname from pg_indexes where tablename in ('list_items', 'lists')`; output confirmed all four new indexes live alongside the pre-existing pkey / unique-slug / composite-FK indexes:
  - `list_items_gear_item_id_idx` ✓
  - `list_items_list_sort_idx` ✓
  - `list_items_user_list_sort_idx` ✓
  - `lists_user_sort_idx` ✓
- Manual smoke (post-apply): pending. Load `/lists`, `/lists/<id>`, `/r/<slug>`, mutate a list_item — confirm no regressions. Optional `EXPLAIN ANALYZE` on the canonical predicates to confirm Index Scan replaces Seq Scan.

## Blockers / surprises

- **Codex pre-flight catch (medium).** Spec's index #2 was `(list_id)` only — would not have covered `fetchSharedListItems` (which sorts by `sort_order`). Rewrote to `(list_id, sort_order)` before execution; the spec patch is in `.planning/REVIEW-PHASE6.md`.
- **Codex pre-flight catch (low).** Spec's lock-mode note was inaccurate: plain `CREATE INDEX` takes a `SHARE` lock (blocks writes, permits reads), not `ACCESS EXCLUSIVE`. Corrected.
- **Migration apply is a user-side step.** The local agent committed the migration but couldn't run `supabase db push` interactively. User applied it on 2026-05-05 and confirmed via `pg_indexes`; the four new indexes are live in production. (Resolved.)

## Next phase

Phase 7 candidates:
- **Small perf nits cluster** — actual L9 (`formatPurchaseDate` Intl per call), M9 (`formatRelativeDate`), M4 (`RootRedirect` cold-load block), L3-L4 (DnD memo), M13 (`lucide-react` tree-shaking audit). Cheap wins that ride together.
- **RPC consolidation** — M2 (`addNewItemMut` two round-trips) and M3 (`duplicateList` / `createListFromSelection` 2-3 round-trips). Higher-value backend perf, requires migration with new RPCs.
- **Quality refactors** — W-1 (`useAnchoredMenu` extraction), W-7 (CategoryGroup name shadow rename), W-2…W-13 (type/clarity nits).
- **Security hardening** — F4 (anon enumeration), F5 (ESLint rule), F8 (SW cache auth-keying decision).
- **Test-coverage cluster** — T-3…T-9; needs jsdom + @testing-library install.

Recommend Phase 7 as the small-perf-nits cluster (cheapest commit shape, several stale audit items to close), OR M2/M3 RPC consolidation if the user-creation flow latency is the bigger user-visible pain.

---

# grampacker — Phase 7 fix summary (2026-05-05)

## Shipped

- **Commit 1 (L9 — actual) — `10fed9a`** — `formatPurchaseDate` in `src/gear/GearItemRow.tsx` now uses a hoisted `DATE_FORMATTER` (`Intl.DateTimeFormat(undefined, {...})`) alongside the existing `COST_FORMATTER`. Phase 5 mistakenly thought L9 referred to `formatItemWeight`; the actual L9 was always about purchase-date formatting. Output identical character-for-character (V8's `toLocaleDateString` is implemented via `Intl.DateTimeFormat.format` under the hood).
- **Commit 2 (M9) — `3068e91`** — relative dates on `/lists` cards now retick once a minute via a new `useNow(intervalMs)` hook (`src/lib/use-now.ts`). Pre-fix, "1 min ago" stayed "1 min ago" forever once the card mounted. ListsPage calls `useNow(60_000)` once at the page level and threads `now` through `SortableListCard` / `ListCard` / `CardMeta` props — one setInterval for the grid, not one per card. `formatRelativeDate` signature widened from `(iso)` to `(iso, now)`.
- **Commit 3 (M4) — `6c2da5a`** — `RootRedirect` redirects to the cached last-visited list_id immediately when warm, without waiting for `fetchLists`. New `src/lib/last-list-id.ts` helper (read/write/clear with UUID-shape validation, swallows localStorage exceptions). Cold path (no cached id) preserves prior behavior via `useQuery({ enabled: !cachedId })` — load-bearing hook order. Cache write in `ListDetailPage` is gated on `list?.id` resolving truthy so a stale cache doesn't get re-written on a not-found visit. Cache self-heal effect clears the cache when `!list && readLastListId() === listId` so a poisoned cache fixes itself on the next visit.
- **L3-L4 — DROPPED.** Audit classified these as "Cold path; runs once per drop; bounded." `collisionDetection` is already memoized at `src/gear/GearLibraryPage.tsx:398`; drag handlers aren't props to memoized children, so memoizing them buys nothing. Closed: no action.
- **M13 — PROBABLE PASS, full verification deferred.** Bundle size is consistent with `lucide-react` tree-shaking working: 36 distinct icons across 26 import sites, main chunk 187.26 KB gzip (everything — React, Supabase, dnd-kit, etc.), with multiple async chunks. With the multi-chunk topology a single number isn't a complete proof; a direct bundle search (`rg "createLucideIcon\|lucide-react" dist/assets/*.js`) or `vite-bundle-visualizer` run is the rigorous check, deferred unless symptoms appear.

## Verification results

- `npm run build`: pass; bundle gzip 187.02 → 187.26 KB across all three commits (+0.24 KB; useNow hook + last-list-id helper).
- `npm run lint`: pass.
- `npm test --run`: 31/31 pass.
- Manual smoke: pending user verification. Specifically:
  - **L9:** Open `/gear` with at least one item that has a purchase_date set; confirm the date renders unchanged.
  - **M9:** Open `/lists` with a card showing "X mins ago". Wait 60+ seconds. Confirm the text increments.
  - **M4 happy path:** Sign in, navigate to `/lists/<id>`, reload `/`. Expect immediate redirect with no "Loading..." flash. Confirm `localStorage.lastListId === <id>` (DevTools → Application).
  - **M4 cold path:** Clear localStorage, reload `/`. Expect brief "Loading..." then redirect to most-recently-updated list.
  - **M4 stale-cache regression:** Manually set `localStorage.lastListId = '00000000-0000-0000-0000-000000000000'`, reload `/`. Expect redirect to `/lists/00000...`, "List not found" renders, AND `localStorage.lastListId` is now removed. Reload `/` again — expect cold path. If cache wasn't cleared, the page would loop forever.

## Blockers / surprises

- Codex pre-flight catch on M4 (medium): first-pass spec wrote the cache on mount unconditionally, which would have made a stale cache sticky. Patched to write only after `list?.id` resolves truthy + clear on not-found when the cached id matches the failing route. Spec patched before execution.
- Codex pre-flight catch on M13 (low): first-pass closure overclaimed "verified empirically" based on main-bundle size alone, but with the multi-chunk topology that's not a complete proof. Reworded to "probable pass, full verification deferred."
- Did NOT wire `clearLastListId` into the signout handler. The cache self-heal effect on the not-found branch is the safety net; explicit signout-clear is a one-line follow-up if the not-found flicker on user-switch becomes annoying.

## Next phase

Phase 8 candidates:
- **RPC consolidation (M2, M3)** — `addNewItemMut` two-round-trip collapse and `duplicateList` / `createListFromSelection` 2-3 round-trip collapse. Higher-value backend perf, requires a migration with new RPCs.
- **Quality refactors** — W-1 (`useAnchoredMenu` extraction), W-7 (CategoryGroup name-shadow rename), W-2…W-13 (type/clarity nits).
- **Security hardening** — F4 (anon enumeration), F5 (ESLint rule), F8 (SW cache auth-keying decision).
- **Test-coverage cluster** — T-3…T-9; needs jsdom + @testing-library install.

Recommend Phase 8 as the RPC consolidation pass — it's the last remaining backend-perf cluster and closes the high/medium audit items in `Network / TanStack Query`.

---

# grampacker — Phase 8 fix summary (2026-05-05)

## Shipped

- **Commit 1 (RPCs) — `36ac831`** — three SECURITY DEFINER functions added in `supabase/migrations/20260510000000_add_consolidated_mutation_rpcs.sql`: `add_gear_item_with_list_item`, `create_list_from_selection`, `duplicate_list`. Pattern matches the existing `bulk_update_sort_order` (auth.uid() guard + `set search_path = public, pg_temp` + hardened `revoke from public, anon` + `grant to authenticated`). RLS is bypassed inside SECURITY DEFINER, so each function explicitly verifies ownership of any user-controlled id (`p_list_id`, `p_gear_item_ids`, `p_source_list_id`) and raises `P0002` on miss before any write. Slug retry stays client-side via the existing `withSlugRetry` wrapper.
- **Commit 2 (M2) — `ab98d7f`** — `addNewItemMut` in `ListDetailPage.tsx` now does one `supabase.rpc('add_gear_item_with_list_item', …)` call instead of `createGearItem` + `addGearItemToList` chain. Two RTT → one. Removed the now-unused `createGearItem` import (the helper is still used by `GearLibraryPage.tsx`'s separate add-to-inventory flow).
- **Commit 3 (M3a) — `c95c3d5`** — `createListFromSelection` in `lib/queries/lists.ts` now wraps a single `supabase.rpc('create_list_from_selection', …)` call in `withSlugRetry`. Two RTT → one.
- **Commit 4 (M3b) — `dfb8fac`** — `duplicateList` similarly. Three RTT → one. The `' (copy)'` name suffix and source-row field copy now happen server-side inside the RPC. Removed the now-unused `ListItem` type import.
- **Follow-up — `8376371`** — `20260510000001_fix_add_gear_item_category_ownership.sql` adds an explicit `p_category_id` ownership check to `add_gear_item_with_list_item` (was missing in the original migration; relied solely on the composite FK to reject another user's category). RLS is bypassed inside SECURITY DEFINER, so the explicit check matches the spec's "verify any user-controlled id before writing" rule and produces a clear `P0002 category not found` instead of a deferred FK failure. CREATE OR REPLACE — applies on top of the already-deployed function.

## Visible behavior changes (intentional improvements)

All three RPCs run in single transactions, so a failed second insert now rolls back the parent list/gear row. Previously:
- `addNewItemMut` could leave an orphan `gear_items` row if the `list_items` insert failed. With the follow-up category-ownership check, a stale or invalid `category_id` now also rejects up-front (`P0002 category not found`) instead of producing a deferred FK error after the gear row was queued for insert.
- `createListFromSelection` could leave an empty list if the bulk `list_items` insert failed (cap trigger, stale gear_item_id).
- `duplicateList` could leave an empty copy if the bulk `list_items` insert failed.

After Phase 8, every gesture is atomic.

## Verification results

- `npm run build`: pass; bundle gzip 187.26 KB → 187.24 KB (−0.02 KB; client code shrank slightly).
- `npm run lint`: pass.
- `npm test --run`: 31/31 pass (4 skipped, unchanged).
- Migration applied to production: **pending user-side `supabase db push`** — local agent can't run it.
- Manual smoke (single network call per gesture, hard-refresh persistence, pre-write ownership rejection via DevTools console with bogus uuid → expect `P0002`): **pending user-side**.

## Blockers / surprises

None during execution. Two `tsc` follow-ups needed pruning unused imports (`createGearItem` in `ListDetailPage.tsx`, `ListItem` type in `lib/queries/lists.ts`) — both caught by the build and resolved in their respective commits.

## Next phase

Phase 9 candidates (no clear winner — user picks):
- **Quality refactors** — W-1 (`useAnchoredMenu` extraction), W-7 (CategoryGroup name-shadow rename), W-2…W-13 (type/clarity nits). Several small commits, low risk, no perf payoff.
- **Security hardening** — F4 (anon enumeration), F5 (ESLint rule), F8 (SW cache auth-keying decision).
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install.

After Phase 8, `REVIEW-performance.md` is substantially closed: H1–H6 done, M1–M13 done (M2 + M3 closed by this phase), L1–L9 done or audit-stale dropped. Remaining perf items would be backend/infrastructure (Cloudflare cache headers, etc.) or speculative (sub-millisecond memo wins) — neither warrants a dedicated phase.

---

# grampacker — Phase 9 fix summary (2026-05-05)

## Shipped

- **Commit 1 (W-1) — `f0f340d`** — `useAnchoredMenu` extracted in `src/lib/use-anchored-menu.ts`. Four sites converted: `ItemRow` (w-48 / 192px), `GearItemRow` (w-48 / 192px), `ListsPage` per-card kebab (w-44 / 176px), `HamburgerMenu` (right-anchored, w-48 / 192px). Two anchor variants (`right-flush`, `right-anchored`). `usePortalPopover` remains the dismiss-listener layer underneath. Out-of-scope sites (PrivacyButton, ListActionsKebab, ListSelector) intentionally left alone — bespoke positioning, separate cleanup.
- **Commit 2 (W-4) — `b12cab6`** — `useRequireSession` added in `src/auth/use-require-session.ts`. Six sites converted to a single safe shape (`const auth = useRequireSession()`, `const userId = auth?.userId ?? ''`, all hooks unchanged, `if (!auth) return null` after the last hook where applicable). Hook order preserved at every site. Sites with no prior early return (NavBar sub-components, RootRedirect) keep their pass-through behavior; bang-pattern sites (GearLibraryPage, ListsEmptyState) now have a defensive early return that the parent guard makes unreachable in practice.
- **Commit 3 (W-7) — `5870941`** — `LibraryPanel`'s inline `CategoryGroup` renamed to `LibraryCategoryGroup` (4 occurrences in one file). Removes the shadow against the public `lists/CategoryGroup`.
- **Commit 4 (W-13) — `de77b9e`** — `parseCost` in `src/lib/csv.ts` now caps at 99,999,999.99 (matches the `numeric(10,2)` column max). Prior behavior: an over-cap row aborted the entire bulk INSERT with Postgres 22003 `numeric_value_out_of_range`. Now: the row imports with cost clamped to the column max. Regression test added; suite is now 32 passed | 4 skipped (was 31 passed | 4 skipped).

## Verification results

- `npm run build`: pass; bundle gzip 187.24 KB → 187.32 KB (+0.08 KB; runtime code-shape variance, not the added test — test files aren't in the production bundle. The W-1 dedup and the W-13 one-line cap are both small enough that minifier/chunking variance dominates).
- `npm run lint`: pass.
- `npm test --run`: 32 passed | 4 skipped (1 new csv-cost-cap regression test in W-13; previously 31 passed | 4 skipped).
- Manual smoke: pending user-side. Recommended:
  - All four kebabs (list-item, gear-item, list-card, NavBar hamburger) open/close cleanly, dismiss on outside-click / scroll / resize / escape, position correctly near viewport edges.
  - Sign out / sign in cycle on `/lists`, `/gear`, `/`, `/lists/<id>` without console errors or render flashes.
  - LibraryPanel's category groupings render unchanged.
  - CSV import with a row containing an over-cap cost succeeds with the value clamped.

## Blockers / surprises

None during execution. Two follow-ups that fell out naturally:

- `useAnchoredMenu`'s `MenuPos` is a discriminated union (`{top, left} | {top, right}`) — call sites narrow with `'left' in menuPos` / `'right' in menuPos` before reading the coordinate. Slightly more verbose at the JSX site but eliminates the union-narrow ambiguity.
- W-4: NavBar's two sub-components and RootRedirect didn't have prior early returns; preserved that behavior rather than introducing a new one. Documented in the commit message so the asymmetry isn't surprising to a future reader.

## Next phase

Phase 10 candidates (no clear winner — user picks):
- **More quality refactors** — W-2 (assignSortOrderSlots redundant slice), W-3 (withSlugRetry typeguard), W-5 (sort_order out of patch types), W-6 (groupByCategory consolidation — careful, touches Phase 5 stability layer), W-8 (`category!` non-null assertions), W-9 (docstring hoist), W-10 (placeholder slug helper), W-11 (sorted cache key), W-12 (parseDnDId tighten). Many small commits; no perf or correctness payoff individually.
- **Medium quality** — M-1 (production observability for failed mutations), M-2 (optimistic `updated_at` bump), M-3 (ListSelector mid-flip), M-5 (CSV reader error/abort), M-7 (RootRedirect re-sort → reduce), M-8 (gearById Map), M-10 (consumable-vs-worn precedence assert).
- **Security hardening** — F4 (anon enumeration of shared slugs), F5 (`react/jsx-no-target-blank` ESLint rule), F8 (SW cache auth-keying decision).
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install.
- **Bug cluster** — B-1 (WeightTable orphan-category drop), B-2 (stale embedded category_id), B-4 (silent bulk action failures).

After Phase 9, `REVIEW-quality.md` is partially closed: W-1 (biggest extraction win), W-4 (auth boilerplate), W-7 (namespace fix), W-13 (real bug). Remaining W- items are mostly micro-cleanups; M- items have observable behavior changes that warrant a separate review pass.

---

# grampacker — Phase 10 fix summary (2026-05-05)

## Shipped

- **Commit 1 (F4 cheap path) — `8eee620`** — `src/lists/PrivacyPanel.tsx` copy tightened from "Anyone with this link can view the list" to "Public — anyone can view this list, and public lists may be discoverable without the link." The "may be discoverable" wording is deliberately precise: there's no visible public directory in the app, but slugs can be enumerated via `GET /rest/v1/lists?is_shared=eq.true&select=slug`. The new copy correctly conveys "link is not the gate" without claiming a directory UI that doesn't exist. The full SECURITY DEFINER reshape (revoke anon SELECT, route public reads through `fetch_shared_list` RPC, reshape three other policies) remains out of scope per the audit's recommendation.
- **Commit 2 (F5) — `7016f39`** — `CLAUDE.md` "What NOT to do" gained a guardrail bullet for `target="_blank"` + `rel="noopener noreferrer"`. Did NOT install `eslint-plugin-react`: the codebase has exactly one current `target="_blank"` site (`src/components/MarkdownPage.tsx:39`, JSX spread form, already correctly paired), and modern browsers default `_blank` to `noopener`. Linting one already-compliant site doesn't earn the dependency.
- **Commit 3 (F7) — `aa42fd0`** — `SECURITY.md` gained an "Operational checklist" capturing the five Supabase dashboard verifications (access token TTL, refresh token rotation, reuse interval, redirect URL allowlist, "Confirm email"). Doc-only; the actual dashboard verification remains a user-side task tracked via the literal `Last verified: <YYYY-MM-DD by name>` line.
- **Commit 4 (F8) — closed by prior change.** Verified `vite.config.ts:27-31` already contains an SW-cache URL-keyed guardrail comment that matches the **substance** of the F8 recommendation (single-user-per-browser assumption + the two remediation paths if it changes). The wording differs slightly from the audit's literal example ("clear caches on logout" vs. `caches.delete('supabase-rest')`), but the intent is the same. No new commit; closure documented here.

## Verification results

- `npm run build`: pass; bundle gzip 187.32 KB → 187.32 KB (one user-facing string changed; everything else is markdown).
- `npm run lint`: pass.
- `npm test --run`: 32 passed | 4 skipped (unchanged from Phase 9).
- Manual smoke: privacy panel copy renders without layout shift — pending user-side. Dashboard verification (F7): pending user-side per the new SECURITY.md checklist.

## Blockers / surprises

- F5's premise was line-stale, not zero-sites stale: `MarkdownPage.tsx` still has the safe site, just at line 39 now (and via JSX spread, so a literal `target="_blank"` grep misses it). Net call-site count: one, already correctly paired with `rel="noopener noreferrer"`. Still chose the CLAUDE.md guardrail over the plugin install — linting one already-compliant site doesn't earn the dependency.
- F8 turned out to be already-resolved by an earlier edit to `vite.config.ts` (the comment block matches the substance of the audit recommendation). Closed without a commit, documented here.

## Next phase

Phase 11 candidates (no clear winner — user picks):
- **Quality micro-refactors** — W-2 (`assignSortOrderSlots` redundant slice), W-3 (`withSlugRetry` typeguard + unused counter), W-5 (sort_order out of patch types), W-8 (`category!` non-null assertions), W-9 (docstring hoist), W-10 (placeholder slug helper), W-11 (sorted cache key), W-12 (parseDnDId tighten). Bundle of small commits, low risk.
- **W-6 standalone** — groupByCategory consolidation. Touches the Phase 5 stability layer; deserves its own phase with explicit per-site behavior verification.
- **Medium quality** — M-1 (production observability for failed mutations), M-2 (optimistic `updated_at` bump), M-3 (ListSelector mid-flip), M-5 (CSV reader error/abort), M-7 (RootRedirect re-sort → reduce), M-8 (gearById Map), M-10 (consumable-vs-worn precedence assert).
- **F4 full path** — only if the threat model changes. SECURITY DEFINER `fetch_shared_list(p_slug)` RPC, revoke anon SELECT on `lists`, reshape `list_items_public_select_shared` / `gear_items_public_select_via_shared_list` / `categories_public_select_via_shared_list`. Significant migration + RPC + four-policy reshape; warrants a dedicated phase.
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install (a one-time tooling change).

After Phase 10, `REVIEW-security.md` is substantially closed: F1, F3, F6, F11 done in earlier phases; F4 closed via cheap path here; F5, F7, F8 closed as docs/guardrails; F2 is accepted-risk for the BaaS architecture; F9, F10, F12, F13 were already info-only confirmations.

---

# grampacker — Phase 11 fix summary (2026-05-05)

## Shipped

- **Commit 1 (W-3) — `75c6b77`** — `withSlugRetry` in `src/lib/queries/lists.ts` now uses an `isPgUniqueViolation(err)` typeguard instead of an `(err as { code?: string })` soft-cast. Loop counter switched to `1..=max` form (closes audit's N-6 nit). Defensive `throw lastErr ?? new Error('exhausted retries')` retained — reachable when a caller passes `max <= 0` (loop body skipped, `lastErr` undefined); without the fallback, that path would throw undefined.
- **Commit 2 (W-5) — `d124c13`** — `sort_order` removed from all four single-row update patch surfaces: `updateGearItem` (`gear.ts`), `ListItemPatch` (`list-items.ts`), `updateList` (`lists.ts`), `updateCategory` (`categories.ts`). `bulk_update_sort_order` is now the only sanctioned path; `tsc -b` confirmed no caller currently passes `sort_order` through any of the four. The audit's W-5 wording named only gear/list-item; broadened here for a complete invariant.
- **Commit 3 (W-8) — `33744a1`** — Five `category!` non-null assertions replaced with branch narrowing (3 in `src/lists/ListDetailPage.tsx` via destructure-and-narrow inside the `.map()` callback, 2 in `src/gear/CategorySection.tsx` via swap of `{!isUncategorized && (...)}` to `{category && (...)}`). No behavior change.
- **Commit 4 (W-10) — `90ffb70`** — `optimisticListPlaceholder` helper added in `src/lib/optimistic-list-placeholder.ts`. Three sites converted (`ListsPage.tsx`, `ListsEmptyState.tsx`, `ListSelector.tsx`). The helper emits **DB-valid** placeholders — `crypto.randomUUID()` for the uuid `id` column and `generateSlug()` for the 6-char-CHECK `slug` column — so an accidental persist doesn't hit a 23514 CHECK violation or a 22P02 invalid-uuid error. **DB-valid is a constraint-failure guardrail, NOT a license to persist:** a stray `.insert()` of an optimistic row would create a real, orphan list row the server didn't authorize. The "optimistic state must not persist" invariant still belongs to every caller. Pre-flight grep confirmed no `id.startsWith('temp-')` consumer; safe to switch to real uuids. The id-only optimistic placeholders in `ListDetailPage.tsx` (list-items) and `GearLibraryPage.tsx` (gear items / categories) are intentionally NOT migrated — different shapes, different constraint profiles.
- **Commit 5 (W-11) — `5a16325`** — `fetchSharedListCategories` cache key in `src/lists/SharePage.tsx:42` now sorts ids before joining: `[...categoryIds].sort().join(',')`. Renders that produce the same set of category ids in different orders now share a cache entry instead of forcing a refetch.
- **Commit 6 (W-12) — `bc80201`** — `parseDnDId` parameter tightened from `string | number` to `string` in `src/lib/dnd-ids.ts`. Dead `if (typeof raw !== 'string') return null` body line removed. All call sites kept their `String(...)` wrappers (Pattern A). The `KINDS` const-tuple suggestion from the audit is explicitly deferred to a future stylistic-nits phase (with W-2 and W-9).

## Verification results

- `npm run build`: pass; bundle gzip 187.32 KB → 187.36 KB (+0.04 KB; runtime code-shape variance — the type-only commits add no runtime, the W-10 helper extraction is a wash).
- `npm run lint`: pass at every commit.
- `npm test --run`: 32 passed | 4 skipped (unchanged from Phase 10).
- Manual smoke: pending user-side. Recommended:
  - DnD reorder still works on `/lists` (cards), `/lists/<id>` (items within category), `/gear` (items and categories).
  - List create flow on `/lists`, zero-state `/lists` (`ListsEmptyState`), and the NavBar `ListSelector` "+ New list" — optimistic card → real card transition cleanly. Hard-refresh confirms the persisted row has the server-generated 6-char slug.
  - Shared list at `/r/<slug>` renders categories correctly.
  - Pack-mode and inline-edit on category groups (`/lists/<id>`) and category rename/delete (`/gear`) still work after the bang-removal.

## Blockers / surprises

- W-5 ended up broader than the audit's wording. The audit named only the gear and list-item patch surfaces, but `updateList` and `updateCategory` had the same loose shape. Bundling all four in one commit kept the audit ledger entry coherent and made the "no single-row sort_order writes" rule a complete invariant rather than a partial one.
- W-10 originally proposed centralizing the existing (DB-invalid) `temp-${uuid}` placeholders. After a Codex review pass, the helper now emits DB-valid uuids and 6-char slugs — so a future leak fails soft instead of fails hard. This required a pre-flight grep for `id.startsWith('temp-')` consumers (none exist) before the switch was safe.

## Next phase

Phase 12 candidates (no clear winner — user picks):
- **Pure-stylistic micro-refactors** — W-2 (`assignSortOrderSlots` redundant `.slice()`), W-9 (docstring hoist), parseDnDId `KINDS` const tuple. Two-three trivial commits, zero correctness payoff.
- **W-6 standalone** — groupByCategory consolidation. Touches the Phase 5 stability layer; deserves its own phase with explicit per-site behavior verification.
- **Medium quality** — M-1 (production observability for failed mutations), M-2 (optimistic `updated_at` bump), M-3 (ListSelector mid-flip), M-5 (CSV reader error/abort), M-7 (RootRedirect re-sort → reduce), M-8 (gearById Map), M-10 (consumable-vs-worn precedence assert).
- **F4 full path** — only if the threat model changes. SECURITY DEFINER `fetch_shared_list(p_slug)` RPC + revoke anon SELECT + four-policy reshape.
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install (one-time tooling change).

After Phase 11, `REVIEW-quality.md` is substantially closed on the W- side: W-1, W-3, W-4, W-5, W-7, W-8, W-10, W-11, W-12, W-13 done. Remaining W- items: W-2 (pure nit), W-6 (Phase-5-coupled), W-9 (pure nit). M- and B- items are either accepted (B-1..3 shipped) or pending separate phases.
