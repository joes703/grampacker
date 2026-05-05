# grampacker — Phase 1 fix summary (2026-05-04)

## Shipped

- **F1** — `dc0b924` — `public/_headers` added (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS, Permissions-Policy, COOP).
- **M10** — `5cafad7` — `usePortalPopover` effect deps stabilized with `[onClose]`. Removes ~800 scheduled passive-effect tasks per render at full row count.
- **B-1** — `b0b6ded` — `WeightTable` routes orphan `category_id` references to Uncategorized so cache-drift between `['categories']` and `['list-items']` no longer drops grams from the headline pack-weight number. Calculation extracted into pure `computeWeightBreakdown()` helper to enable testing without a DOM environment.
- **B-3** — `3667904` — `ListDetailPage.deleteGearItemMut` switched to `makeOptimisticDelete`. Both entry points for "Delete from inventory" (gear page kebab and list page kebab) now behave identically.
- **F6** — `2f356a2` — `MarkdownPage` header comment pins the safe configuration (no rehype-raw, build-time content only).
- **F3** — `d196bf7` — Delete-account flow now requires current-password re-auth in addition to the typed-confirmation dialog. Mirrors the `ChangePasswordForm` pattern. RPC unchanged.

## Verification results

- `npm run build`: pass after each of the six commits.
- `npm test --run src/lists/WeightTable.test.ts`: 3/3 pass (orphan-category regression test, quantity multiplier, empty-array zero-state).
- `npm test --run src/lib/csv.test.ts`: 13/13 pass (no regressions in existing suite).
- Manual smoke (popover dismiss, delete-account flow): pending — single-tenant verification recommended after deploy.

## Scope notes / surprises

- **B-1 small refactor.** The project has no jsdom or `@testing-library` dependency. To write the regression test without adding a new test environment, the calculation in `WeightTable` was extracted into a pure `computeWeightBreakdown()` helper exported from the same file. Component still renders identically. This was the smallest scope expansion that produced a real regression test.
- **F3 UI shape.** The audit specified the verifyError block but didn't prescribe UI placement. The current-password input renders inside the `DeleteAccount` component immediately after the typed-confirm dialog closes — kept inside the same component, no new file. Cancel button resets state.
- **Out-of-scope held.** B-2, B-4, H1, H2, H3, M1, M6–M12, H4–H6, W-1, F2, F4, F5, F7 — none touched. As REVIEW-PHASE1.md required, no drive-by fixes.

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

- **Commit 1 (M11) — `d8c1032`** — Two breakpoint hooks (`useIsBelowLg` at 1023px, `useIsMobile` at 767px) hoisted to `src/lib/use-breakpoint.ts`, both backed by a shared `useSyncExternalStore` subscription. Three `<lg` branches JS-gated via prop-drilled `isBelowLg` from page-level: `ItemRow.tsx` (mobile/desktop bodies), `GearItemRow.tsx` (same), `ListDetailPage.tsx` (sidebar drawer mount). Main bundle gzip: **204.91 → 205.09 KB (+0.18, expected — vaul still statically imported here, structural prep only).**
- **Commit 2 (H5 retry) — `88041c0`** — Both vaul drawers now `React.lazy`-loaded behind their `isMobile` / `isBelowLg` JS gates. Re-created `ListSelectorDrawer.tsx` (reverted in Phase 3) and added new `ListSidebarDrawer.tsx`. Main bundle gzip: **205.09 → 186.40 KB (-18.69 KB).** Vaul moved to two async chunks (`ListSelectorDrawer-*.js` 0.54 KB gzip, `ListSidebarDrawer-*.js` 0.64 KB gzip) plus the shared vaul runtime in the existing dist chunk. Phase 3's H5 carry-over closed.
- **Commit 3 (M8) — `560a5a8`** — `sharedGroupProps` deps in `ListDetailPage.tsx` no longer churn on every list-items / gear-items mutation. `gearItems` and `listItems` arrays now read through refs; both removed from the memo dep array. Closures inside the memo see the freshest data via the ref bindings; the memo itself only rebuilds when the truly-stable inputs (mutation handles, modal setters, primitives) change.
- **Commit 4 (M7, M12) — `db98e75`** — `LibraryPanel.tsx`: `filtered`, `sortedCats`, `groups`, `uncategorized` wrapped in `useMemo`; inner `CategoryGroup` wrapped in `React.memo` after API change to `(toggleKey: string, onToggle: (key: string) => void)` so the parent can pass a stable `useCallback`'d toggleCollapse instead of fresh inline arrow closures (which would have defeated the shallow-compare). **Initial pass missed two upstream prop-stability holes** — corrected in the follow-up commits below. Build flat (186.40 → 186.49 KB, +0.09 — render-perf fix, no bundle motion expected).
- **Follow-up — `8862315`** — Codex review pass on Phase 4 surfaced four issues:
  1. **Lint failure (high).** Commit 3's `gearItemsRef.current = gearItems` / `listItemsRef.current = listItems` during render tripped React 19's new `react-hooks/refs` rule. Switched to a new `useLatestRef<T>(value)` helper in `src/lib/use-latest-ref.ts` that updates the ref in `useEffect`. Behavior unchanged for our use case (all reads are inside post-commit event handlers); rule satisfied.
  2. **`onAdd` / `onRemove` were inline arrows on each render.** LibraryPanel's React.memo barrier on the inner CategoryGroup was being defeated by fresh closures from the parent. Stabilized via `useCallback` + `listItemsRef.current` lookup in `onLibraryRemove`. Same eslint-disable / mutation-ref convention as `sharedGroupProps`.
  3. **`listItemGearIds` Set churned on pack-mode toggles.** The naive `useMemo([listItems])` minted a fresh Set on every is_packed toggle even though gear-id membership was unchanged. Switched to a derived primitive key (`gearIdsKey = sorted gear_item_ids joined`) computed during render and used as the memo dep. The Set keeps its prior reference until membership actually changes.
  4. **Inaccurate listener-sharing comment in `use-breakpoint.ts`.** Reworded to clarify that `useSyncExternalStore` does NOT dedupe `matchMedia` 'change' listeners at the DOM level — the protection against listener-per-row blowup comes from page-level prop-drilling (one hook call per page, ~3 listeners total app-wide).

**Cumulative bundle delta from Phase 3 baseline: 204.91 → 186.49 KB = -18.42 KB (−9.0%).**
**Cumulative bundle delta from Phase 0 baseline: 261.02 → 186.49 KB = -74.53 KB (−28.6%).**

## Verification results

- `npm run build`: pass after each commit. Two new vaul chunks visible after Commit 2.
- `npm test --run`: 23/23 pass after each commit (4 skipped pre-existing).
- Manual smoke: **pending user verification.** Specifically:
  - Mobile / tablet (<1024 px): hamburger drawer mounts, ListSelector bottom sheet works, all row interactions preserved.
  - Desktop (≥1024 px): React DevTools shows no `Drawer` component in the tree on `/lists/:id`; Network panel shows no vaul chunk fetched on initial load.
  - Pack-mode rapid toggle: code-level reasoning says CategoryGroup re-renders should be scoped to the affected row (sharedGroupProps memo holds; LibraryPanel onAdd/onRemove are stable callbacks; listItemGearIds Set is stable across pack toggles). **Profiler-confirmed measurement is pending** — the implementation is consistent with the goal but no DevTools profile capture has been run.

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
