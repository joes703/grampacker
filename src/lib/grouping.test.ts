import { describe, it, expect } from 'vitest'
import { groupGearItemsByCategory, groupByCategory } from './grouping'
import type { Category, GearItem } from './types'

// TRANSPLANT NOTE (phase 3): the old repo's suite also covered
// groupListItemsByCategory (the list-view wrapper with its stability
// comparator regressions); those tests return with the lists slice. The
// generic groupByCategory stability tests below keep that machinery
// covered in the meantime.

const shelter: Category = {
  id: 'cat-shelter',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2024-01-01',
}
const sleep: Category = {
  id: 'cat-sleep',
  name: 'Sleep',
  sortOrder: 1,
  createdAt: '2024-01-01',
}

function gearItem(overrides: {
  id: string
  categoryId: string | null
  weightGrams?: number
  name?: string
}): GearItem {
  return {
    id: overrides.id,
    name: overrides.name ?? `gear-${overrides.id}`,
    description: null,
    weightGrams: overrides.weightGrams ?? 100,
    categoryId: overrides.categoryId,
    cost: null,
    purchaseDate: null,
    status: 'active',
    sortOrder: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  }
}

describe('groupGearItemsByCategory', () => {
  it('groups items by category in input order; uncategorized last', () => {
    const items = [
      gearItem({ id: 'a', categoryId: 'cat-sleep' }),
      gearItem({ id: 'b', categoryId: 'cat-shelter' }),
      gearItem({ id: 'c', categoryId: null }),
    ]
    // Caller pre-sorts categories — the helper iterates in INPUT order,
    // not sortOrder. Pass cats in REVERSE sortOrder so this test would
    // fail if the wrapper ever started sorting internally. (sleep has
    // sortOrder: 1, shelter has sortOrder: 0; passing [sleep, shelter]
    // means input-order output is [sleep, shelter, uncategorized] —
    // explicitly NOT sortOrder order.)
    const result = groupGearItemsByCategory(items, [sleep, shelter])
    expect(result).toHaveLength(3)
    expect(result[0]!.category?.id).toBe('cat-sleep')
    expect(result[1]!.category?.id).toBe('cat-shelter')
    expect(result[2]!.category).toBeNull()
  })

  // The deliberate divergence from groupListItemsByCategory: the gear
  // library renders empty cat sections so the user can drag items in.
  // Passes cats in reverse sortOrder to keep this test honest about
  // input-order iteration too.
  it('retains empty categories', () => {
    const items = [gearItem({ id: 'a', categoryId: 'cat-shelter' })]
    const result = groupGearItemsByCategory(items, [sleep, shelter])
    expect(result).toHaveLength(2)
    expect(result[0]!.category?.id).toBe('cat-sleep')
    expect(result[0]!.items).toHaveLength(0)
    expect(result[1]!.category?.id).toBe('cat-shelter')
    expect(result[1]!.items).toHaveLength(1)
  })

  it('only emits the uncategorized group when at least one item lacks a category', () => {
    const items = [gearItem({ id: 'a', categoryId: 'cat-shelter' })]
    const result = groupGearItemsByCategory(items, [shelter])
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
  })

  // Locked behavior — schema's ON DELETE SET NULL makes orphans
  // unreachable in practice, but the helper's documented contract is
  // "drop silently" and the parameterized refactor must preserve it.
  // Switching to "route to uncategorized" would be a behavior change.
  it('drops items whose categoryId points at a missing category (locked divergence)', () => {
    const items = [
      gearItem({ id: 'a', categoryId: 'cat-shelter' }),
      gearItem({ id: 'b', categoryId: 'cat-deleted' }),
    ]
    const result = groupGearItemsByCategory(items, [shelter])
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
    expect(result[0]!.items).toHaveLength(1)
    expect(result[0]!.items[0]!.id).toBe('a')
    // Item 'b' is gone from the output.
  })
})

describe('groupByCategory (generic)', () => {
  type Item = { id: string; categoryId: string | null }
  const getKey = (i: Item) => i.categoryId

  it('keepEmpty: true retains categories with no items', () => {
    const items: Item[] = [{ id: '1', categoryId: 'cat-shelter' }]
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
    const items: Item[] = [{ id: '1', categoryId: 'cat-shelter' }]
    const result = groupByCategory(items, [shelter, sleep], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
  })

  it('orphanPolicy: route routes orphan-keyed items to uncategorized', () => {
    const items: Item[] = [
      { id: '1', categoryId: 'cat-shelter' },
      { id: '2', categoryId: 'cat-deleted' },
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
      { id: '1', categoryId: 'cat-shelter' },
      { id: '2', categoryId: 'cat-deleted' },
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
      { id: '1', categoryId: 'cat-sleep' },
      { id: '2', categoryId: 'cat-shelter' },
    ]
    // Pass cats in REVERSE sortOrder; helper must NOT reorder them.
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
    // Negative branch: no item has categoryId: null → no uncategorized
    // group emitted, even with keepEmpty: true.
    const withoutNull = groupByCategory(
      [{ id: '1', categoryId: 'cat-shelter' }] as Item[],
      [shelter, sleep],
      getKey,
      { keepEmpty: true, orphanPolicy: 'drop' },
    )
    expect(withoutNull).toHaveLength(2)
    expect(withoutNull.find((g) => g.category === null)).toBeUndefined()

    // Positive branch: at least one item has categoryId: null →
    // uncategorized group IS emitted, and appears LAST. Without this
    // half, a regression where the helper's `raw === null` bucketing
    // branch broke under orphanPolicy: 'drop' would still pass C3.
    const withNull = groupByCategory(
      [
        { id: '1', categoryId: 'cat-shelter' },
        { id: '2', categoryId: null },
      ] as Item[],
      [shelter, sleep],
      getKey,
      { keepEmpty: true, orphanPolicy: 'drop' },
    )
    expect(withNull).toHaveLength(3)
    const last = withNull.at(-1)!
    expect(last.category).toBeNull()
    expect(last.items).toHaveLength(1)
    expect(last.items[0]!.id).toBe('2')
  })

  it('stability: returns prior top-level reference when nothing changed', () => {
    const items: Item[] = [{ id: '1', categoryId: 'cat-shelter' }]
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
      { id: '1', categoryId: 'cat-shelter' },
      { id: '2', categoryId: 'cat-sleep' },
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
      { id: '3', categoryId: 'cat-shelter' },
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
    const items: Item[] = [{ id: '1', categoryId: 'cat-shelter' }]
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
