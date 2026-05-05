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
