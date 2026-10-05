import { describe, it, expect } from 'vitest'
import {
  groupBy,
  groupListItemsByCategory,
  groupGearItemsByCategory,
  groupByCategory,
  listItemsArrayEqual,
  assignSortOrderSlots,
  type Group,
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

const mainPack: PackingLocation = {
  id: 'loc-main', name: 'Main pack', sortOrder: 0, containerListItemId: null,
}

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
    packSortOrder: overrides.sortOrder ?? 0,
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
})

// The stability layer - reuse a prior group when its items are structurally
// unchanged, and the prior TOP-LEVEL array when every group was reused - has
// one live caller: useGroupedListItems, which reaches it through `groupBy`
// with exactly the options below (use-grouped-list-items.ts, buildGroups).
// The table below drives that path. Top-level identity (load-bearing for the
// hook's setState-during-render loop guard), per-group reuse and the
// keepEmpty + stability combination are proven through the hook itself, in
// use-grouped-list-items.test.tsx.
describe('groupBy stability (the useGroupedListItems path)', () => {
  function stableListGroups(
    items: ListItemWithGear[],
    cats: Category[],
    prior?: Group<Category, ListItemWithGear>[],
  ) {
    return groupBy(items, cats, (item) => item.gearItem.categoryId, {
      keepEmpty: false,
      orphanPolicy: 'route-to-ungrouped',
      stability: prior ? { prior, itemsEqual: listItemsArrayEqual } : undefined,
    })
  }

  // One row per field listItemsArrayEqual compares. Each field is rendered
  // (or orders a section), so a field missing from the comparator lets a
  // render reuse the old group and show stale data until an unrelated change.
  // gearItem.status is an example: GearStatusBadge on every ItemRow reads it,
  // and a status-only update from the gear closet would leave the badge stuck.
  // packingLocationId matters here because under CATEGORY grouping it does
  // not move the item to another group.
  const base = listItem({ id: 'a', categoryId: 'cat-shelter' })
  it.each<[string, (item: ListItemWithGear) => ListItemWithGear]>([
    ['id', (i) => ({ ...i, id: 'b' })],
    ['sortOrder', (i) => ({ ...i, sortOrder: i.sortOrder + 1 })],
    ['packSortOrder', (i) => ({ ...i, packSortOrder: i.packSortOrder + 1 })],
    ['quantity', (i) => ({ ...i, quantity: i.quantity + 1 })],
    ['isPacked', (i) => ({ ...i, isPacked: !i.isPacked })],
    ['isReady', (i) => ({ ...i, isReady: !i.isReady })],
    ['isWorn', (i) => ({ ...i, isWorn: !i.isWorn })],
    ['isConsumable', (i) => ({ ...i, isConsumable: !i.isConsumable })],
    ['packingLocationId', (i) => ({ ...i, packingLocationId: mainPack.id })],
    ['gearItem.id', (i) => ({ ...i, gearItem: { ...i.gearItem, id: 'g-other' } })],
    ['gearItem.weightGrams', (i) => ({ ...i, gearItem: { ...i.gearItem, weightGrams: i.gearItem.weightGrams + 1 } })],
    ['gearItem.name', (i) => ({ ...i, gearItem: { ...i.gearItem, name: 'new name' } })],
    ['gearItem.description', (i) => ({ ...i, gearItem: { ...i.gearItem, description: 'new' } })],
    ['gearItem.status', (i) => ({ ...i, gearItem: { ...i.gearItem, status: 'need_to_buy' } })],
  ])('rebuilds when only %s changes', (_field, change) => {
    const first = stableListGroups([base], [shelter])

    const changed = change(base)
    const second = stableListGroups([changed], [shelter], first)

    expect(second).not.toBe(first)
    expect(second[0]!.items).not.toBe(first[0]!.items)
    expect(second[0]!.items[0]).toBe(changed)
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

// LibraryPanel calls groupByCategory directly with keepEmpty: false and
// orphanPolicy: 'drop', a combination neither named wrapper uses. The two
// options are independent: conflating them would make the panel show empty
// categories while both wrappers stay correct.
describe('groupByCategory (generic)', () => {
  type Item = { id: string; categoryId: string | null }
  const getKey = (i: Item) => i.categoryId

  it('keepEmpty: false drops categories with no items', () => {
    const items: Item[] = [{ id: '1', categoryId: 'cat-shelter' }]
    const result = groupByCategory(items, [shelter, sleep], getKey, {
      keepEmpty: false,
      orphanPolicy: 'drop',
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
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
    // Slots are sorted as NUMBERS and kept as they are, never renumbered.
    // A comparator-less .sort() orders 100 before 20 and 9.
    expect(assignSortOrderSlots([
      { id: 'a', sortOrder: 100 },
      { id: 'b', sortOrder: 9 },
      { id: 'c', sortOrder: 20 },
    ])).toEqual([
      { id: 'a', sortOrder: 9 },
      { id: 'b', sortOrder: 20 },
      { id: 'c', sortOrder: 100 },
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
