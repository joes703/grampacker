# grampacker — Phase 2 fixes (2026-05-04)

**Source:** synthesized from `REVIEW-quality.md`, `REVIEW-security.md`, `REVIEW-performance.md`.
**Scope:** the broad-invalidation cluster — five audit findings (H2, H3, B-2, B-4, plus the carry-over B-2-at-scale on `bulkMove`) consolidated into one piece of work, shipped as **three atomic commits**.
**Why this is one phase:** all five findings are symptoms of the same underlying issue — coarse cache invalidation and missing optimistic helpers for bulk operations. Fixing them together is cheaper than fixing them individually because they share the same call sites and the same mental model.

> **Note on file paths:** all paths are repo-relative.

---

## How to execute this file

Three commits, **strict ordering** — Commit 1 must land before Commit 2 or 3. Commits 2 and 3 are independent and can land in either order, but conventionally Commit 2 (editItem) before Commit 3 (bulk ops).

For each commit:
1. Make the change exactly as specified.
2. Run `npm run typecheck` and any existing tests; both must stay green.
3. Where tests are required (Commit 1), write them and confirm they pass.
4. Commit with the suggested message.

After all three: append to `REVIEW-FIX.md` with one row per commit.

---

## Commit 1 — Add `makeOptimisticBulkDelete` and `makeOptimisticBulkMove` helpers

**Origin:** REVIEW-performance.md H3 (High) and REVIEW-quality.md B-4 (BLOCKER), infrastructure side.

**Why:** `bulkDelete` and `bulkMove` on `/gear` currently use plain `onSuccess` invalidations rather than the optimistic helper family that every other CRUD on the page uses. To wire them through the helper pattern (Commit 3), the helpers have to exist first. This commit adds them in isolation, with tests, before any call sites change.

**File:** `src/lib/optimistic.ts`

**What to add:**

Two new exported helpers, mirroring the shape and conventions of the existing `makeOptimisticDelete` and `makeOptimisticUpdate`. The agent should read the existing helpers in this file before writing the new ones — match the existing style for snapshot/rollback, error toast surfacing, and side-cache invalidation patterns.

Required signatures (sketch — adjust generic params and option names to match existing helper conventions):

```ts
// Filter-by-id-set delete. Mirrors makeOptimisticDelete but for many ids at once.
export function makeOptimisticBulkDelete<TItem, TId>(opts: {
  queryKey: QueryKey
  getId: (item: TItem) => TId
  invalidateKeys?: QueryKey[]
  // any additional options the existing helpers accept (toast, onError, etc.)
}): /* same shape as makeOptimisticDelete returns */

// Bulk patch of matching rows. Used for "move N gear items to category X".
export function makeOptimisticBulkMove<TItem, TPatch>(opts: {
  queryKey: QueryKey
  getId: (item: TItem) => string
  applyPatch: (item: TItem, patch: TPatch) => TItem
  invalidateKeys?: QueryKey[]
}): /* same shape as makeOptimisticUpdate returns */
```

**Behavioral requirements:**

- **Snapshot before mutation, restore on error.** Match the existing `setQueryData(queryKey, ctx.previous)` rollback pattern (audit: `optimistic.ts:130-138` confirms this is correct in the existing helpers).
- **Immutable writes.** Clone arrays/objects rather than mutating. Match `makeOptimisticReorder`'s clone discipline (audit: `optimistic.ts:240-245`).
- **`onError` must surface a toast.** This is the entire point of the bulk-helper additions per B-4. The toast text should be passed in by caller (don't hardcode), but the helper must call `onError` with a sensible default that can be overridden.
- **`onError` must NOT swallow the user's selection state.** B-4 specifically calls out that today's `bulkDelete` failure leaves the user in select mode with no error. The helper itself doesn't manage selection state (that's call-site concern), but it must allow the caller to pass an `onError` callback that runs reliably.

**Tests (REQUIRED):**

Create or extend `src/lib/optimistic.test.ts` (or whatever the project's test convention is). The audit's T-7 explicitly flags that `optimistic.ts` has no unit tests despite being central infrastructure. This commit fixes that for the new helpers at minimum.

Required test cases:

For `makeOptimisticBulkDelete`:
1. **Happy path:** given a cache containing items `[A, B, C, D]` and a delete of `[B, D]`, the cache after `apply` contains `[A, C]`.
2. **Empty id set:** delete of `[]` is a no-op (cache unchanged).
3. **Rollback on error:** after `apply` then `rollback`, the cache equals the pre-`apply` snapshot.
4. **Partial match:** delete of `[B, X]` where `X` is not in cache removes `B` and ignores `X` (no throw).

For `makeOptimisticBulkMove`:
1. **Happy path:** given items `[{id: A, cat: 1}, {id: B, cat: 1}]` and a move of `[A]` with `patch: {cat: 2}`, cache after apply is `[{id: A, cat: 2}, {id: B, cat: 1}]`.
2. **Rollback on error:** restores pre-apply state.
3. **Patch is applied via `applyPatch`** (i.e., the helper doesn't shallow-merge directly — it uses the caller-supplied function so caller can do the right thing for nested fields like `gear_item.category_id`).

The test environment may need a real `QueryClient` instance — match how any existing tests of `optimistic.ts` set up state. If no such tests exist, follow the pattern from any TanStack Query test in the codebase. If there are none anywhere in the project, instantiate `new QueryClient()` directly in the test file (TanStack supports this).

**Verification:**
- All new tests pass.
- All existing tests still pass.
- Typecheck passes.
- No call sites are touched in this commit. The new helpers exist but no production code uses them yet.

**Acceptance criteria:** the two helpers are exported, the test file has the seven tests above passing (4 bulkDelete + 3 bulkMove), and `git diff` for production code touches `optimistic.ts` only.

**Suggested commit:** `feat(optimistic): add makeOptimisticBulkDelete and makeOptimisticBulkMove helpers + tests (H3, B-4)`

---

## Commit 2 — Narrow `editItem` invalidation and add optimistic fan-out for `category_id` changes

**Origin:** REVIEW-performance.md H2 (High) and REVIEW-quality.md B-2 (BLOCKER). These are the same fix.

**Why:**

The two `editItem` mutations broadcast `['list-items']` invalidation across every open list cache (H2). TanStack matches every `['list-items', listId]` cache the user has visited this session and refetches all of them on every gear save. That's expensive, but more importantly it creates a correctness problem (B-2): for `category_id` changes, the embedded `gear_item.category_id` in cached `list-items` rows stays stale until the broad invalidation completes its refetch round-trips. If the user edits an item's category in the dialog and immediately reorders within the new category before the refetch lands, `groupListItemsByCategory` reads the stale category, `arrayMove` reorders the wrong category's slots, and `assignSortOrderSlots` writes corrupted sort_order to the server. Optimistic UI then hides the corruption from the user until refresh.

Both problems collapse into one fix: enumerate the affected list-items caches once, **and** write the patch optimistically into each. This narrows invalidation (H2) and eliminates the staleness window (B-2) in the same pass.

**Files:** 
- `src/gear/GearLibraryPage.tsx` around lines 218–232
- `src/lists/ListDetailPage.tsx` around lines 301–311

**What to change:**

In both `editItem` mutation handlers, replace the broad `invalidateKeys: [['list-items']]` with a narrowed enumeration plus optimistic fan-out. The audit gives the enumeration shape:

```ts
const affectedListIds = qc.getQueryCache().findAll({ queryKey: ['list-items'] })
  .filter(q => (q.state.data as ListItemWithGear[] | undefined)?.some(i => i.gear_item_id === id))
  .map(q => q.queryKey[1] as string)
```

For each affected list id, do TWO things:

1. **Optimistic write** of the new gear_item fields into that cache (this is the B-2 fix — it must include `category_id`):

```ts
qc.setQueryData<ListItemWithGear[]>(['list-items', listId], (old) =>
  old?.map((item) =>
    item.gear_item_id === id
      ? { ...item, gear_item: { ...item.gear_item, ...patch } }
      : item
  )
)
```

2. **Targeted invalidation** of only those list-items caches (so the eventual server truth replaces the optimistic write, but doesn't refetch every list the user has ever opened).

**Important constraints:**

- The optimistic fan-out must include `category_id` in the patched embedded gear_item. The audit is explicit: a `name`-only or `weight_grams`-only fan-out doesn't fix B-2. The whole `patch` object must propagate.
- Rollback on error: if the mutation fails, the optimistic writes to the affected list-items caches must roll back, just as the existing `['gear-items']` write rolls back. The cleanest way is to snapshot each affected cache before writing and restore in `onError`. Mirror the snapshot/restore pattern used by the existing `makeOptimisticUpdate` helper.
- Do NOT change the existing optimistic write to `['gear-items']`. That cache is the source of truth for the gear library page and its current behavior is correct.
- Do NOT extract this into a helper in this commit. Inline the fan-out logic at both call sites. (Extracting into a `makeOptimisticEditItemWithListFanout` helper is a future cleanup; this commit's job is to fix correctness with the minimum diff.)
- Both call sites should end up with structurally identical fan-out logic. If the duplication looks bad, that's normal — the helper extraction is a future commit.

**Verification:**
- Typecheck passes.
- All existing tests still pass.
- **Manual smoke test (REQUIRED before considering this commit done):**
  1. Open a list with at least 5 items across 2+ categories.
  2. Edit an item's category from Cat A to Cat B via the dialog.
  3. Immediately (before the network round-trip would plausibly land) drag-reorder within Cat B.
  4. Hard refresh.
  5. Confirm the item is in Cat B and the sort order within Cat B reflects the drag.
  6. Repeat the same flow from the gear library page (since both call sites changed).

**Acceptance criteria:** both `editItem` mutations enumerate affected list caches, write optimistically (including `category_id`), and invalidate only those specific caches. The manual smoke confirms no reorder corruption.

**Suggested commit:** `fix(editItem): narrow invalidation and fan out category_id optimistically (H2, B-2)`

---

## Commit 3 — Wire `bulkDelete` and `bulkMove` through optimistic helpers with onError toasts

**Origin:** REVIEW-performance.md H3 (High), REVIEW-quality.md B-4 (BLOCKER). Plus the B-2-at-scale carry-over for `bulkMove`'s `category_id` fan-out.

**Why:**

Today's bulk operations on `/gear` wait silently for the round-trip, then everything blinks at once. If the server rejects, `onSuccess` doesn't fire, `exitSelectMode` doesn't run, no toast surfaces — the user is left in select mode with stale UI and no error state. Every other CRUD on the page is optimistic. With Commit 1's helpers in place, these two mutations can match.

`bulkMove` additionally has the B-2 problem at scale: it changes `category_id` for many gear items but only coarsely invalidates caches.

**File:** `src/gear/GearLibraryPage.tsx` around lines 246–255 (`bulkDelete` and `bulkMoveToCategoryGearItems` mutation hooks).

**What to change:**

For **`bulkDelete`:**

- Switch the mutation from plain `onSuccess` invalidation to use `makeOptimisticBulkDelete` (from Commit 1) against `['gear-items']`.
- Side-cache invalidation: still invalidate any `['list-items']` caches that contained any of the deleted gear ids — this is the same enumeration pattern as Commit 2, applied across the full id-set being deleted.
- `onError`: surface a toast (e.g., "Failed to delete N items. Please try again."), AND ensure `exitSelectMode` is NOT called on error so the user can retry without re-selecting. (Today's bug per B-4 is the inverse — `exitSelectMode` happens in `onSuccess` only, so errors leave the user stuck. Now: `exitSelectMode` runs only on success path, but the user gets a clear toast on error and stays in select mode with their selection intact.)
- `onSuccess`: existing behavior preserved — `exitSelectMode` still fires.

For **`bulkMove`:**

- Switch to use `makeOptimisticBulkMove` against `['gear-items']`. The `applyPatch` function should set `category_id` on each matching item.
- **Fan-out for `list-items` caches:** for every affected list-items cache (any cache containing any of the moved gear ids), optimistically rewrite the embedded `gear_item.category_id` for those items. Same shape as Commit 2's fan-out, just applied across a set of gear ids rather than one. **This is required.** Without it, B-2 reproduces at scale on every bulk move.
- `onError`: same pattern as `bulkDelete` — toast, do not exit select mode.
- `onSuccess`: existing behavior preserved.

**Important constraints:**

- The toast surface should match whatever toast utility the rest of the app uses (the audit doesn't name one — the agent should grep for the existing toast pattern, e.g., a `useToast` hook or an imported toast function from a UI library).
- The `onError` rollback for `['gear-items']` is handled by `makeOptimisticBulkDelete` / `makeOptimisticBulkMove` itself (Commit 1 made these helpers do snapshot/restore). The list-items cache fan-out for `bulkMove` needs its own snapshot/restore in `onError`, same pattern as Commit 2.
- Do NOT add `onError` toasts to the `editItem` mutations in this commit (that's a separate, smaller follow-up — keep this commit's diff focused on the bulk path).
- Do NOT touch single-item `removeItem` or `editItem` — those are already optimistic and correct as of Phase 1.

**Verification:**
- Typecheck passes.
- All existing tests still pass.
- **Manual smoke tests (REQUIRED):**
  1. **Bulk delete happy path:** select 3+ gear items, click Delete (N), confirm — items disappear instantly, toast/feedback as expected, select mode exits.
  2. **Bulk delete error path:** simulate a failure (temporarily break the mutation, e.g., add a `throw` in `bulkDeleteGearItems` and revert after testing) — confirm an error toast surfaces and the user stays in select mode with selection intact. Revert the throw.
  3. **Bulk move happy path:** select 3+ gear items in Cat A, bulk move to Cat B, confirm they appear in Cat B instantly across both the gear page AND any open list pages that reference those items.
  4. **Bulk move + reorder race (the B-2-at-scale check):** in a list view, bulk move several items into Cat B from the gear page, switch to the list page, immediately drag-reorder within Cat B. Hard refresh. Sort order in Cat B should reflect the drag.

**Acceptance criteria:** both bulk mutations use the new helpers, both have `onError` toasts that preserve selection state, `bulkMove` fans out `category_id` to affected list-items caches, all four manual smoke paths pass.

**Suggested commit:** `fix(bulk): optimistic bulkDelete/bulkMove with onError toasts and category fan-out (H3, B-4)`

---

## Out of scope for Phase 2

These items appear in the audits or were discussed but are explicitly NOT part of this phase:

- **Database indexes (H1, M1)** — Phase 4.
- **Bundle splitting (H4, H5, H6, L7)** — Phase 3.
- **Render perf cluster (M6, M7, M8, M11, M12, L1, L2, L9)** — Phase 5.
- **Helper extraction for `editItem` fan-out** — intentional duplication in Commit 2 to keep the diff minimal. Future commit can extract `makeOptimisticEditItemWithListFanout` once the shape proves stable.
- **`onError` toasts on `editItem`** — same shape as bulk but separate commit, can be a small follow-up.
- **W-1 (`useAnchoredMenu` extraction)** and other refactors — Phase 6.
- **Test gaps T-2 through T-9** — Phase 7. (T-7 partially addressed by Commit 1's tests, intentionally.)
- **F2, F4, F5, F7** — separate small security follow-ups.
- **The two single-RTT-collapse RPCs (M2, M3)** — bigger lift, deferred until felt latency justifies it.

If something looks like it requires expanding scope mid-commit, **stop and surface it** in the `REVIEW-FIX.md` summary as a "blocker" rather than expanding scope. Phase 2 is already a meaningfully larger piece of work than Phase 1; further scope creep should be a deliberate decision, not a drift.

---

## Final summary

After all three commits land, append to `REVIEW-FIX.md` with this structure:

```markdown
## Phase 2 — broad-invalidation cluster (DATE)

### Shipped
- Commit 1 (H3, B-4 infra): commit <hash> — makeOptimisticBulkDelete + makeOptimisticBulkMove helpers + tests.
- Commit 2 (H2, B-2): commit <hash> — editItem narrowed invalidation + category_id fan-out.
- Commit 3 (H3, B-4, B-2-at-scale): commit <hash> — bulkDelete/bulkMove via new helpers with onError toasts.

### Verification results
- typecheck: pass
- existing tests: pass
- new optimistic helper tests: 8/8 pass
- manual smoke: editItem race (cleared), bulkDelete error path (toast + selection preserved), bulkMove + reorder race (no corruption)

### Blockers / surprises
- (none, or list anything that surfaced)

### Next phase
Phase 3: bundle splitting (H4 react-markdown lazy, H5 vaul lazy, H6 fflate dynamic, L7 route code-split). Independent fixes, easy to verify with build size before/after.
```

That's the deliverable. Three atomic commits, two new exported helpers + 7 unit tests (4 bulkDelete + 3 bulkMove), four mutation hooks rewired, and the only "real" reorder corruption race in the app closed.
