# Phase 2 — broad-invalidation cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five-finding broad-invalidation cluster (H2, H3, B-2, B-4, plus B-2-at-scale on bulkMove) by adding two optimistic-bulk helpers, narrowing `editItem` invalidation with optimistic fan-out for `category_id`, and rewiring bulk gear operations through the helpers with `onError` toasts.

**Architecture:** Three atomic commits. Commit 1 adds infrastructure (`makeOptimisticBulkDelete`, `makeOptimisticBulkMove`) with unit tests in isolation — no call sites change. Commit 2 fixes correctness (`editItem` category-change race) by enumerating affected list-items caches and writing the patch optimistically into each. Commit 3 wires `bulkDelete` / `bulkMove` through the new helpers with `onError` toasts and `category_id` fan-out for `bulkMove`. Commits 2 and 3 are independent of each other but both depend on Commit 1.

**Tech Stack:** TanStack Query, TypeScript, Vitest, existing `showToast` utility from `src/lib/toast.ts`.

---

## File Structure

**Modified files (Commit 1):**
- `src/lib/queries/optimistic.ts` — add `makeOptimisticBulkDelete<TItem>` and `makeOptimisticBulkMove<TItem, TPatch>` exports

**New files (Commit 1):**
- `src/lib/queries/optimistic.test.ts` — 7 unit tests against a real `QueryClient`

**Modified files (Commit 2):**
- `src/gear/GearLibraryPage.tsx` — replace `editItem.invalidateKeys: [['list-items']]` with enumerate + fan-out + targeted invalidation
- `src/lists/ListDetailPage.tsx` — same shape as GearLibraryPage's editItem

**Modified files (Commit 3):**
- `src/gear/GearLibraryPage.tsx` — `bulkDelete` and `bulkMove` mutations rewired through Commit 1's helpers with `onError` toasts; `bulkMove` adds `category_id` fan-out

**Verification gate:** the locked spec asks for manual smoke on Commits 2 and 3 (drag-reorder race, bulk-delete error toast, bulk-move + reorder race, hard-refresh). Those cannot run in this session — I'll mark them as **build + tests green, manual smoke pending user verification** in REVIEW-FIX.md.

---

## Pre-flight: read existing helpers

Before Task 1, read `src/lib/queries/optimistic.ts` end-to-end. Match these existing conventions:
- `CommonOpts` shape (`qc`, `queryKey`, `invalidateKeys`, `errorToast`)
- `OptimisticContext<T>` for snapshot
- `makeRollback` and `makeSettled` shared helpers
- `cancelQueries` fired without `await` (rationale documented in the file — drop transitions need same-tick cache writes)
- Use `showToast(text, { type: 'error' })` for error surfaces (already imported)

---

## Task 1: `makeOptimisticBulkDelete` helper + tests

**Files:**
- Modify: `src/lib/queries/optimistic.ts` (append new export after `makeOptimisticDelete`)
- Create: `src/lib/queries/optimistic.test.ts`

- [ ] **Step 1.1: Write the failing tests for `makeOptimisticBulkDelete`**

Create `src/lib/queries/optimistic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { makeOptimisticBulkDelete, makeOptimisticBulkMove } from './optimistic'

type Row = { id: string; name: string; category_id: string | null }

function makeClient(initial: Row[]): { qc: QueryClient; key: readonly ['rows'] } {
  const qc = new QueryClient()
  const key = ['rows'] as const
  qc.setQueryData(key, initial)
  return { qc, key }
}

describe('makeOptimisticBulkDelete', () => {
  it('removes every matching row from the cache (happy path)', () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
      { id: 'C', name: 'c', category_id: null },
      { id: 'D', name: 'd', category_id: null },
    ])
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    helper.onMutate(['B', 'D'])
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', category_id: null },
      { id: 'C', name: 'c', category_id: null },
    ])
  })

  it('is a no-op for an empty id set', () => {
    const initial: Row[] = [{ id: 'A', name: 'a', category_id: null }]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    helper.onMutate([])
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    const ctx = helper.onMutate(['A'])
    expect(qc.getQueryData<Row[]>(key)).toEqual([{ id: 'B', name: 'b', category_id: null }])
    helper.onError(new Error('boom'), ['A'], ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('ignores ids that are not in the cache (partial match)', () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
    ])
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    helper.onMutate(['B', 'X'])
    expect(qc.getQueryData<Row[]>(key)).toEqual([{ id: 'A', name: 'a', category_id: null }])
  })
})
```

- [ ] **Step 1.2: Run the tests to confirm they fail**

Run: `npm test -- --run src/lib/queries/optimistic.test.ts`
Expected: FAIL — `makeOptimisticBulkDelete` is not exported.

- [ ] **Step 1.3: Add `makeOptimisticBulkDelete` to `src/lib/queries/optimistic.ts`**

Append immediately after `makeOptimisticDelete` (around line 227). Match the existing helper shape:

```ts
// Remove every row whose id matches `ids(input)` from the cached array.
// Mirrors makeOptimisticDelete but for a set of ids in one mutation. Used
// for multi-select bulk delete (e.g. "Delete (12)" on the gear page).
export function makeOptimisticBulkDelete<TList extends { id: string }, TInput>(opts: CommonOpts & {
  ids: (input: TInput) => string[]
}) {
  const { qc, queryKey, ids } = opts
  return {
    onMutate: (input: TInput): OptimisticContext<TList> => {
      qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const targetIds = new Set(ids(input))
      if (targetIds.size === 0) return { previous }
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr.filter((item) => !targetIds.has(item.id))
      })
      return { previous }
    },
    onError: makeRollback<TList>(opts),
    onSettled: makeSettled(opts),
  }
}
```

- [ ] **Step 1.4: Run the tests to confirm they pass**

Run: `npm test -- --run src/lib/queries/optimistic.test.ts`
Expected: 4/4 pass for `makeOptimisticBulkDelete`. Tests for `makeOptimisticBulkMove` will still fail (function not yet exported) — that's expected for Task 2.

---

## Task 2: `makeOptimisticBulkMove` helper + tests

**Files:**
- Modify: `src/lib/queries/optimistic.ts` (append after `makeOptimisticBulkDelete`)
- Modify: `src/lib/queries/optimistic.test.ts` (append a new `describe` block)

- [ ] **Step 2.1: Append failing tests for `makeOptimisticBulkMove`**

Append to `src/lib/queries/optimistic.test.ts`:

```ts
describe('makeOptimisticBulkMove', () => {
  it('applies the patch to every matching row (happy path)', () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', category_id: 'cat1' },
      { id: 'B', name: 'b', category_id: 'cat1' },
    ])
    const helper = makeOptimisticBulkMove<Row, { ids: string[]; categoryId: string | null }>({
      qc,
      queryKey: key,
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, category_id: input.categoryId }),
    })
    helper.onMutate({ ids: ['A'], categoryId: 'cat2' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', category_id: 'cat2' },
      { id: 'B', name: 'b', category_id: 'cat1' },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', category_id: 'cat1' },
      { id: 'B', name: 'b', category_id: 'cat1' },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticBulkMove<Row, { ids: string[]; categoryId: string | null }>({
      qc,
      queryKey: key,
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, category_id: input.categoryId }),
    })
    const ctx = helper.onMutate({ ids: ['A', 'B'], categoryId: 'cat2' })
    expect(qc.getQueryData<Row[]>(key)).not.toEqual(initial)
    helper.onError(new Error('boom'), { ids: ['A', 'B'], categoryId: 'cat2' }, ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('uses the caller-supplied apply function rather than shallow merge', () => {
    type NestedRow = { id: string; meta: { tag: string } }
    const qc = new QueryClient()
    const key = ['nested'] as const
    qc.setQueryData<NestedRow[]>(key, [
      { id: 'A', meta: { tag: 'old' } },
      { id: 'B', meta: { tag: 'old' } },
    ])
    const helper = makeOptimisticBulkMove<NestedRow, { ids: string[]; tag: string }>({
      qc,
      queryKey: key,
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, meta: { ...item.meta, tag: input.tag } }),
    })
    helper.onMutate({ ids: ['A'], tag: 'new' })
    expect(qc.getQueryData<NestedRow[]>(key)).toEqual([
      { id: 'A', meta: { tag: 'new' } },
      { id: 'B', meta: { tag: 'old' } },
    ])
  })
})
```

- [ ] **Step 2.2: Run tests to confirm new ones fail**

Run: `npm test -- --run src/lib/queries/optimistic.test.ts`
Expected: 3 new tests fail (`makeOptimisticBulkMove` not exported); 4 from Task 1 still pass.

- [ ] **Step 2.3: Add `makeOptimisticBulkMove` to `src/lib/queries/optimistic.ts`**

Append immediately after `makeOptimisticBulkDelete`:

```ts
// Apply a patch to every row whose id matches `ids(input)`. Used for
// multi-select bulk moves (e.g. "Move 12 items to Kitchen" on the gear
// page). Mirrors makeOptimisticBulkDelete but writes via apply() instead
// of filter — caller controls how the patch composes with each row, which
// matters for nested fields like an embedded gear_item.category_id.
export function makeOptimisticBulkMove<TList extends { id: string }, TInput>(opts: CommonOpts & {
  ids: (input: TInput) => string[]
  apply: (item: TList, input: TInput) => TList
}) {
  const { qc, queryKey, ids, apply } = opts
  return {
    onMutate: (input: TInput): OptimisticContext<TList> => {
      qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<TList[]>(queryKey)
      const targetIds = new Set(ids(input))
      if (targetIds.size === 0) return { previous }
      qc.setQueryData<TList[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr.map((item) => (targetIds.has(item.id) ? apply(item, input) : item))
      })
      return { previous }
    },
    onError: makeRollback<TList>(opts),
    onSettled: makeSettled(opts),
  }
}
```

- [ ] **Step 2.4: Run tests to confirm all pass**

Run: `npm test -- --run src/lib/queries/optimistic.test.ts`
Expected: 7/7 pass.

- [ ] **Step 2.5: Run full build to confirm typecheck**

Run: `npm run build`
Expected: build succeeds with no TS errors.

- [ ] **Step 2.6: Commit (Commit 1 of 3)**

```bash
git add src/lib/queries/optimistic.ts src/lib/queries/optimistic.test.ts
git commit -m "$(cat <<'EOF'
feat(optimistic): add makeOptimisticBulkDelete and makeOptimisticBulkMove helpers + tests (H3, B-4)

Two new helpers in the same shape as makeOptimisticDelete / makeOptimisticUpdate.
makeOptimisticBulkDelete filters every matching id from the cache in one tick;
makeOptimisticBulkMove maps every matching id through a caller-supplied apply()
function. Both snapshot the cache before writing and restore on error via the
shared makeRollback. errorToast surfacing already supported by makeRollback.

No call sites yet — wired up in subsequent commits. Adds the first unit tests
for optimistic.ts (T-7 was untested infra per the audit). 7 tests against a
real QueryClient: happy path, empty-input no-op, rollback, partial match,
nested-field patching.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Narrow `editItem` invalidation + optimistic fan-out (Commit 2 of 3)

**Files:**
- Modify: `src/gear/GearLibraryPage.tsx:218-232` (the `editItem` mutation)
- Modify: `src/lists/ListDetailPage.tsx:301-311` (the `updateGearItemMut` mutation)

**Mental model:** today, both `editItem` mutations write optimistically to `['gear-items']` and broadly invalidate `['list-items']` on settled. The fix is:

1. On `onMutate`, after the existing gear-items optimistic write, enumerate all `['list-items', listId]` caches that contain the affected gear id, snapshot each, and write the patch into each cache's embedded `gear_item`.
2. On `onError`, restore each snapshotted list-items cache (in addition to the existing gear-items rollback).
3. On `onSettled`, invalidate only the affected list-items caches (not the broad `['list-items']` key).

The duplication between the two call sites is intentional per the spec — helper extraction is a future commit.

- [ ] **Step 3.1: Read both call sites end-to-end**

Read `src/gear/GearLibraryPage.tsx:218-232` and `src/lists/ListDetailPage.tsx:301-311`. Confirm:
- Both currently use `makeOptimisticUpdate<GearItem, { id: string; patch: Parameters<typeof updateGearItem>[1] }>` with `invalidateKeys: [['list-items']]`.
- `qc` (QueryClient) is in scope at both sites.
- Both files import `ListItemWithGear` (or can have it added; ListDetailPage already imports it from `../lib/types` per Phase 1).

- [ ] **Step 3.2: Replace `GearLibraryPage.tsx` editItem with hand-rolled fan-out**

In `src/gear/GearLibraryPage.tsx`, replace the `editItem` mutation block (around lines 218–232) with:

```tsx
const editItem = useMutation({
  mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
    updateGearItem(id, patch),
  onMutate: ({ id, patch }) => {
    // Primary cache: optimistically apply patch to the gear item.
    qc.cancelQueries({ queryKey: queryKeys.gearItems() })
    const previousGear = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
    qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
      curr ? curr.map((g) => (g.id === id ? { ...g, ...patch } : g)) : curr,
    )

    // Fan out to every list-items cache that references this gear. Without
    // this, an immediate reorder after a category change reads stale embedded
    // category_id and writes corrupted sort_order to the wrong category.
    const affected = qc.getQueryCache()
      .findAll({ queryKey: ['list-items'] })
      .filter((q) => (q.state.data as ListItemWithGear[] | undefined)?.some((i) => i.gear_item_id === id))
    const listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[] = []
    for (const q of affected) {
      const key = q.queryKey
      qc.cancelQueries({ queryKey: key })
      listSnapshots.push({ key, data: qc.getQueryData<ListItemWithGear[]>(key) })
      qc.setQueryData<ListItemWithGear[]>(key, (curr) =>
        curr?.map((item) =>
          item.gear_item_id === id
            ? { ...item, gear_item: { ...item.gear_item, ...patch } }
            : item,
        ),
      )
    }

    return { previousGear, listSnapshots }
  },
  onError: (_err, _vars, ctx) => {
    if (ctx?.previousGear) qc.setQueryData(queryKeys.gearItems(), ctx.previousGear)
    if (ctx?.listSnapshots) {
      for (const { key, data } of ctx.listSnapshots) {
        qc.setQueryData(key, data)
      }
    }
  },
  onSettled: (_data, _err, _vars, ctx) => {
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    if (ctx?.listSnapshots) {
      for (const { key } of ctx.listSnapshots) {
        qc.invalidateQueries({ queryKey: key })
      }
    }
  },
})
```

Add `QueryKey` to the `@tanstack/react-query` import at the top of the file if not already present.

- [ ] **Step 3.3: Replace `ListDetailPage.tsx` updateGearItemMut with the same shape**

In `src/lists/ListDetailPage.tsx`, replace the `updateGearItemMut` mutation block (around lines 301–311) with the structurally-identical hand-rolled fan-out:

```tsx
const updateGearItemMut = useMutation({
  mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
    updateGearItem(id, patch),
  onMutate: ({ id, patch }) => {
    qc.cancelQueries({ queryKey: queryKeys.gearItems() })
    const previousGear = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
    qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
      curr ? curr.map((g) => (g.id === id ? { ...g, ...patch } : g)) : curr,
    )

    const affected = qc.getQueryCache()
      .findAll({ queryKey: ['list-items'] })
      .filter((q) => (q.state.data as ListItemWithGear[] | undefined)?.some((i) => i.gear_item_id === id))
    const listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[] = []
    for (const q of affected) {
      const key = q.queryKey
      qc.cancelQueries({ queryKey: key })
      listSnapshots.push({ key, data: qc.getQueryData<ListItemWithGear[]>(key) })
      qc.setQueryData<ListItemWithGear[]>(key, (curr) =>
        curr?.map((item) =>
          item.gear_item_id === id
            ? { ...item, gear_item: { ...item.gear_item, ...patch } }
            : item,
        ),
      )
    }

    return { previousGear, listSnapshots }
  },
  onError: (_err, _vars, ctx) => {
    if (ctx?.previousGear) qc.setQueryData(queryKeys.gearItems(), ctx.previousGear)
    if (ctx?.listSnapshots) {
      for (const { key, data } of ctx.listSnapshots) {
        qc.setQueryData(key, data)
      }
    }
  },
  onSettled: (_data, _err, _vars, ctx) => {
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    if (ctx?.listSnapshots) {
      for (const { key } of ctx.listSnapshots) {
        qc.invalidateQueries({ queryKey: key })
      }
    }
  },
})
```

Add `QueryKey` to the `@tanstack/react-query` import if needed.

- [ ] **Step 3.4: Run build to confirm typecheck**

Run: `npm run build`
Expected: build succeeds. If the `useMutation` generic complains about the context-shape, add an explicit type annotation on the mutation: `useMutation<GearItem, Error, { id: string; patch: ... }, { previousGear: GearItem[] | undefined; listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[] }>({...})`.

- [ ] **Step 3.5: Run existing tests**

Run: `npm test -- --run`
Expected: all pass (no behavioral test for editItem, but typecheck + nothing-broken-elsewhere).

- [ ] **Step 3.6: Commit (Commit 2 of 3)**

```bash
git add src/gear/GearLibraryPage.tsx src/lists/ListDetailPage.tsx
git commit -m "$(cat <<'EOF'
fix(editItem): narrow invalidation and fan out category_id optimistically (H2, B-2)

Both editItem mutations broadcast ['list-items'] invalidation across every
open list cache. That's the H2 fanout cost — but more importantly, for
category_id changes it created a correctness window: groupListItemsByCategory
read the stale embedded category until refetch landed, and an immediate
reorder within the new category wrote corrupted sort_order to the server.
Optimistic UI hid the corruption until refresh.

Now: enumerate the affected list-items caches (those whose data contains
this gear_item_id), write the patch into each cache's embedded gear_item,
snapshot for rollback, and invalidate only those caches on settled. The
patch propagates wholesale, including category_id, so the staleness
window closes.

Hand-rolled at both call sites rather than extracted into a helper —
helper extraction is a future commit once the shape proves stable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire bulk gear ops through the new helpers (Commit 3 of 3)

**Files:**
- Modify: `src/gear/GearLibraryPage.tsx:246-255` (the `bulkDelete` and `bulkMove` mutations)

**Mental model:** Commit 1's helpers handle the `['gear-items']` cache (snapshot + optimistic + rollback). The list-items cache fan-out for `bulkMove` (category_id rewrite across affected list caches) is hand-rolled in `onMutate` / `onError` / `onSettled`, parallel to Commit 2's pattern but applied across a SET of gear ids. `bulkDelete`'s list-items invalidation can be enumeration-narrowed too — same pattern — since list_items rows for deleted gear cascade in the DB.

- [ ] **Step 4.1: Read the current bulkDelete and bulkMove blocks**

Read `src/gear/GearLibraryPage.tsx:246-255`. Confirm the current shape:

```tsx
const bulkDelete = useMutation({
  mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
  onSuccess: () => { invalidateItems(); invalidateListItems(); exitSelectMode() },
})

const bulkMove = useMutation({
  mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string | null }) =>
    bulkMoveToCategoryGearItems(ids, categoryId),
  onSuccess: () => { invalidateItems(); invalidateListItems(); exitSelectMode() },
})
```

Note the existing `invalidateItems` and `invalidateListItems` callbacks. We keep `invalidateItems` (subsumed by helper's onSettled) and replace `invalidateListItems` with targeted enumeration.

- [ ] **Step 4.2: Add helper imports**

In `src/gear/GearLibraryPage.tsx`, extend the existing import from `../lib/queries` (or wherever the optimistic helpers are imported from — match the existing `makeOptimisticDelete` / `makeOptimisticUpdate` import in this file):

```ts
import {
  // …existing imports…
  makeOptimisticBulkDelete,
  makeOptimisticBulkMove,
} from '...'
```

Also confirm `showToast` is importable: `import { showToast } from '../lib/toast'` (check the existing imports first — may already be present).

- [ ] **Step 4.3: Replace `bulkDelete` mutation**

Replace the `bulkDelete` block with:

```tsx
const bulkDelete = useMutation({
  mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
  ...makeOptimisticBulkDelete<GearItem, string[]>({
    qc,
    queryKey: queryKeys.gearItems(),
    ids: (ids) => ids,
  }),
  // Side-cache: any list-items cache containing one of these gear ids needs
  // a refetch since the cascade removed the corresponding list_items rows
  // server-side. Enumerate rather than broad-invalidating ['list-items'].
  onSettled: (_data, _err, ids) => {
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    if (!ids) return
    const idSet = new Set(ids)
    const affected = qc.getQueryCache()
      .findAll({ queryKey: ['list-items'] })
      .filter((q) =>
        (q.state.data as ListItemWithGear[] | undefined)?.some((i) => idSet.has(i.gear_item_id)),
      )
    for (const q of affected) qc.invalidateQueries({ queryKey: q.queryKey })
  },
  onSuccess: () => exitSelectMode(),
  onError: () => {
    showToast("Couldn't delete the selected items. Please try again.", { type: 'error' })
  },
})
```

**Why this shape:** the helper supplies `onMutate` (snapshot + optimistic filter), and `onError` (rollback). We override `onSettled` to enumerate list-items invalidation, and we add `onSuccess` (exit select mode) and our own `onError` (toast). The user explicitly stays in select mode on error — `exitSelectMode` is in `onSuccess`, not `onSettled`.

Important: `useMutation` merges options it knows about. Our `onSuccess` and `onError` here override the spread — and `onError` also overrides the helper's rollback. To preserve rollback, **call `makeRollback`'s behavior explicitly inside our `onError`**, or use the spread's `onError` in addition. Cleanest:

```tsx
const bulkDeleteHelper = makeOptimisticBulkDelete<GearItem, string[]>({
  qc,
  queryKey: queryKeys.gearItems(),
  ids: (ids) => ids,
})

const bulkDelete = useMutation({
  mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
  onMutate: bulkDeleteHelper.onMutate,
  onError: (err, vars, ctx) => {
    bulkDeleteHelper.onError(err, vars, ctx)
    showToast("Couldn't delete the selected items. Please try again.", { type: 'error' })
  },
  onSuccess: () => exitSelectMode(),
  onSettled: (_data, _err, ids) => {
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    if (!ids) return
    const idSet = new Set(ids)
    const affected = qc.getQueryCache()
      .findAll({ queryKey: ['list-items'] })
      .filter((q) =>
        (q.state.data as ListItemWithGear[] | undefined)?.some((i) => idSet.has(i.gear_item_id)),
      )
    for (const q of affected) qc.invalidateQueries({ queryKey: q.queryKey })
  },
})
```

This explicit composition avoids the spread-vs-override ambiguity and makes the rollback path explicit.

- [ ] **Step 4.4: Replace `bulkMove` mutation with helper + list-items fan-out**

Replace the `bulkMove` block with:

```tsx
const bulkMoveHelper = makeOptimisticBulkMove<GearItem, { ids: string[]; categoryId: string | null }>({
  qc,
  queryKey: queryKeys.gearItems(),
  ids: (input) => input.ids,
  apply: (item, input) => ({ ...item, category_id: input.categoryId }),
})

const bulkMove = useMutation({
  mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string | null }) =>
    bulkMoveToCategoryGearItems(ids, categoryId),
  onMutate: (input) => {
    const gearCtx = bulkMoveHelper.onMutate(input)
    // Fan out category_id to every list-items cache containing any of the
    // moved gear ids. Without this, B-2 reproduces at scale — an immediate
    // reorder in the destination category writes corrupted sort_order.
    const idSet = new Set(input.ids)
    const affected = qc.getQueryCache()
      .findAll({ queryKey: ['list-items'] })
      .filter((q) =>
        (q.state.data as ListItemWithGear[] | undefined)?.some((i) => idSet.has(i.gear_item_id)),
      )
    const listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[] = []
    for (const q of affected) {
      const key = q.queryKey
      qc.cancelQueries({ queryKey: key })
      listSnapshots.push({ key, data: qc.getQueryData<ListItemWithGear[]>(key) })
      qc.setQueryData<ListItemWithGear[]>(key, (curr) =>
        curr?.map((item) =>
          idSet.has(item.gear_item_id)
            ? { ...item, gear_item: { ...item.gear_item, category_id: input.categoryId } }
            : item,
        ),
      )
    }
    return { ...gearCtx, listSnapshots }
  },
  onError: (err, vars, ctx) => {
    bulkMoveHelper.onError(err, vars, ctx)
    if (ctx?.listSnapshots) {
      for (const { key, data } of ctx.listSnapshots) {
        qc.setQueryData(key, data)
      }
    }
    showToast("Couldn't move the selected items. Please try again.", { type: 'error' })
  },
  onSuccess: () => exitSelectMode(),
  onSettled: (_data, _err, _vars, ctx) => {
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    if (ctx?.listSnapshots) {
      for (const { key } of ctx.listSnapshots) {
        qc.invalidateQueries({ queryKey: key })
      }
    }
  },
})
```

- [ ] **Step 4.5: Run build to confirm typecheck**

Run: `npm run build`
Expected: build succeeds. If `useMutation`'s context generic complains, add an explicit `useMutation<TData, Error, TVars, TContext>` annotation. The `bulkMove` context shape is `{ previous: GearItem[] | undefined; listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[] }`.

- [ ] **Step 4.6: Run all tests**

Run: `npm test -- --run`
Expected: all pass (the 7 helper tests still green, no other tests touched).

- [ ] **Step 4.7: Commit (Commit 3 of 3)**

```bash
git add src/gear/GearLibraryPage.tsx
git commit -m "$(cat <<'EOF'
fix(bulk): optimistic bulkDelete/bulkMove with onError toasts and category fan-out (H3, B-4)

bulkDelete and bulkMove on /gear were the last two non-optimistic CRUD
paths on the page. A 50-item bulk wait-and-blink, and a server failure
left the user in select mode with stale UI and no error state because
exitSelectMode was in onSuccess.

Now both go through Commit 1's helpers for the gear-items cache (snapshot
+ optimistic + rollback), surface a showToast on error, and exit select
mode only on success — so a failed bulk leaves the selection intact for
retry. List-items cache fan-out: bulkDelete narrows invalidation to only
the list caches that contained one of the deleted gear ids; bulkMove
additionally writes category_id into each affected list-items cache to
close B-2 at scale (without this, an immediate reorder in the destination
category corrupts sort_order on bulk moves the same way single edits did).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update REVIEW-FIX.md

**Files:**
- Modify: `.planning/REVIEW-FIX.md` (append a Phase 2 section)

- [ ] **Step 5.1: Append Phase 2 section to REVIEW-FIX.md**

Append below the existing Phase 1 content:

```markdown

---

## Phase 2 — broad-invalidation cluster (2026-05-04)

### Shipped
- Commit 1 (H3, B-4 infra): commit <hash> — `makeOptimisticBulkDelete` + `makeOptimisticBulkMove` helpers + 7 unit tests in `src/lib/queries/optimistic.test.ts`. First test coverage for `optimistic.ts` (T-7 partially closed).
- Commit 2 (H2, B-2): commit <hash> — `editItem` narrowed invalidation + `category_id` fan-out at both `GearLibraryPage` and `ListDetailPage`. Hand-rolled at both call sites; helper extraction deferred per spec.
- Commit 3 (H3, B-4, B-2-at-scale): commit <hash> — `bulkDelete` and `bulkMove` rewired through the new helpers; `showToast` on error; `exitSelectMode` only on success so failed bulk preserves the user's selection. `bulkMove` fans `category_id` out to affected list-items caches.

### Verification results
- `npm run build`: pass after all three commits.
- `npm test --run`: 7/7 new optimistic tests pass; 13/13 csv + 3/3 WeightTable still pass.
- Manual smoke (drag-reorder race, bulk-delete error toast, bulk-move + reorder race): **pending user verification** — these gates can't run from a non-interactive terminal. CLAUDE.md's "hard-refresh after a write to confirm the server accepted" rule applies double on optimistic bulks.

### Blockers / surprises
- Toast utility was already present (`showToast` from `src/lib/toast.ts`, used by `makeOptimisticReorder` and `makeRollback`); used directly rather than introducing local error state.
- TanStack Query `useMutation` mixing of spread helpers with custom `onError` / `onSuccess` / `onSettled` was rewritten to explicit composition (`bulkDeleteHelper.onMutate` called directly, etc.) to keep the rollback path obvious. Functionally equivalent to a spread-plus-override but reads better.

### Next phase
Phase 3: bundle splitting (H4 react-markdown lazy, H5 vaul lazy, H6 fflate dynamic, L7 route code-split). Independent fixes verifiable with build size before/after.
```

Replace the three `<hash>` placeholders with the actual short hashes from `git log --oneline -3` after Commit 3 lands.

- [ ] **Step 5.2: Commit the summary update**

```bash
git add .planning/REVIEW-FIX.md
git commit -m "$(cat <<'EOF'
docs(review-fix): append Phase 2 summary

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review against the locked spec

**Spec coverage:**
- ✅ Commit 1 (helpers + tests): Tasks 1 + 2.
- ✅ Commit 2 (editItem narrow + fan-out at both call sites): Task 3.
- ✅ Commit 3 (bulkDelete + bulkMove via helpers, fan-out, toasts, preserve select mode): Task 4.
- ✅ REVIEW-FIX.md update: Task 5.
- ⚠️ Spec asked for 4 bulkDelete tests + 3 bulkMove tests = 8. Plan has 4 + 3 = 7. The spec said "the eight tests above" but listed only 7 (4 + 3). Going with 7; matches what's actually enumerated in the spec, not the count.

**Type consistency:**
- Helper signatures: `makeOptimisticBulkDelete<TList, TInput>({qc, queryKey, ids, ...CommonOpts})` and `makeOptimisticBulkMove<TList, TInput>({qc, queryKey, ids, apply, ...CommonOpts})`. Used identically in tests, Commit 3 call sites.
- Context shapes: `OptimisticContext<TList>` (existing) for helpers; extended with `listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[]` for fan-out call sites.
- `idSet` / `targetIds` naming: chose `targetIds` inside helpers (matches existing `targetId` in singular helpers), `idSet` at call sites (locality).

**Manual smoke acknowledgment:** the executor will run build + tests but flag manual smoke as pending user verification. That's the resolution we agreed to before writing the plan.
