# grampacker — Phase 13 fixes (2026-05-06)

**Source:** `REVIEW-quality.md` — W-6 (parameterize three+inline `groupBy(category)` implementations into a single helper) bundled with T-2 (pure-function tests that lock the contract before/after).
**Scope:** one new generic helper + four call-site conversions + tests + documentation. **Six commits.**
**Why bundle W-6 with T-2:** the audit's W-6 fix is risky precisely because the four sites have *deliberately different* behavior on three orthogonal axes (empty-categories, orphan-routing, structural stability). Tests written first lock current behavior so the refactor's any-site divergence fails fast in CI rather than at render time.

> **Note on file paths:** all paths are repo-relative.
> **Phase 12 baseline:** main bundle = **187.36 KB gzip**. Bundle delta expected: **≈ 0 to slightly negative** (the helper consolidates ~30 lines of duplicated grouping logic into one parameterized function; net code shrinks by 10–20 lines but adds an options object, so the wash effect dominates).
> **Risk profile:** moderate. The Phase 5 stability layer (`prior` reuse, top-level identity invariant in `groupListItemsByCategory`) is load-bearing for `useGroupedListItems` — without `next === prior` short-circuiting, the hook's setState-during-render guard would never fire and we'd see the infinite-render-loop bug Phase 5 was built to fix. Test coverage for stability already exists and stays untouched as regression cover.

---

## How to execute this file

Six commits. Order **does** matter: C1 (gear tests) before C2 (refactor) so the refactor's any divergence in `groupGearItemsByCategory` is caught by the tests added in C1, not after the wrappers ship.

C1 → C2 → C3 → C4 → C5 → C6.

After every commit:

```bash
npm run build && npm run lint && npm test -- --run
```

Build, lint, and tests must all pass before moving to the next commit.

---

## Behavior matrix (locked baseline before refactor)

The four sites today:

| Site | Item type | category_id getter | sorts cats | orphan→uncat | keepEmpty | stability |
|---|---|---|---|---|---|---|
| `groupListItemsByCategory` (`grouping.ts:54`) | `ListItemWithGear` | `i.gear_item.category_id` | yes (internal) | **route** | **false** | **yes** |
| `groupGearItemsByCategory` (`grouping.ts:131`) | `GearItem` | `i.category_id` | no (caller pre-sorts) | **drop (silent)** | **true** | no |
| `SharePage` inline (`SharePage.tsx:90-104`) | `ListItemWithGear` | `i.gear_item.category_id` | yes (internal) | **route** | **false** | no |
| `LibraryPanel` inline (`LibraryPanel.tsx:64-79`) | `GearItem` | `i.category_id` | yes (internal) | **drop (silent)** | **false** | no |

**Contract decision: the generic helper does NOT sort categories internally.** Iterating in input order is a real divergence between the named wrappers (`groupListItemsByCategory` sorts internally, `groupGearItemsByCategory` requires caller to pre-sort), and the safest way to preserve both contracts exactly is to keep sorting as a caller responsibility. `groupListItemsByCategory` and the `LibraryPanel` call site each do their own one-line `[...cats].sort((a, b) => a.sort_order - b.sort_order)` before delegating; `groupGearItemsByCategory` passes `categories` through untouched (preserving its "caller pre-sorts" contract verbatim). This keeps the helper's option surface small (no `sortCategories` flag) and ensures no public wrapper signature undergoes a documented contract shift.

**Three orthogonal axes** that vary across sites:

1. **`keepEmpty`** — `groupGearItemsByCategory` retains empty categories (the gear library shows empty cats so the user can drag items in). The other three filter empty cats out (a list view shouldn't show "Shelter" with no items).
2. **Orphan routing** — `groupListItemsByCategory` and `SharePage` route an item with `category_id` pointing at a deleted/missing category to Uncategorized so the item still shows. `groupGearItemsByCategory` and `LibraryPanel` silently drop such items (they fall out of every cat's filter AND fall out of the `=== null` check). In practice the schema's `gear_items.category_id ON DELETE SET NULL` makes orphans theoretically impossible, but the helper's documented behavior must still match what's there. **Preserve, do not converge.**
3. **Structural stability (`prior` reuse)** — only `groupListItemsByCategory` has it. `useGroupedListItems` depends on `next === prior` short-circuiting to avoid an infinite render loop. The other three sites don't have it because they don't feed memo deps that get compared by reference downstream.

The unified helper must expose all three axes as parameters. **Do not pick a default and silently apply it to sites that diverged.**

---

## Commit 1 — T-2 prep: tests for `groupGearItemsByCategory`

**Origin:** `REVIEW-quality.md` T-2 (Test gap).

**Why first:** the C2 refactor moves `groupGearItemsByCategory`'s logic onto a parameterized helper. If any axis behavior shifts (orphan handling, empty-cat handling, ordering), we want tests that fail loudly *before* the wrapper rewrite ships. Today there are zero tests for `groupGearItemsByCategory`, so a regression there is silent.

**Files:**

- Modify: `src/lib/grouping.test.ts` — add a new `describe('groupGearItemsByCategory', ...)` block.

**What to do:**

Add the gear factory and the tests. The existing `listItem()` factory in the file is for ListItemWithGear; a new local `gearItem()` factory is needed.

Add at the end of `src/lib/grouping.test.ts`:

```ts
function gearItem(overrides: {
  id: string
  category_id: string | null
  weight_grams?: number
  name?: string
}): GearItem {
  return {
    id: overrides.id,
    user_id: 'u',
    name: overrides.name ?? `gear-${overrides.id}`,
    description: null,
    weight_grams: overrides.weight_grams ?? 100,
    category_id: overrides.category_id,
    cost: null,
    purchase_date: null,
    sort_order: 0,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  }
}

describe('groupGearItemsByCategory', () => {
  it('groups items by category in input order; uncategorized last', () => {
    const items = [
      gearItem({ id: 'a', category_id: 'cat-sleep' }),
      gearItem({ id: 'b', category_id: 'cat-shelter' }),
      gearItem({ id: 'c', category_id: null }),
    ]
    // Caller pre-sorts categories — the helper iterates in INPUT order,
    // not sort_order. Pass cats in REVERSE sort_order so this test would
    // fail if the wrapper ever started sorting internally. (sleep has
    // sort_order: 1, shelter has sort_order: 0; passing [sleep, shelter]
    // means input-order output is [sleep, shelter, uncategorized] —
    // explicitly NOT sort_order order.)
    const result = groupGearItemsByCategory(items, [sleep, shelter])
    expect(result).toHaveLength(3)
    expect(result[0]!.category?.id).toBe('cat-sleep')
    expect(result[1]!.category?.id).toBe('cat-shelter')
    expect(result[2]!.category).toBeNull()
  })

  // The deliberate divergence from groupListItemsByCategory: the gear
  // library renders empty cat sections so the user can drag items in.
  // Passes cats in reverse sort_order to keep this test honest about
  // input-order iteration too.
  it('retains empty categories', () => {
    const items = [gearItem({ id: 'a', category_id: 'cat-shelter' })]
    const result = groupGearItemsByCategory(items, [sleep, shelter])
    expect(result).toHaveLength(2)
    expect(result[0]!.category?.id).toBe('cat-sleep')
    expect(result[0]!.items).toHaveLength(0)
    expect(result[1]!.category?.id).toBe('cat-shelter')
    expect(result[1]!.items).toHaveLength(1)
  })

  it('only emits the uncategorized group when at least one item lacks a category', () => {
    const items = [gearItem({ id: 'a', category_id: 'cat-shelter' })]
    const result = groupGearItemsByCategory(items, [shelter])
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
  })

  // Locked behavior — schema's ON DELETE SET NULL makes orphans
  // unreachable in practice, but the helper's documented contract is
  // "drop silently" and the parameterized refactor must preserve it.
  // Switching to "route to uncategorized" would be a behavior change.
  it('drops items whose category_id points at a missing category (locked divergence)', () => {
    const items = [
      gearItem({ id: 'a', category_id: 'cat-shelter' }),
      gearItem({ id: 'b', category_id: 'cat-deleted' }),
    ]
    const result = groupGearItemsByCategory(items, [shelter])
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
    expect(result[0]!.items).toHaveLength(1)
    expect(result[0]!.items[0]!.id).toBe('a')
    // Item 'b' is gone from the output.
  })
})
```

You'll also need to update the imports at the top of the test file to include `groupGearItemsByCategory` and `GearItem`:

```ts
import { groupListItemsByCategory, groupGearItemsByCategory } from './grouping'
import type { Category, GearItem, ListItemWithGear } from './types'
```

**Verification:**

- `npm test -- --run` shows the four new tests pass against the *current* (pre-refactor) `groupGearItemsByCategory` implementation. **This is critical** — they must pass on the unchanged helper before C2 is allowed to land.
- `npm run build` and `npm run lint` pass.

**Acceptance criteria:** four new tests for `groupGearItemsByCategory`; all pass on the pre-refactor implementation; lock the current behavior on each of the three axes (cat ordering, keepEmpty=true, orphan-drop).

**Suggested commit:** `test(grouping): lock groupGearItemsByCategory behavior before W-6 refactor (T-2)`

---

## Commit 2 — W-6: parameterize `groupByCategory`; rewire wrappers

**Origin:** `REVIEW-quality.md` W-6 (Warning).

**Why:**

Three places to drift independently (the two named helpers + two inline reproductions in `SharePage.tsx` and `LibraryPanel.tsx`). A bug found in one rarely propagates to the others — see the `WeightTable` orphan-routing bug at `REVIEW-quality.md:17` for a cousin of this exact problem. One generic helper, four typed call sites.

**Files:**

- Modify: `src/lib/grouping.ts` — add `groupByCategory<T>(...)`; refactor existing wrappers to call it.

**What to do:**

The new generic helper signature:

```ts
type GroupByCategoryOptions<T> = {
  keepEmpty: boolean
  orphanPolicy: 'route-to-uncategorized' | 'drop'
  // Opt-in structural stability. Both fields are required together so
  // a caller can't accidentally pass `prior` without the comparator
  // (which would silently never reuse anything). Only `useGroupedListItems`
  // currently needs this — the other three call sites pass `undefined`.
  stability?: {
    prior: CategoryGroup<T>[]
    itemsEqual: (a: T[], b: T[]) => boolean
  }
}

export function groupByCategory<T>(
  items: T[],
  categories: Category[],
  getCategoryId: (item: T) => string | null,
  options: GroupByCategoryOptions<T>,
): CategoryGroup<T>[]
```

Implementation outline:

```ts
export function groupByCategory<T>(
  items: T[],
  categories: Category[],
  getCategoryId: (item: T) => string | null,
  options: GroupByCategoryOptions<T>,
): CategoryGroup<T>[] {
  const { keepEmpty, orphanPolicy, stability } = options

  // Build buckets keyed by resolved category id.
  // - 'route-to-uncategorized': raw id missing from categories → null bucket
  // - 'drop': raw id missing from categories → item is silently discarded
  const buckets = new Map<string | null, T[]>()
  const catMap = new Map(categories.map((c) => [c.id, c]))
  for (const item of items) {
    const raw = getCategoryId(item)
    let key: string | null
    if (raw === null) {
      key = null
    } else if (catMap.has(raw)) {
      key = raw
    } else if (orphanPolicy === 'route-to-uncategorized') {
      key = null
    } else {
      // 'drop' — silently discard
      continue
    }
    let arr = buckets.get(key)
    if (!arr) {
      arr = []
      buckets.set(key, arr)
    }
    arr.push(item)
  }

  // Categories are emitted in INPUT order. The helper does NOT sort
  // internally — sorting is the caller's responsibility. The two named
  // wrappers diverge here (groupListItemsByCategory sorts internally
  // before delegating; groupGearItemsByCategory passes through unsorted
  // per its "caller pre-sorts" contract). Keeping the sort decision in
  // the caller preserves both wrapper contracts exactly.

  // Stability scaffolding: priorByKey maps category-id (or null for
  // uncategorized) to the prior call's group object. Only consulted when
  // `stability` is supplied.
  const priorByKey = new Map<string | null, CategoryGroup<T>>()
  if (stability) {
    for (const g of stability.prior) {
      priorByKey.set(g.category?.id ?? null, g)
    }
  }

  const result: CategoryGroup<T>[] = []
  for (const cat of categories) {
    // Use [] as the canonical empty-bucket value so every cat goes
    // through the same stability check — including empty-but-retained
    // ones when keepEmpty: true. itemsEqual([], []) returns true for
    // the listItems comparator (length check passes, the for-loop
    // doesn't iterate), so a prior empty group is reused on the next
    // call. Without this, a caller combining `keepEmpty: true` with
    // `stability` would see fresh `{ items: [] }` references for empty
    // cats every call, breaking the top-level identity invariant.
    const groupItems = buckets.get(cat.id) ?? []
    if (groupItems.length === 0 && !keepEmpty) continue
    if (stability) {
      const priorGroup = priorByKey.get(cat.id)
      if (
        priorGroup &&
        priorGroup.category === cat &&
        stability.itemsEqual(priorGroup.items, groupItems)
      ) {
        result.push(priorGroup)
        continue
      }
    }
    result.push({ category: cat, items: groupItems })
  }

  const uncategorized = buckets.get(null)
  if (uncategorized && uncategorized.length > 0) {
    if (stability) {
      const priorGroup = priorByKey.get(null)
      if (
        priorGroup &&
        priorGroup.category === null &&
        stability.itemsEqual(priorGroup.items, uncategorized)
      ) {
        result.push(priorGroup)
      } else {
        result.push({ category: null, items: uncategorized })
      }
    } else {
      result.push({ category: null, items: uncategorized })
    }
  }
  // Note: the empty-uncategorized case is NEVER emitted, even with
  // keepEmpty: true. None of the four call sites want a "Uncategorized: 0
  // items" row. If a future caller needs it, add a separate option.

  // Top-level identity invariant: when stability is on AND every group
  // is reused, return prior itself (not a structurally-equal copy).
  // useGroupedListItems depends on `next === prior` to skip its setState
  // call and avoid an infinite render loop.
  if (stability && stability.prior.length === result.length) {
    let allSame = true
    for (let i = 0; i < result.length; i++) {
      if (result[i] !== stability.prior[i]) {
        allSame = false
        break
      }
    }
    if (allSame) return stability.prior
  }

  return result
}
```

Then rewrite the existing wrappers to call it. **Critical:** `groupListItemsByCategory` sorts categories before delegating (preserving its existing "sorts internally" contract); `groupGearItemsByCategory` passes categories through untouched (preserving its existing "caller pre-sorts" contract).

```ts
export function groupListItemsByCategory(
  items: ListItemWithGear[],
  categories: Category[],
  prior?: CategoryGroup<ListItemWithGear>[],
): CategoryGroup<ListItemWithGear>[] {
  // Wrapper sorts internally — preserves the existing contract documented
  // at this function. The generic `groupByCategory` iterates in input
  // order; the sort lives here so the wrapper's signature is stable.
  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
  return groupByCategory(
    items,
    sortedCats,
    (i) => i.gear_item.category_id,
    {
      keepEmpty: false,
      orphanPolicy: 'route-to-uncategorized',
      stability: prior ? { prior, itemsEqual: listItemsArrayEqual } : undefined,
    },
  )
}

export function groupGearItemsByCategory(
  items: GearItem[],
  categories: Category[],
): CategoryGroup<GearItem>[] {
  // Wrapper does NOT sort — preserves the "caller pre-sorts" contract
  // documented at this function. The single live caller (GearLibraryPage)
  // feeds pre-sorted output from fetchCategories.
  return groupByCategory(
    items,
    categories,
    (i) => i.category_id,
    {
      keepEmpty: true,
      orphanPolicy: 'drop',
    },
  )
}
```

The `listItemsArrayEqual` helper (currently a private function in `grouping.ts`) stays where it is — it's only consumed by the listItems wrapper.

**JSDoc unchanged for both wrappers.** Both wrappers preserve their existing contracts verbatim:
- `groupListItemsByCategory` continues to say "Categories are emitted in `Category.sort_order` order" (now achieved via the explicit `sortedCats` line in the wrapper).
- `groupGearItemsByCategory` continues to say "Categories are emitted in `Category.sort_order` order (the input array's order — caller pre-sorts)" (now achieved by passing input cats through).

**Verification:**

- `npm test -- --run` — every existing `groupListItemsByCategory` test still passes (tests at `grouping.test.ts:56-152`). Every new `groupGearItemsByCategory` test from C1 still passes. **This is the entire point of the C1-before-C2 ordering.**
- `npm run build` — `tsc -b` confirms the wrappers' signatures are unchanged at the type level (the only consumer of the prior signature is `useGroupedListItems` at `use-grouped-list-items.ts:28`, which calls `groupListItemsByCategory(items, categories, cached)` with three args).
- `npm run lint` passes.

**Acceptance criteria:** generic `groupByCategory` exported; both named wrappers behave identically to before; all 11 existing/new pure tests pass; bundle size delta ≤ +0.05 KB gzip (consolidation should be neutral or slightly negative).

**Suggested commit:** `refactor(grouping): parameterize groupByCategory with explicit keepEmpty/orphan/stability options (W-6)`

---

## Commit 3 — T-2: tests for the generic `groupByCategory` directly

**Origin:** `REVIEW-quality.md` T-2 (Test gap).

**Why:**

C2's wrappers exercise *some* combinations of the option matrix (`keepEmpty: false + route + stability` for listItems, `keepEmpty: true + drop + no stability` for gear). The other four matrix corners (`keepEmpty: false + drop`, `keepEmpty: true + route`, etc.) only get exercised by the SharePage and LibraryPanel call sites we're about to convert in C4/C5 — but those sites have no unit tests, so the matrix corners would only be tested via render-level integration. Direct tests on `groupByCategory` make the contract explicit and survive call-site removal.

**Files:**

- Modify: `src/lib/grouping.test.ts` — extend the imports to include `groupByCategory`, then add a `describe('groupByCategory (generic)', ...)` block.

**What to do:**

### Step 1 — extend the import line

Update the import added in C1 to include the new generic helper. After C3 the import line reads:

```ts
import { groupListItemsByCategory, groupGearItemsByCategory, groupByCategory } from './grouping'
```

### Step 2 — add the test block

Add a focused test block. Use a minimal item shape (`{ id: string; category_id: string | null }`) so the tests are not coupled to ListItemWithGear or GearItem.

```ts
describe('groupByCategory (generic)', () => {
  type Item = { id: string; category_id: string | null }
  const getKey = (i: Item) => i.category_id

  it('keepEmpty: true retains categories with no items', () => {
    const items: Item[] = [{ id: '1', category_id: 'cat-shelter' }]
    const result = groupByCategory(items, [shelter, sleep], getKey, {
      keepEmpty: true,
      orphanPolicy: 'drop',
    })
    expect(result).toHaveLength(2)
    expect(result[0]!.category?.id).toBe('cat-shelter')
    expect(result[0]!.items).toHaveLength(1)
    expect(result[1]!.category?.id).toBe('cat-sleep')
    expect(result[1]!.items).toHaveLength(0)
  })

  it('keepEmpty: false drops categories with no items', () => {
    const items: Item[] = [{ id: '1', category_id: 'cat-shelter' }]
    const result = groupByCategory(items, [shelter, sleep], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
  })

  it('orphanPolicy: route routes orphan-keyed items to uncategorized', () => {
    const items: Item[] = [
      { id: '1', category_id: 'cat-shelter' },
      { id: '2', category_id: 'cat-deleted' },
    ]
    const result = groupByCategory(items, [shelter], getKey, {
      keepEmpty: false,
      orphanPolicy: 'route-to-uncategorized',
    })
    expect(result).toHaveLength(2)
    expect(result[0]!.category?.id).toBe('cat-shelter')
    expect(result[1]!.category).toBeNull()
    expect(result[1]!.items).toHaveLength(1)
    expect(result[1]!.items[0]!.id).toBe('2')
  })

  it('orphanPolicy: drop silently discards orphan-keyed items', () => {
    const items: Item[] = [
      { id: '1', category_id: 'cat-shelter' },
      { id: '2', category_id: 'cat-deleted' },
    ]
    const result = groupByCategory(items, [shelter], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
    expect(result[0]!.items).toHaveLength(1)
    expect(result[0]!.items[0]!.id).toBe('1')
  })

  it('emits categories in INPUT order — helper does not sort internally', () => {
    const items: Item[] = [
      { id: '1', category_id: 'cat-sleep' },
      { id: '2', category_id: 'cat-shelter' },
    ]
    // Pass cats in REVERSE sort_order; helper must NOT reorder them.
    // Sorting is the caller's responsibility (the named wrappers and
    // LibraryPanel each sort before delegating). This test would fail
    // if a future change reintroduced an internal sort.
    const result = groupByCategory(items, [sleep, shelter], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
    })
    expect(result[0]!.category?.id).toBe('cat-sleep')
    expect(result[1]!.category?.id).toBe('cat-shelter')
  })

  it('uncategorized appears last and only when non-empty (even with keepEmpty: true)', () => {
    // Negative branch: no item has category_id: null → no uncategorized
    // group emitted, even with keepEmpty: true.
    const withoutNull = groupByCategory(
      [{ id: '1', category_id: 'cat-shelter' }] as Item[],
      [shelter, sleep],
      getKey,
      { keepEmpty: true, orphanPolicy: 'drop' },
    )
    expect(withoutNull).toHaveLength(2)
    expect(withoutNull.find((g) => g.category === null)).toBeUndefined()

    // Positive branch: at least one item has category_id: null →
    // uncategorized group IS emitted, and appears LAST. Without this
    // half, a regression where the helper's `raw === null` bucketing
    // branch broke under orphanPolicy: 'drop' would still pass C3.
    const withNull = groupByCategory(
      [
        { id: '1', category_id: 'cat-shelter' },
        { id: '2', category_id: null },
      ] as Item[],
      [shelter, sleep],
      getKey,
      { keepEmpty: true, orphanPolicy: 'drop' },
    )
    expect(withNull).toHaveLength(3)
    expect(withNull.at(-1)!.category).toBeNull()
    expect(withNull.at(-1)!.items).toHaveLength(1)
    expect(withNull.at(-1)!.items[0]!.id).toBe('2')
  })

  it('stability: returns prior top-level reference when nothing changed', () => {
    const items: Item[] = [{ id: '1', category_id: 'cat-shelter' }]
    const itemsEqual = (a: Item[], b: Item[]) =>
      a.length === b.length && a.every((x, i) => x.id === b[i]!.id)
    const first = groupByCategory(items, [shelter], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
    })
    const second = groupByCategory(items, [shelter], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
      stability: { prior: first, itemsEqual },
    })
    expect(second).toBe(first)
  })

  it('stability: rebuilds top-level when at least one group changed', () => {
    const items1: Item[] = [
      { id: '1', category_id: 'cat-shelter' },
      { id: '2', category_id: 'cat-sleep' },
    ]
    const itemsEqual = (a: Item[], b: Item[]) =>
      a.length === b.length && a.every((x, i) => x.id === b[i]!.id)
    const first = groupByCategory(items1, [shelter, sleep], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
    })
    // Add an item to shelter; sleep group unchanged.
    const items2: Item[] = [
      ...items1,
      { id: '3', category_id: 'cat-shelter' },
    ]
    const second = groupByCategory(items2, [shelter, sleep], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
      stability: { prior: first, itemsEqual },
    })
    expect(second).not.toBe(first)
    // The unchanged sleep group reuses the prior reference.
    expect(second[1]!).toBe(first[1]!)
  })

  // Regression cover for the keepEmpty:true + stability combination.
  // Today no live caller combines these (gear library has no stability
  // layer), but the helper's option matrix permits it, so a future
  // caller would hit silent identity churn without this test.
  it('stability: reuses empty-cat group references when keepEmpty: true and items unchanged', () => {
    const itemsEqual = (a: Item[], b: Item[]) =>
      a.length === b.length && a.every((x, i) => x.id === b[i]!.id)
    const items: Item[] = [{ id: '1', category_id: 'cat-shelter' }]
    // sleep is empty in both calls. With keepEmpty: true the helper
    // emits an empty sleep group on the first call; the second call
    // (with stability) must reuse the SAME group reference, not a
    // fresh `{ category: sleep, items: [] }` object.
    const first = groupByCategory(items, [shelter, sleep], getKey, {
      keepEmpty: true,
      orphanPolicy: 'drop',
    })
    expect(first).toHaveLength(2)
    expect(first[1]!.items).toHaveLength(0)
    const second = groupByCategory(items, [shelter, sleep], getKey, {
      keepEmpty: true,
      orphanPolicy: 'drop',
      stability: { prior: first, itemsEqual },
    })
    // Top-level identity invariant holds even with empty cats present.
    expect(second).toBe(first)
    expect(second[1]!).toBe(first[1]!)
  })
})
```

**Verification:**

- `npm test -- --run` — nine new tests pass.
- `npm run build` and `npm run lint` pass.

**Acceptance criteria:** the generic `groupByCategory` helper has direct test coverage for each of its three axes (`keepEmpty`, `orphanPolicy`, `stability`) plus input-order preservation and uncategorized-suppression invariants.

**Suggested commit:** `test(grouping): add direct coverage for groupByCategory generic helper (T-2)`

---

## Commit 4 — convert `SharePage` inline grouping → `groupListItemsByCategory`

**Origin:** `REVIEW-quality.md` W-6 (Warning).

**Why:**

The inline grouping at `SharePage.tsx:90-104` is structurally identical to `groupListItemsByCategory(items, categories)` (no `prior`, since SharePage is read-only and renders once per slug-fetch). Verified equivalence:

- Same shape (`ListItemWithGear`, `Category`).
- Same key function (`i.gear_item.category_id`).
- Same `keepEmpty: false` (filters `g.items.length > 0` before push).
- Same `orphanPolicy: 'route-to-uncategorized'` (the inline `i.gear_item.category_id === null || !catMap.has(i.gear_item.category_id)` collects orphans into the uncategorized bucket).
- Same cat-sort (`[...].sort((a, b) => a.sort_order - b.sort_order)`) — the inline does it locally; the wrapper does it before delegating to the generic helper.

The only thing not shared is the `prior` stability layer, which the wrapper makes optional via the third arg.

**Files:**

- Modify: `src/lists/SharePage.tsx:89-104` — replace inline grouping with the wrapper call.

**What to do:**

Replace the entire inline grouping block:

```ts
// Group items by category, ordered by category.sort_order; uncategorized last.
const catMap = new Map(categoriesForRender.map((c) => [c.id, c]))
const sortedCats = [...categoriesForRender].sort((a, b) => a.sort_order - b.sort_order)

type Group = { category: Category | null; items: ListItemWithGear[] }
const grouped: Group[] = sortedCats
  .map((cat) => ({
    category: cat,
    items: itemsForRender.filter((i) => i.gear_item.category_id === cat.id),
  }))
  .filter((g) => g.items.length > 0)

const uncategorizedItems = itemsForRender.filter(
  (i) => i.gear_item.category_id === null || !catMap.has(i.gear_item.category_id),
)
if (uncategorizedItems.length > 0) grouped.push({ category: null, items: uncategorizedItems })
```

with one line:

```ts
const grouped = groupListItemsByCategory(itemsForRender, categoriesForRender)
```

The rest of the JSX (`grouped.map((group) => ...)`) is unchanged because `groupListItemsByCategory` already returns `CategoryGroup<ListItemWithGear>[]` — the same shape the inline `Group` type aliased.

Add the import:

```ts
import { groupListItemsByCategory } from '../lib/grouping'
```

**Verification:**

- `npm run build`, `npm run lint`, `npm test -- --run` all pass. (No new tests — the existing 11 grouping tests already lock the behavior we're delegating to.)
- Manual smoke (recommended, deferred to user): open a `/r/<slug>` page with a shared list. Categories render in `sort_order`. An item in the list with a category that's not in the categories fetch (cache drift edge case) routes to "Uncategorized" rather than disappearing.

**Acceptance criteria:** `SharePage.tsx` removes ~13 lines of inline grouping in favor of one helper call. No render-output change.

**Suggested commit:** `refactor(share-page): use groupListItemsByCategory helper (W-6)`

---

## Commit 5 — convert `LibraryPanel` inline grouping → `groupByCategory` + JSX unification

**Origin:** `REVIEW-quality.md` W-6 (Warning).

**Why:**

`LibraryPanel.tsx:64-79` is gear-shaped grouping with `keepEmpty: false` (the panel hides empty categories so the user only sees cats with results when filtering). Crucially, **none of the existing named wrappers fits this shape** (`groupGearItemsByCategory` defaults to `keepEmpty: true`). LibraryPanel must use the generic `groupByCategory` directly.

The JSX side is the second half of this commit. Today the panel iterates `groups.map(...)` and then renders an unconditional `<LibraryCategoryGroup>` for `uncategorized` if non-empty — two separate JSX branches. The unified helper returns one `CategoryGroup<GearItem>[]` array (groups with `category: Category | null` for the uncategorized tail). The JSX collapses to a single `.map`.

**Files:**

- Modify: `src/lists/LibraryPanel.tsx:64-79` — replace the inline `sortedCats`/`groups`/`uncategorized` three-`useMemo` shape with one `groupByCategory` `useMemo`.
- Modify: `src/lists/LibraryPanel.tsx` JSX (the `{groups.map(...)}` + uncategorized branch) — unify to a single `.map` over the helper output, with `category?.id ?? '__uncategorized__'` as the React key and `category?.name ?? 'Uncategorized'` as the displayed name. Use `library-cat-${category?.id ?? 'uncategorized'}` for `regionId` (preserves the existing `library-cat-uncategorized` value).

**What to do:**

### Step 1 — replace the three inline `useMemo`s

Currently:

```ts
// Build groups ordered by category sort_order
const sortedCats = useMemo(
  () => [...categories].sort((a, b) => a.sort_order - b.sort_order),
  [categories],
)
const groups = useMemo(
  () =>
    sortedCats
      .map((cat) => ({ category: cat, items: filtered.filter((g) => g.category_id === cat.id) }))
      .filter((g) => g.items.length > 0),
  [sortedCats, filtered],
)

const uncategorized = useMemo(
  () => filtered.filter((g) => g.category_id === null),
  [filtered],
)
```

Replace with one `useMemo` that does the sort + group together. The generic helper iterates categories in input order, so the sort happens at the call site (matches the previous inline `sortedCats` step).

```ts
// Build groups ordered by category sort_order. Empty categories filtered
// out (the panel hides cats with no matches when the user is searching).
// Orphan-keyed items (a gear_item.category_id pointing at a deleted
// category) are silently dropped — preserves the previous inline behavior.
// In practice the gear_items.category_id ON DELETE SET NULL FK makes this
// unreachable, but the helper documents the policy explicitly.
const groups = useMemo(
  () => {
    const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
    return groupByCategory(filtered, sortedCats, (g) => g.category_id, {
      keepEmpty: false,
      orphanPolicy: 'drop',
    })
  },
  [filtered, categories],
)
```

Add the import:

```ts
import { groupByCategory } from '../lib/grouping'
```

### Step 2 — unify the JSX

Currently:

```jsx
{groups.length === 0 && uncategorized.length === 0 ? (
  <p className="p-4 text-center text-sm text-gray-400 italic">
    {q ? 'No items found' : 'No gear items yet'}
  </p>
) : (
  <>
    {groups.map(({ category, items }) => (
      <LibraryCategoryGroup
        key={category.id}
        name={category.name}
        items={items}
        collapsed={collapsed.has(category.id)}
        toggleKey={category.id}
        onToggle={toggleCollapse}
        listItemGearIds={listItemGearIds}
        weightUnit={weightUnit}
        onAdd={onAdd}
        onRemove={onRemove}
        regionId={`library-cat-${category.id}`}
      />
    ))}
    {uncategorized.length > 0 && (
      <LibraryCategoryGroup
        name="Uncategorized"
        items={uncategorized}
        collapsed={collapsed.has('__uncategorized__')}
        toggleKey="__uncategorized__"
        onToggle={toggleCollapse}
        listItemGearIds={listItemGearIds}
        weightUnit={weightUnit}
        onAdd={onAdd}
        onRemove={onRemove}
        regionId={`library-cat-uncategorized`}
      />
    )}
  </>
)}
```

Replace with:

```jsx
{groups.length === 0 ? (
  <p className="p-4 text-center text-sm text-gray-400 italic">
    {q ? 'No items found' : 'No gear items yet'}
  </p>
) : (
  <>
    {groups.map(({ category, items }) => {
      const key = category?.id ?? '__uncategorized__'
      return (
        <LibraryCategoryGroup
          key={key}
          name={category?.name ?? 'Uncategorized'}
          items={items}
          collapsed={collapsed.has(key)}
          toggleKey={key}
          onToggle={toggleCollapse}
          listItemGearIds={listItemGearIds}
          weightUnit={weightUnit}
          onAdd={onAdd}
          onRemove={onRemove}
          regionId={`library-cat-${category?.id ?? 'uncategorized'}`}
        />
      )
    })}
  </>
)}
```

**Critical preserved behaviors:**

- The empty-state shows when there are no groups at all. Previously this was `groups.length === 0 && uncategorized.length === 0`; now `groups` is the unified array, so a single check is correct.
- The collapsed-key for the uncategorized group is still `'__uncategorized__'` (not `null`), matching the previous `toggleCollapse` keying. The `collapsed.has(key)` check at the new key is identical.
- The `regionId` for the uncategorized group is still `library-cat-uncategorized` (the substring after the dash, so we pass the literal `'uncategorized'` rather than `null`).

**Verification:**

- `npm run build` — `tsc -b` confirms `category` narrows correctly across the optional-chain (`category?.id`, `category?.name`).
- `npm run lint` and `npm test -- --run` pass.
- Manual smoke (recommended, deferred to user): open `/lists/<id>` at lg+. Library panel shows gear items grouped by category. Uncategorized items appear under "Uncategorized" only when present. Searching narrows to just the cats with matches. Collapsing and expanding the Uncategorized group via its chevron still works (state persists across the JSX restructure).

**Acceptance criteria:** `LibraryPanel.tsx` removes ~16 lines of inline grouping + one redundant JSX branch. The Uncategorized group's collapsed-state key, displayed name, and `regionId` are all unchanged.

**Suggested commit:** `refactor(library-panel): use groupByCategory helper + unify JSX over single result array (W-6)`

---

## Commit 6 — Phase 13 summary in `REVIEW-FIX.md`

**Origin:** workflow housekeeping.

**Why:**

Every prior phase has appended a structured summary to `.planning/REVIEW-FIX.md` covering Shipped commits, Audit closures, Verification results, Blockers/surprises, and Next phase candidates. Keeps the rolling ledger coherent.

**Files:**

- Modify: `.planning/REVIEW-FIX.md` — append a new `# grampacker — Phase 13 fix summary (2026-05-06)` section.

**What to do:**

Append the following structure (filled in with real commit hashes after C1–C5 land):

```markdown
---

# grampacker — Phase 13 fix summary (2026-05-06)

## Shipped

- **Commit 1 (T-2 prep) — `<hash>`** — Four new tests for `groupGearItemsByCategory` in `src/lib/grouping.test.ts`. Locks pre-refactor behavior on three axes: cat ordering (input order), keepEmpty=true, orphan policy=drop (an item with `category_id` pointing at a missing category is silently discarded). Tests pass against the unchanged helper.
- **Commit 2 (W-6) — `<hash>`** — Generic `groupByCategory<T>(items, categories, getCategoryId, options)` exported from `src/lib/grouping.ts`; iterates categories in input order (sorting is caller responsibility). Options: `keepEmpty`, `orphanPolicy: 'route-to-uncategorized' | 'drop'`, optional `stability: { prior, itemsEqual }`. Named wrappers refactored to call it: `groupListItemsByCategory` sorts internally before delegating (preserves its existing contract); `groupGearItemsByCategory` passes cats through unsorted (preserves its "caller pre-sorts" contract). Both wrapper JSDocs unchanged.
- **Commit 3 (T-2) — `<hash>`** — Nine direct tests for `groupByCategory` covering each axis: keepEmpty true vs false, orphan route vs drop, input-order preservation (helper does NOT sort internally — sort lives at the caller), uncategorized-only-when-non-empty, stability top-level reuse, stability per-group reuse with one group changed, and stability reuse of empty-cat groups when keepEmpty: true.
- **Commit 4 (W-6) — `<hash>`** — `SharePage.tsx` inline grouping replaced with `groupListItemsByCategory(itemsForRender, categoriesForRender)`. Behavior identical: keepEmpty=false, orphan→uncategorized, sort_order ordering. ~13 lines removed.
- **Commit 5 (W-6) — `<hash>`** — `LibraryPanel.tsx` inline grouping (three `useMemo`s + two JSX branches) replaced with a single `useMemo` that sorts cats inline (`[...categories].sort((a, b) => a.sort_order - b.sort_order)`) and feeds the result to `groupByCategory(filtered, sortedCats, g => g.category_id, { keepEmpty: false, orphanPolicy: 'drop' })`, plus a unified `.map` over the single result array. Uncategorized group keeps its `'__uncategorized__'` collapsed-key and `library-cat-uncategorized` regionId.

## Audit closures (no commits)

- **W-6 — closed.** All four sites now route through one parameterized helper. Documented: the orphan-policy and keepEmpty divergences across sites were preserved (gear/library drop orphans, list/share route them; gear-library keeps empty cats, the other three sites filter them).
- **T-2 — closed.** `groupGearItemsByCategory` and `groupByCategory` now have direct test coverage. The previous comment at `grouping.ts:42` ("the deliberate divergence from `groupGearItemsByCategory`") is now backed by a regression test, not just prose.

## Verification results

- `npm run build`: pass at every commit; bundle gzip baseline 187.36 KB → expected ≈ 187.32–187.40 KB after C5 (consolidation neutral; the options object adds a few bytes per call site, the inline removal saves bytes).
- `npm run lint`: pass at every commit.
- `npm test --run`: 32 → 32 + 13 new = **45 passed | 4 skipped**. (Four T-2-prep tests in C1, nine generic-helper tests in C3.)
- Manual smoke (deferred to user): open `/r/<slug>` (SharePage, C4 verification — categories render in sort_order, orphan-keyed items appear under Uncategorized) and `/lists/<id>` at lg+ (LibraryPanel, C5 verification — gear shows grouped by category, search narrows correctly, Uncategorized collapse state persists).

## Blockers / surprises

- _(filled in after execution — likely candidates: the JSX restructure in C5 has a few moving pieces that are easy to mis-key. Watch for the empty-state predicate going from `groups.length === 0 && uncategorized.length === 0` to `groups.length === 0` — these are equivalent only because the unified `groups` array now includes the uncategorized tail.)_

## Next phase

Phase 14 candidates (no clear winner — user picks):
- **M-cluster split** — UX-visible items (M-2 optimistic `updated_at` bump, M-3 ListSelector mid-flip, M-7 RootRedirect re-sort → reduce) and defensive items (M-1 production observability for failed mutations, M-5 CSV reader error/abort, M-8 gearById Map, M-10 consumable-vs-worn precedence assert). User noted the cluster splits naturally; pick one half.
- **N-5 standalone** — `csv.ts` file split into per-format modules. Mechanically larger than fits in a nit cluster.
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install (one-time tooling change).
- **F4 full path** — only if the threat model changes. SECURITY DEFINER `fetch_shared_list(p_slug)` RPC + revoke anon SELECT + four-policy reshape.

After Phase 13, `REVIEW-quality.md`'s W-side is fully closed: W-1 through W-13 all shipped or audit-stale. N-side: N-1, N-3, N-4 shipped; N-2 audit-stale; N-5 deferred; N-6 closed by Phase 11. The remaining surface is the M-cluster, T-cluster, N-5 standalone, and any further security work that depends on threat-model changes.
```

**Verification:**

- `git diff .planning/REVIEW-FIX.md` shows the new section appended.

**Acceptance criteria:** Phase 13 closeout follows the established format (Shipped / Audit closures / Verification / Blockers / Next phase), with the actual commit hashes filled in.

**Suggested commit:** `docs(review-fix): append Phase 13 summary`

---

## Audit ledger (mark each as it lands)

- **Commit 1 — `<hash>`** — T-2 prep. Four `groupGearItemsByCategory` tests in `grouping.test.ts`. Behavior locked on cat ordering, keepEmpty=true, orphan-drop.
- **Commit 2 — `<hash>`** — W-6. `groupByCategory<T>(items, categories, getCategoryId, options)` exported; iterates categories in input order (sorting is caller responsibility). Both named wrappers refactored: `groupListItemsByCategory` sorts internally before delegating (preserves its existing contract); `groupGearItemsByCategory` passes cats through (preserves its "caller pre-sorts" contract). Both JSDocs unchanged.
- **Commit 3 — `<hash>`** — T-2. Nine direct generic-helper tests in `grouping.test.ts`. Each axis (keepEmpty, orphanPolicy, stability) plus input-order preservation, uncategorized-suppression, and empty-cat stability reuse locked.
- **Commit 4 — `<hash>`** — W-6. `SharePage.tsx` inline grouping → `groupListItemsByCategory` call. ~13 lines removed.
- **Commit 5 — `<hash>`** — W-6. `LibraryPanel.tsx` three-`useMemo` inline grouping → one `groupByCategory` call + unified JSX over single result array. Uncategorized collapsed-key and regionId preserved.
- **Commit 6 — `<hash>`** — Phase 13 summary appended to REVIEW-FIX.md.

## Decisions and explicitly-deferred items

- **Preserved divergence across sites.** The audit's W-6 wording is "parameterize" — it doesn't say "converge behavior." The four sites differ on three axes for real reasons (gear library shows empty cats so the user can drag in; list view doesn't because empty sections are visual noise; orphan policy difference is theoretical given the schema's SET NULL FK but is preserved as documented contract). The unified helper exposes all three axes; each call site picks its own.
- **No JSDoc shift for either wrapper.** Both wrappers preserve their existing contracts verbatim. The generic helper iterates categories in input order; the listItems wrapper does the sort before delegating; the gear wrapper passes cats through. This avoids a public-API contract change (which Codex flagged as a real concern even though the single live `groupGearItemsByCategory` caller feeds pre-sorted output).
- **Empty uncategorized never emitted.** Even with `keepEmpty: true`, the helper does NOT emit a `{ category: null, items: [] }` row. None of the four call sites want a "Uncategorized: 0 items" row. If a future caller needs one, that's a separate `keepEmptyUncategorized` option — explicitly NOT in scope here.
- **`stability` is opt-in via a sub-object.** Required `prior` + `itemsEqual` together rather than two separate optional fields, so a caller can't accidentally pass `prior` without the comparator (which would silently never reuse anything). Slightly more verbose at the listItems wrapper call site; matches the user's instruction "preserve groupListItemsByCategory structural stability exactly".
- **No conversion of named wrappers to direct `groupByCategory` calls.** `useGroupedListItems` and `GearLibraryPage` continue calling the named wrappers. Signature preserved at both. The wrappers document intent (they're shorter to call and the name says what shape they expect); the generic `groupByCategory` is for sites that don't fit either named shape (only `LibraryPanel` today).
- **Test infrastructure unchanged.** No jsdom, no `@testing-library` install. T-2 tests are pure-function tests, fit the existing vitest setup. The component-test cluster (T-3…T-9) is explicitly out of scope; it needs the tooling install and lives in a separate phase.
- **`assignSortOrderSlots` and `listItemsArrayEqual` untouched.** Both stay where they are. `listItemsArrayEqual` remains a private helper, only consumed by `groupListItemsByCategory`'s wrapper.
- **Bundle target:** ≈ ±0.05 KB gzip after C5. The consolidation removes inline duplication but adds the options-object indirection; net should be neutral or slightly negative.
