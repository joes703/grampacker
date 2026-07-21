import { describe, it, expect } from 'vitest'
import {
  groupBy,
  groupListItemsByCategory,
  groupListItemsByLocation,
  groupGearItemsByCategory,
  groupByCategory,
  assignSortOrderSlots,
} from './grouping'
import type { Category, GearItem, GearStatus, ListItemWithGear } from './types'
import type { PackingLocation } from './types'

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

const mainPack: PackingLocation = { id: 'loc-main', name: 'Main pack', sortOrder: 0 }
const hipBelt: PackingLocation = { id: 'loc-hip', name: 'Hip belt', sortOrder: 1 }

function listItem(overrides: {
  id: string
  categoryId: string | null
  weightGrams?: number
  quantity?: number
  isWorn?: boolean
  isConsumable?: boolean
  isPacked?: boolean
  isReady?: boolean
  packingLocationId?: string | null
  sortOrder?: number
  name?: string
  description?: string | null
  status?: GearStatus
}): ListItemWithGear {
  return {
    id: overrides.id,
    listId: 'l-1',
    gearItemId: `g-${overrides.id}`,
    quantity: overrides.quantity ?? 1,
    isWorn: overrides.isWorn ?? false,
    isConsumable: overrides.isConsumable ?? false,
    isPacked: overrides.isPacked ?? false,
    isReady: overrides.isReady ?? false,
    packingLocationId: overrides.packingLocationId ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    gearItem: {
      id: `g-${overrides.id}`,
      name: overrides.name ?? `gear-${overrides.id}`,
      description: overrides.description ?? null,
      weightGrams: overrides.weightGrams ?? 100,
      categoryId: overrides.categoryId,
      cost: null,
      purchaseDate: null,
      status: overrides.status ?? 'active',
      sortOrder: 0,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    },
  }
}

describe('groupListItemsByCategory', () => {
  it('groups items by category in sortOrder; uncategorized last', () => {
    const items = [
      listItem({ id: 'a', categoryId: 'cat-sleep' }),
      listItem({ id: 'b', categoryId: 'cat-shelter' }),
      listItem({ id: 'c', categoryId: null }),
    ]
    const result = groupListItemsByCategory(items, [sleep, shelter])
    expect(result).toHaveLength(3)
    expect(result[0]!.category?.id).toBe('cat-shelter')
    expect(result[1]!.category?.id).toBe('cat-sleep')
    expect(result[2]!.category).toBeNull()
  })

  it('filters out empty categories', () => {
    const items = [listItem({ id: 'a', categoryId: 'cat-shelter' })]
    const result = groupListItemsByCategory(items, [shelter, sleep])
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
  })

  it('routes orphan categoryId to uncategorized', () => {
    const items = [listItem({ id: 'a', categoryId: 'cat-deleted' })]
    const result = groupListItemsByCategory(items, [shelter])
    expect(result).toHaveLength(1)
    expect(result[0]!.category).toBeNull()
  })

  // Load-bearing for useGroupedListItems' loop guard.
  it('returns the prior top-level array reference when nothing changed', () => {
    const items = [
      listItem({ id: 'a', categoryId: 'cat-shelter' }),
      listItem({ id: 'b', categoryId: 'cat-sleep' }),
    ]
    const cats = [shelter, sleep]
    const first = groupListItemsByCategory(items, cats)
    const second = groupListItemsByCategory(items, cats, first)
    expect(second).toBe(first)
  })

  it('reuses prior group + items references when only one category changed', () => {
    const items1 = [
      listItem({ id: 'a', categoryId: 'cat-shelter' }),
      listItem({ id: 'b', categoryId: 'cat-sleep' }),
    ]
    const cats = [shelter, sleep]
    const first = groupListItemsByCategory(items1, cats)

    // Toggle isPacked on the shelter item — fresh list_item objects, fresh
    // top-level array (simulates an optimistic update).
    const items2 = [
      { ...items1[0]!, isPacked: true },
      items1[1]!,
    ]
    const second = groupListItemsByCategory(items2, cats, first)

    expect(second).not.toBe(first) // top-level changed (one group changed)
    expect(second[0]!.items).not.toBe(first[0]!.items) // shelter group's items changed
    expect(second[1]!).toBe(first[1]!) // sleep group reused (group object AND items array)
    expect(second[1]!.items).toBe(first[1]!.items)
  })

  it('reuses prior items array when only an unrelated field on the item object changed', () => {
    const items1 = [listItem({ id: 'a', categoryId: 'cat-shelter' })]
    const first = groupListItemsByCategory(items1, [shelter])

    // Same render-affecting fields, fresh object reference (simulates a
    // refetch that returns equivalent data).
    const items2 = [{ ...items1[0]!, updatedAt: '2024-01-02' }]
    const second = groupListItemsByCategory(items2, [shelter], first)

    expect(second).toBe(first) // top-level reused
    expect(second[0]!.items).toBe(first[0]!.items) // items array reused
  })

  it('rebuilds when gearItem.description changes (regression: must be in comparator)', () => {
    const items1 = [listItem({ id: 'a', categoryId: 'cat-shelter', description: 'old' })]
    const first = groupListItemsByCategory(items1, [shelter])

    const items2 = [listItem({ id: 'a', categoryId: 'cat-shelter', description: 'new' })]
    const second = groupListItemsByCategory(items2, [shelter], first)

    expect(second).not.toBe(first)
    expect(second[0]!.items).not.toBe(first[0]!.items)
    expect(second[0]!.items[0]!.gearItem.description).toBe('new')
  })

  it('rebuilds when gearItem.name changes', () => {
    const items1 = [listItem({ id: 'a', categoryId: 'cat-shelter', name: 'old name' })]
    const first = groupListItemsByCategory(items1, [shelter])

    const items2 = [listItem({ id: 'a', categoryId: 'cat-shelter', name: 'new name' })]
    const second = groupListItemsByCategory(items2, [shelter], first)

    expect(second).not.toBe(first)
    expect(second[0]!.items).not.toBe(first[0]!.items)
  })

  it('rebuilds when gearItem.status changes (regression: ItemRow renders GearStatusBadge from status)', () => {
    // Regression: listItemsArrayEqual previously omitted gearItem.status
    // even though status is in GEAR_ITEM_AUTH_SELECT and rendered by
    // GearStatusBadge on every ItemRow. A status-only fanout update from
    // the gear closet would leave the badge visually stuck until another
    // invalidation hit the cache.
    const items1 = [listItem({ id: 'a', categoryId: 'cat-shelter', status: 'active' })]
    const first = groupListItemsByCategory(items1, [shelter])

    const items2 = [listItem({ id: 'a', categoryId: 'cat-shelter', status: 'need_to_buy' })]
    const second = groupListItemsByCategory(items2, [shelter], first)

    expect(second).not.toBe(first)
    expect(second[0]!.items).not.toBe(first[0]!.items)
    expect(second[0]!.items[0]!.gearItem.status).toBe('need_to_buy')
  })

  it('rebuilds when only packingLocationId changes', () => {
    const items1 = [listItem({ id: 'a', categoryId: 'cat-shelter', packingLocationId: null })]
    const first = groupListItemsByCategory(items1, [shelter])

    const items2 = [
      listItem({ id: 'a', categoryId: 'cat-shelter', packingLocationId: mainPack.id }),
    ]
    const second = groupListItemsByCategory(items2, [shelter], first)

    expect(second).not.toBe(first)
    expect(second[0]!.items).not.toBe(first[0]!.items)
  })
})

describe('groupListItemsByLocation', () => {
  it('sorts locations, retains empty locations, and emits Unassigned last', () => {
    const items = [
      listItem({ id: 'a', categoryId: 'cat-shelter', packingLocationId: hipBelt.id }),
      listItem({ id: 'b', categoryId: 'cat-sleep', packingLocationId: null }),
    ]

    const result = groupListItemsByLocation(items, [hipBelt, mainPack])

    expect(result.map((group) => group.location?.id ?? null)).toEqual([
      mainPack.id,
      hipBelt.id,
      null,
    ])
    expect(result[0]!.items).toEqual([])
    expect(result[1]!.items.map((item) => item.id)).toEqual(['a'])
    expect(result[2]!.items.map((item) => item.id)).toEqual(['b'])
  })

  it('routes a missing location reference to Unassigned', () => {
    const item = listItem({
      id: 'a',
      categoryId: 'cat-shelter',
      packingLocationId: 'loc-deleted',
    })

    const result = groupListItemsByLocation([item], [mainPack])

    expect(result.at(-1)?.location).toBeNull()
    expect(result.at(-1)?.items).toEqual([item])
  })

  it('reuses the prior result when locations and items are unchanged', () => {
    const items = [
      listItem({ id: 'a', categoryId: 'cat-shelter', packingLocationId: mainPack.id }),
    ]
    const first = groupListItemsByLocation(items, [mainPack, hipBelt])
    const second = groupListItemsByLocation(items, [mainPack, hipBelt], first)

    expect(second).toBe(first)
  })
})

describe('groupBy (generic group definitions)', () => {
  it('groups definitions that are not categories', () => {
    type Definition = { id: string; label: string }
    type Item = { id: string; definitionId: string | null }
    const definitions: Definition[] = [
      { id: 'one', label: 'One' },
      { id: 'two', label: 'Two' },
    ]
    const items: Item[] = [
      { id: 'a', definitionId: 'two' },
      { id: 'b', definitionId: null },
    ]

    const result = groupBy(items, definitions, (item) => item.definitionId, {
      keepEmpty: true,
      orphanPolicy: 'route-to-ungrouped',
    })

    expect(result.map((entry) => entry.group?.id ?? null)).toEqual(['one', 'two', null])
  })
})

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

// assignSortOrderSlots redistributes EXISTING sortOrder slot values among
// a re-ordered subset of items. It does NOT renumber to 0..N-1; it sorts
// the input items' existing sortOrder values ascending and pairs each
// slot, in order, with the corresponding input item in input order. This
// is what lets a within-category reorder persist new positions without
// renumbering items that weren't part of the drag.
describe('assignSortOrderSlots', () => {
  it('redistributes existing slots ascending across reversed input', () => {
    const result = assignSortOrderSlots([
      { id: 'a', sortOrder: 30 },
      { id: 'b', sortOrder: 10 },
      { id: 'c', sortOrder: 20 },
    ])
    expect(result).toEqual([
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 20 },
      { id: 'c', sortOrder: 30 },
    ])
  })

  it('preserves id↔slot pairing when input order already matches sorted slots', () => {
    const result = assignSortOrderSlots([
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 20 },
      { id: 'c', sortOrder: 30 },
    ])
    expect(result).toEqual([
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 20 },
      { id: 'c', sortOrder: 30 },
    ])
  })

  it('preserves non-contiguous slot values rather than renumbering to 0..N-1', () => {
    const result = assignSortOrderSlots([
      { id: 'a', sortOrder: 1000 },
      { id: 'b', sortOrder: 500 },
    ])
    expect(result).toEqual([
      { id: 'a', sortOrder: 500 },
      { id: 'b', sortOrder: 1000 },
    ])
  })

  it('returns empty array for empty input', () => {
    expect(assignSortOrderSlots([])).toEqual([])
  })

  it('returns single item unchanged when input has one element', () => {
    expect(
      assignSortOrderSlots([{ id: 'a', sortOrder: 42 }]),
    ).toEqual([{ id: 'a', sortOrder: 42 }])
  })

  it('drops fields beyond id and sortOrder from the return shape', () => {
    const result = assignSortOrderSlots([
      { id: 'a', sortOrder: 10, name: 'Alpha', extra: 'kept-on-input' },
      { id: 'b', sortOrder: 5, name: 'Beta', extra: 'also-on-input' },
    ])
    expect(result).toEqual([
      { id: 'a', sortOrder: 5 },
      { id: 'b', sortOrder: 10 },
    ])
    // Stronger: confirm the extras are not on the output objects.
    expect(result[0]).not.toHaveProperty('name')
    expect(result[0]).not.toHaveProperty('extra')
  })
})
