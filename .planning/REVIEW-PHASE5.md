# grampacker — Phase 5 fixes (2026-05-05)

**Source:** synthesized from `REVIEW-performance.md` (M6, L1, L2; L9 dropped — audit premise stale per Codex finding 4) plus the Codex follow-up on Phase 4 (list-page CategoryGroup not memoized; `groupListItemsByCategory` produces fresh group/item arrays on every list-items mutation; `onAddItem` inline closures defeat memo).
**Scope:** lower-leverage perf cleanups + close the pack-mode render-scope gap that Phase 4 reduced but did not actually close. Five atomic commits (slot 5 is documentation-only, recording the dropped L9).
**Why this is one phase:** the list-page `CategoryGroup` memo (Codex follow-up) is structurally pointless without a stability layer on `groupListItemsByCategory`, because the memo's shallow compare would see fresh `items` array references on every list-items mutation and bail out. M6 (single-pass bucket) is the natural place to add that stability layer — same file, same function. L1 / L2 / L9 are independent, low-risk, bundle-flat cleanups that ride along.

> **Note on file paths:** all paths are repo-relative.
> **Phase 4 baseline:** main bundle = **186.51 KB gzip**.
> **Bundle expectation for Phase 5:** essentially flat. None of these commits move code between bundles. Win is render-time, not bundle-time.

---

## How to execute this file

Five active commits + one no-op slot, **strict ordering for the first two** — Commit 1 (M6 + stability layer in `groupListItemsByCategory`) MUST land before Commit 2 (`React.memo(CategoryGroup)` + onAddItem stabilization); without the stability layer the memo barrier is defeated by fresh `items` references and produces no measurable scoping. Commits 3 and 4 are independent and can land in any order. Commit 5 is dropped (audit-stale entry, recorded only in the docs summary). Commit 6 is the doc summary.

For each commit:
1. Make the change exactly as specified.
2. Run `npm run build` (typecheck + Vite). Bundle gzip should stay within ±0.2 KB of the prior commit.
3. Run `npm run lint` — must be clean (React 19 ref / state-in-effect rules are strict).
4. Run `npm test --run` — 23/23 must stay green.
5. Commit with the suggested message.

After Commit 2: capture a React DevTools profiler trace of pack-mode rapid toggle (~10 ticks) and record observed render scope in the commit message. **This is the verification step Phase 4 skipped.** If the profile shows full-list re-render on each tick, the memo barrier is still defeated — STOP and surface as a blocker rather than continuing to Commits 3-6.

---

## Commit 1 — M6: single-pass bucket map + per-group structural stability

**Origin:** REVIEW-performance.md M6 (Medium) plus Codex Phase 4 follow-up (group/item references churn on every list-items mutation).

**Why:**

`src/lib/grouping.ts:14` (`groupListItemsByCategory`) currently does **N filter passes** over the items array — one per category — to bucket items by category_id. At ~10 categories × ~50 items, that's ~500 comparisons per call. Worse, the function returns fresh group objects and fresh per-group `items: T[]` arrays on every call. When `listItems` changes (e.g. a pack-mode `is_packed` toggle), the upstream `useMemo([listItems, categories])` at `ListDetailPage.tsx:500` reruns the function, every group gets a fresh items array reference, and downstream consumers see prop churn for every category — not just the one whose item toggled.

The fix has two parts:

1. **Single-pass bucket** (M6 proper): walk `items` once, push into a `Map<string|null, ListItemWithGear[]>` keyed by category_id, then assemble groups in `Category.sort_order` order. O(N + C) instead of O(N × C).
2. **Per-group structural stability** (Codex follow-up): given a prior result, reuse the prior group object AND prior `items` array reference for any category whose item set is structurally identical (same item ids in same order with the same render-affecting field values). Pack-mode `is_packed` toggles produce a single category with a fresh items array; all other categories keep their prior references and downstream `React.memo` (Commit 2) skips them.

The function signature changes from pure `(items, categories) => groups` to `(items, categories, prior?) => groups`. Callers wrap with a thin React hook that holds the prior in a ref-equivalent.

**Files:**
- Modify: `src/lib/grouping.ts` (rewrite `groupListItemsByCategory`)
- Create: `src/lib/use-grouped-list-items.ts` (thin hook holding prior result)
- Modify: `src/lists/ListDetailPage.tsx` (swap `useMemo(() => groupListItemsByCategory(...))` for the new hook)
- Update: `src/lib/grouping.test.ts` if it exists (verify) and add cases covering structural-stability behavior

**What to do:**

### Step 1 — Rewrite `groupListItemsByCategory` as single-pass bucket with optional stability merge

```ts
// src/lib/grouping.ts

// What "structurally identical" means for stability: same length AND for
// each index i, items[i] is referentially identical OR has identical render-
// affecting field values. Render-affecting fields for ListItemWithGear are
// the per-list trip fields (sort_order, quantity, is_packed, is_worn,
// is_consumable) plus the embedded gear_item's id + weight_grams + name +
// description. Description must be in the comparator because desktop
// ItemRow renders and edits it (see src/lists/ItemRow.tsx around line 239)
// — excluding it would let memo skip the re-render after a description
// edit and leave stale text on screen. Timestamps and other non-rendered
// gear_item fields stay out.
function listItemsArrayEqual(a: ListItemWithGear[], b: ListItemWithGear[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x === y) continue
    if (x.id !== y.id) return false
    if (x.sort_order !== y.sort_order) return false
    if (x.quantity !== y.quantity) return false
    if (x.is_packed !== y.is_packed) return false
    if (x.is_worn !== y.is_worn) return false
    if (x.is_consumable !== y.is_consumable) return false
    if (x.gear_item.id !== y.gear_item.id) return false
    if (x.gear_item.weight_grams !== y.gear_item.weight_grams) return false
    if (x.gear_item.name !== y.gear_item.name) return false
    if (x.gear_item.description !== y.gear_item.description) return false
  }
  return true
}

export function groupListItemsByCategory(
  items: ListItemWithGear[],
  categories: Category[],
  prior?: CategoryGroup<ListItemWithGear>[],
): CategoryGroup<ListItemWithGear>[] {
  // Single-pass bucket — O(N + C) instead of O(N × C).
  const buckets = new Map<string | null, ListItemWithGear[]>()
  const catMap = new Map(categories.map((c) => [c.id, c]))
  for (const item of items) {
    const key = item.gear_item.category_id !== null && catMap.has(item.gear_item.category_id)
      ? item.gear_item.category_id
      : null
    let arr = buckets.get(key)
    if (!arr) {
      arr = []
      buckets.set(key, arr)
    }
    arr.push(item)
  }

  // Build prior-group lookup for structural-stability merge.
  const priorByKey = new Map<string | null, CategoryGroup<ListItemWithGear>>()
  if (prior) {
    for (const g of prior) {
      priorByKey.set(g.category?.id ?? null, g)
    }
  }

  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
  const result: CategoryGroup<ListItemWithGear>[] = []
  for (const cat of sortedCats) {
    const items = buckets.get(cat.id)
    if (!items || items.length === 0) continue
    const priorGroup = priorByKey.get(cat.id)
    if (priorGroup && priorGroup.category === cat && listItemsArrayEqual(priorGroup.items, items)) {
      result.push(priorGroup) // reuse prior group reference AND its items array
    } else {
      result.push({ category: cat, items })
    }
  }

  const uncategorized = buckets.get(null)
  if (uncategorized && uncategorized.length > 0) {
    const priorGroup = priorByKey.get(null)
    if (priorGroup && priorGroup.category === null && listItemsArrayEqual(priorGroup.items, uncategorized)) {
      result.push(priorGroup)
    } else {
      result.push({ category: null, items: uncategorized })
    }
  }

  // Top-level stability: if every group in `result` is the SAME reference as
  // its counterpart in `prior` AND the lengths match (same categories present
  // in same order), return the prior top-level array reference. Without this,
  // every call mints a fresh `result` array even when no group changed —
  // which defeats `=== `-level identity checks at the consumer (e.g. the
  // useGroupedListItems hook below uses top-level identity to decide whether
  // to call setState, so we MUST return the same top-level reference when
  // nothing changed or the hook will infinite-loop).
  if (prior && prior.length === result.length) {
    let allSame = true
    for (let i = 0; i < result.length; i++) {
      if (result[i] !== prior[i]) {
        allSame = false
        break
      }
    }
    if (allSame) return prior
  }

  return result
}
```

**Why this shape and not e.g. memoize-by-content-hash:** the per-call merge is O(N) in the changed-categories case, O(N) in the unchanged case (still a length + per-field walk), and never materializes a hash string. It also reuses array references AND object references, so `===` comparisons up the tree (in `React.memo` shallow compare) are short-circuited cheaply.

### Step 2 — Hook to hold the prior result

```ts
// src/lib/use-grouped-list-items.ts

import { useState } from 'react'
import { groupListItemsByCategory, type CategoryGroup } from './grouping'
import type { Category, ListItemWithGear } from './types'

// Keeps the prior group result so groupListItemsByCategory can reuse
// per-group references when contents are structurally identical, and
// returns the SAME top-level array when no groups changed.
//
// Why this shape (not useRef + render-time write): the React 19
// react-hooks/refs rule rejects synchronous ref writes during render
// (Phase 4 follow-up fixed exactly this in ListDetailPage). Calling
// setState during render IS explicitly allowed by React for the
// "store information from previous renders" pattern, but only when
// guarded against infinite loops. The guard here is the top-level
// identity check inside groupListItemsByCategory: when nothing
// changed, it returns `prior` itself, so `next === cached` and we
// skip the setState call. Without the top-level identity check
// (Step 1 above), this hook WOULD infinite-loop because every call
// would return a fresh top-level array even when groups were reused.
//
// React docs reference: https://react.dev/reference/react/useState#storing-information-from-previous-renders
export function useGroupedListItems(
  items: ListItemWithGear[],
  categories: Category[],
): CategoryGroup<ListItemWithGear>[] {
  const [cached, setCached] = useState<CategoryGroup<ListItemWithGear>[]>(() =>
    groupListItemsByCategory(items, categories),
  )
  const next = groupListItemsByCategory(items, categories, cached)
  if (next !== cached) {
    setCached(next)
  }
  return next
}
```

The contract between `groupListItemsByCategory` and `useGroupedListItems` is:
- The function must return the SAME `prior` reference (not a structurally-equal copy) when no group changed. The hook's loop guard depends on `===` identity, not deep equality.
- The function may return a fresh top-level array containing some prior group references (partial reuse) — that's fine; React.memo on individual CategoryGroup will still skip the unchanged ones.

**Verify with a unit test (added in Step 4 below) that calling `groupListItemsByCategory(sameItems, sameCategories, priorResult)` returns `priorResult` itself, not a structurally-equal copy.** This is the load-bearing invariant for the hook.

### Step 3 — Swap call site at `ListDetailPage.tsx:500`

```diff
-  const grouped = useMemo(
-    () => groupListItemsByCategory(listItems, categories),
-    [listItems, categories],
-  )
+  const grouped = useGroupedListItems(listItems, categories)
```

Add the import:

```diff
+import { useGroupedListItems } from '../lib/use-grouped-list-items'
```

`displayedGrouped` and `wornItems` (which derive from `grouped`) keep their existing `useMemo` shape — when `grouped` is reference-stable, those memos pass through.

### Step 4 — Tests

Check whether `src/lib/grouping.test.ts` exists. If it does, add cases below. If it doesn't, create the file with these cases. Tests are pure (no DOM); fixture data only.

REQUIRED cases:
- **Top-level identity invariant:** `groupListItemsByCategory(items, categories, prior)` returns `prior` itself (assert with `expect(result).toBe(prior)`) when items and categories are unchanged from the prior call. **Load-bearing for the hook's loop guard.**
- **Same `listItems` reference, no prior:** returns a fresh result (sanity).
- **Pack-mode toggle on one category's item:** only that category's `items` reference changes; other categories' `items` arrays AND group objects keep `===` to prior. Top-level result is a fresh array (some groups changed).
- **Gear-item rename:** that category's items array reference changes (since `gear_item.name` is in the comparator); other categories' references stable.
- **Gear-item description edit:** that category's items array reference changes (since `gear_item.description` is in the comparator); other categories stable. **Regression case for the Codex finding 1.**
- **Empty categories filtered out:** existing behavior preserved by the bucket implementation.
- **Uncategorized items:** still routed to the trailing `category: null` group when present.

Existing cases (if any) must continue to pass — single-pass bucket is observably equivalent to N filter passes for the visible output.

**Verification:**
- `npm run build` — pass; bundle within ±0.2 KB of 186.51.
- `npm run lint` — pass.
- `npm test --run` — 23/23 still pass plus any new grouping cases.
- No manual smoke required for this commit alone (Commit 2 is where the user-visible perf change lands; this commit is the prerequisite stability layer).

**Acceptance criteria:** single-pass bucket implementation, structural-stability merge in place, hook in `src/lib/`, ListDetailPage call site swapped, build + lint + tests pass.

**Suggested commit:** `perf(grouping): single-pass bucket + per-group structural stability (M6)`

---

## Commit 2 — `React.memo(CategoryGroup)` for the list-page CategoryGroup

**Origin:** Codex Phase 4 follow-up — `src/lists/CategoryGroup.tsx` is not memoized; relied on Commit 1's stability layer.

**Why:**

With Commit 1's stability layer, every group whose items did not change passes the same `items` array reference into `<CategoryGroup>`. The other props in the spread (`sharedGroupProps`, `weightUnit`, `isBelowLg`, `categoryId`, `name`, `reorderPending`, `showUnpackedOnly`) are already stable from prior phases. Wrapping `CategoryGroup` in `React.memo` lets shallow-prop compare skip the unchanged categories outright.

Without Commit 1, this commit is structurally pointless: shallow compare would see fresh `items` array references and bail.

**File:** `src/lists/CategoryGroup.tsx`

**What to do:**

### Step 1 — Wrap with `memo`

The component is currently `export default function CategoryGroup(...)`. Refactor to:

```tsx
import { memo, useState } from 'react'
// ...other imports...

function CategoryGroup({
  // ...existing props destructure
}: GroupProps) {
  // ...existing body unchanged
}

export default memo(CategoryGroup)
```

Default `memo` shallow comparison is correct here. **Do NOT** pass a custom `arePropsEqual` — the props are designed to be stable, and a custom comparator hides regressions when new props are added.

### Step 2 — Audit prop reference stability at the call sites

`CategoryGroup` is consumed at two call sites:
- `src/lists/ListDetailPage.tsx` (authed list view; lines ~770 and ~782 — keyed and uncategorized)
- `src/lists/SharePage.tsx` (public share view — read-only, no spread of mutation handlers)

Verify all CategoryGroup props at both sites are reference-stable across renders that should NOT cause re-render:

| Prop | Source at call site | Stable? | Notes |
|---|---|---|---|
| `name` | `group.category?.name ?? 'Uncategorized'` | per-render fresh string but same value | Object.is on strings is structural — stable |
| `items` | `group.items` from `grouped` | **stable after Commit 1** | The whole point of Commit 1 |
| `weightUnit` | `weightUnit` from `useWeightUnit()` | stable | hook returns stable value |
| `isBelowLg` | from `useIsBelowLg()` at page level | stable | already prop-drilled in Phase 4 |
| `categoryId` | `group.category?.id ?? null` | stable | string or null |
| `packMode` | `mode === 'pack'` | stable boolean | |
| `sortable` | static `true` / unset | stable | |
| `reorderPending` | `reorderItemsMut.isPending` | per-render | TanStack `isPending` is reference-stable per state |
| `showUnpackedOnly` | `showUnpackedOnly` state | stable | |
| `...sharedGroupProps` | memoized in Phase 4 | stable | |
| **`onAddItem`** | **inline `(data) => addNewItemMut.mutate({ categoryId: ..., data })` at lines ~776 and ~789** | **NOT stable — fresh closure every render** | **MUST FIX before this commit** (Codex finding 3) |

**Required fix for `onAddItem`** — the per-call-site categoryId currying is the reason these are inline. Two options, prefer Option A:

**Option A (preferred):** change the handler to receive `categoryId` from the child instead of currying it from the parent. Each `CategoryGroup` already passes its own `categoryId` to its internal `AddItemRow`; widen `onAddItem`'s signature to `(categoryId: string | null, data: AddItemData) => void` so the parent supplies a single stable callback. Wire-up:

```tsx
// In ListDetailPage.tsx, at the page level (alongside onLibraryAdd / onLibraryRemove):
const onAddItem = useCallback(
  (categoryId: string | null, data: AddItemData) => {
    addNewItemMut.mutate({ categoryId, data })
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- addNewItemMut is a TanStack mutation result; .mutate is stable, the wrapper is not
  [],
)

// At both call sites:
<CategoryGroup
  // ...other props
  onAddItem={onAddItem}
/>
```

Then update `CategoryGroup`'s `onAddItem` prop type and the call inside the component body so the categoryId flows in from the component's existing `categoryId` prop:

```tsx
// In src/lists/CategoryGroup.tsx:
type GroupProps = {
  // ...existing props
  onAddItem?: (categoryId: string | null, data: AddItemData) => void
}

// Inside the body, wherever `onAddItem(data)` was called, becomes:
onAddItem?.(categoryId ?? null, data)
```

**Option B (fallback if Option A turns out to require widening more than expected):** keep the current API but `useMemo` the two curried callbacks at the page level keyed on category id. Less clean (creates a sparse cache or two separate `useCallback`s) but doesn't widen the signature. Use this only if Option A reveals downstream ripple in `AddItemRow` or share-view's signature.

**Pack mode:** `onAddItem` is irrelevant in pack mode (the "+ Add new item" footer doesn't render — see CategoryGroup body, the affordance is gated on `!packMode`). Either pass `undefined` for `onAddItem` when `packMode` is true (one less prop to compare), or keep passing it and rely on the gate inside CategoryGroup. Prefer the explicit `undefined` so memo's shallow compare can short-circuit faster on pack-mode renders.

If any other prop is freshly minted (inline arrow, fresh object literal, etc.), stabilize it before declaring this commit done. Specifically watch for:
- `key` is NOT a prop (React internal); ignore.
- Anything spread from a prop bag that wasn't previously memoized.

### Step 3 — Profiler verification (REQUIRED before commit)

This is the verification step Phase 4 skipped.

1. `npm run dev`.
2. Open Chrome DevTools → React DevTools → Profiler.
3. Navigate to a list with at least 3 categories of 3+ items each. (`/lists/<id>` of any seeded list, or create one.)
4. Click "Record". Toggle pack-mode checkboxes on items in ONE category, ~5 toggles. Stop recording.
5. Inspect the flame graph for each commit:
   - **Pass:** only the affected `CategoryGroup` and its child `ItemRow` re-render. Other CategoryGroups appear gray (skipped).
   - **Fail:** every CategoryGroup re-renders on each tick. → Commit 1's stability layer didn't fire as designed; stop and debug before committing.
6. Capture: number of components rendered per commit (visible in the profiler), and paste it into the commit message body. Format: "Per-toggle render scope: 1 CategoryGroup + 1 ItemRow (was: N CategoryGroups + N×M ItemRows)."

If profiler is unavailable (e.g. headless verification), skip the dev-server step but note in the commit message that profiler verification is **pending user-side measurement** and link the surrounding spec section so the user can run it.

**Verification:**
- `npm run build` — pass.
- `npm run lint` — pass.
- `npm test --run` — 23/23 pass.
- Profiler trace per Step 3.

**Acceptance criteria:** `CategoryGroup` exported as `memo(CategoryGroup)`, profiler trace recorded in commit message OR explicitly noted as pending, no other behavior changes.

**Suggested commit:** `perf(render): React.memo(CategoryGroup) for list-page render scoping`

---

## Commit 3 — L1: WeightTable result memoization

**Origin:** REVIEW-performance.md L1 (Low).

**Why:**

`src/lists/WeightTable.tsx` recomputes its breakdown rows from scratch on every render. The page above it re-renders frequently (Phase 4 reduced this churn but did not eliminate it for the right column). The pure helper `computeWeightBreakdown()` already exists (extracted in Phase 1 for testability), so wrapping it in `useMemo` is a one-line change.

**File:** `src/lists/WeightTable.tsx`

**What to do:**

The actual signature is `computeWeightBreakdown(items, categories)` (verified at `src/lists/WeightTable.tsx:27` — `weightUnit` is NOT a parameter; the breakdown returns gram totals and the formatting happens in the JSX layer). Wrap in `useMemo`:

```tsx
const breakdown = useMemo(
  () => computeWeightBreakdown(items, categories),
  [items, categories],
)
```

**KNOWN RISK:** `items` reference still churns on every list mutation (this is the same problem Commit 1 fixes for grouping, but WeightTable receives `items` directly from the page, not via `grouped`). Even with the memo, recomputation happens whenever `items` changes — which is most renders. The memo's value is in *guarding against parent re-renders that don't change `items`* (e.g. notes editor keystroke, dialog open/close), not pack-mode toggles.

Decision: still worth doing. The cost of `useMemo` is one shallow compare per render — net positive even if it only saves work on a fraction of renders.

**Verification:**
- `npm run build` — pass.
- `npm run lint` — pass.
- `npm test --run` — WeightTable tests still pass (3/3).

**Acceptance criteria:** `useMemo` wrapping `computeWeightBreakdown`, no other changes.

**Suggested commit:** `perf(render): memoize WeightTable breakdown (L1)`

---

## Commit 4 — L2: SharePage `categoryIds` memoization

**Origin:** REVIEW-performance.md L2 (Low).

**Why:**

`src/lists/SharePage.tsx:31-33` derives `categoryIds` from `items` using a `Set` + spread on every render:

```tsx
const categoryIds = [...new Set(
  items.map((i) => i.gear_item.category_id).filter((c): c is string => c !== null),
)]
```

This is then used as a TanStack Query key segment (`['shared-list-categories', list?.id, categoryIds.join(',')]`) — fresh array every render means the key string is recomputed but the cached query is fine because the joined string is content-derived. Still, computing it inside render is wasted work.

**File:** `src/lists/SharePage.tsx`

**What to do:**

Wrap the derivation in `useMemo`:

```tsx
const categoryIds = useMemo(
  () => [...new Set(
    items.map((i) => i.gear_item.category_id).filter((c): c is string => c !== null),
  )],
  [items],
)
```

Remove `useState`-style spread if any; verify the existing import line includes `useMemo` (it likely doesn't — add it).

**Verification:**
- `npm run build` — pass.
- `npm run lint` — pass.
- `npm test --run` — pass.
- Manual smoke (REQUIRED — share-view is the lowest-coverage path): open `/r/<slug>` for a shared list, confirm categories render the same as before.

**Acceptance criteria:** `categoryIds` wrapped in `useMemo`, share-view manual smoke clean.

**Suggested commit:** `perf(render): memoize SharePage categoryIds (L2)`

---

## Commit 5 — L9: DROPPED (audit premise was stale)

**Origin:** REVIEW-performance.md L9 (Low) — but the audit's claim is incorrect.

**Why dropped:**

The audit said `formatItemWeight` constructs `Intl.NumberFormat` on every call. The current implementation at `src/lib/weight.ts:17` does NOT use `Intl.NumberFormat` — it uses plain string interpolation (grams) and `toFixed(1)` (ounces):

```ts
export function formatItemWeight(grams: number, unit: WeightUnit): string {
  if (unit === 'g') return `${grams} g`
  return `${gramsToOz(grams).toFixed(1)} oz`
}
```

There is no formatter to hoist. Introducing `Intl.NumberFormat` here would be a behavior change, not a perf fix:
- Grams currently render as `1250 g`; `Intl.NumberFormat('en-US')` would render `1,250 g` (thousands separator added).
- Ounces currently render with one decimal (`toFixed(1)` → `1.5 oz`); a default `Intl.NumberFormat` configuration changes the precision and rounding mode.

Either of those is a UX-visible change that warrants its own design decision (locale-aware grouping, decimal precision policy), not a perf commit. Dropping L9 from Phase 5.

**If thousands-separator grouping IS desired**, propose it as a separate, user-visible commit in a future phase with explicit screenshots of before/after — not as a perf fix. The audit ledger entry should be marked "audit stale; no action".

**No file changes for this commit.** Commit 5 is REPLACED by the docs entry below; renumbering subsequent commits would be churn — keep the same slot but record it as a no-op with the rationale above so the audit trail stays clean.

**Suggested commit:** none. This slot is documentation-only (handled in Commit 6's REVIEW-FIX.md entry — record L9 as "audit stale, dropped").

---

## Commit 6 — Append Phase 5 summary to REVIEW-FIX.md

**File:** `.planning/REVIEW-FIX.md`

Append below the existing Phase 4 section (including the follow-up). Structure:

```markdown
## Phase 5 — render-scope cleanup + low-leverage perf (2026-05-05)

### Shipped
- Commit 1 (M6 + Codex follow-up) — `<hash>` — `groupListItemsByCategory` rewritten as single-pass bucket map (O(N+C) instead of O(N×C)) with structural per-group stability merge AND top-level identity invariant (returns `prior` itself when no group changed). `src/lib/use-grouped-list-items.ts` calls setState during render under the loop guard provided by the top-level identity invariant.
- Commit 2 (CategoryGroup memo + onAddItem stabilization) — `<hash>` — `src/lists/CategoryGroup.tsx` exported via `React.memo`; `onAddItem` API widened from `(data) => void` to `(categoryId, data) => void` so the parent can pass a stable `useCallback`'d handler instead of two fresh per-call-site arrows. Profiler trace on pack-mode rapid toggle: <observed scope or "pending user-side measurement">.
- Commit 3 (L1) — `<hash>` — `WeightTable` breakdown wrapped in `useMemo`.
- Commit 4 (L2) — `<hash>` — `SharePage.categoryIds` wrapped in `useMemo`.
- Commit 5 (L9) — DROPPED. Audit claim was stale: `formatItemWeight` does not use `Intl.NumberFormat` (uses `toFixed(1)` and string interpolation). Hoisting a formatter would change displayed grams (`1250 g` → `1,250 g`) and ounce precision — a UX-visible decision, not a perf fix. Filed as audit-stale in this ledger.

### Verification results
- `npm run build`: pass after each commit; gzip stayed within ±0.2 KB of 186.51.
- `npm run lint`: pass.
- `npm test --run`: 23/23 pass plus any new grouping cases.
- Manual smoke (share-view L2): pending user verification.
- Profiler verification (Commit 2): <recorded numbers or "pending">.

### Blockers / surprises
- (fill in or "none")

### Next phase
Phase 6 candidates: W-1 (`useAnchoredMenu` refactor), W-7 (rename inner `CategoryGroup` to break shadow), DB indexes (H1, M1) — backend perf, requires migration. Or Phase 7: test-coverage cluster T-2…T-9, blocked on adding jsdom + @testing-library.
```

**Suggested commit:** `docs(review-fix): append Phase 5 summary`

---

## Out of scope for Phase 5

Explicitly NOT in this phase:

- **W-1 (`useAnchoredMenu` refactor)** — quality refactor, not perf. Phase 6.
- **W-7 (rename inner `CategoryGroup`)** — quality refactor. Phase 6.
- **DB indexes (H1, M1)** — backend perf, requires migration. Separate phase.
- **All test gaps T-2 through T-9** — Phase 7 territory.
- **`groupGearItemsByCategory`** (the gear-library sibling helper) — does NOT have the same churn problem because `gearItems` doesn't change on pack-mode toggles. Defer; revisit if it ever surfaces in profiling.

If something looks like it requires expanding scope mid-commit, **stop and surface it** as a blocker.
