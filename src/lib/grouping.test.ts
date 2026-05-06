import { describe, it, expect } from 'vitest'
import { groupListItemsByCategory, groupGearItemsByCategory } from './grouping'
import type { Category, GearItem, ListItemWithGear } from './types'

function listItem(overrides: {
  id: string
  category_id: string | null
  weight_grams?: number
  quantity?: number
  is_worn?: boolean
  is_consumable?: boolean
  is_packed?: boolean
  sort_order?: number
  name?: string
  description?: string | null
}): ListItemWithGear {
  return {
    id: overrides.id,
    list_id: 'l-1',
    user_id: 'u',
    gear_item_id: `g-${overrides.id}`,
    quantity: overrides.quantity ?? 1,
    is_worn: overrides.is_worn ?? false,
    is_consumable: overrides.is_consumable ?? false,
    is_packed: overrides.is_packed ?? false,
    sort_order: overrides.sort_order ?? 0,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    gear_item: {
      id: `g-${overrides.id}`,
      name: overrides.name ?? `gear-${overrides.id}`,
      description: overrides.description ?? null,
      weight_grams: overrides.weight_grams ?? 100,
      category_id: overrides.category_id,
    },
  }
}

const shelter: Category = {
  id: 'cat-shelter',
  user_id: 'u',
  name: 'Shelter',
  sort_order: 0,
  is_default: true,
  created_at: '2024-01-01',
}
const sleep: Category = {
  id: 'cat-sleep',
  user_id: 'u',
  name: 'Sleep',
  sort_order: 1,
  is_default: true,
  created_at: '2024-01-01',
}

describe('groupListItemsByCategory', () => {
  it('groups items by category in sort_order; uncategorized last', () => {
    const items = [
      listItem({ id: 'a', category_id: 'cat-sleep' }),
      listItem({ id: 'b', category_id: 'cat-shelter' }),
      listItem({ id: 'c', category_id: null }),
    ]
    const result = groupListItemsByCategory(items, [sleep, shelter])
    expect(result).toHaveLength(3)
    expect(result[0]!.category?.id).toBe('cat-shelter')
    expect(result[1]!.category?.id).toBe('cat-sleep')
    expect(result[2]!.category).toBeNull()
  })

  it('filters out empty categories', () => {
    const items = [listItem({ id: 'a', category_id: 'cat-shelter' })]
    const result = groupListItemsByCategory(items, [shelter, sleep])
    expect(result).toHaveLength(1)
    expect(result[0]!.category?.id).toBe('cat-shelter')
  })

  it('routes orphan category_id to uncategorized', () => {
    const items = [listItem({ id: 'a', category_id: 'cat-deleted' })]
    const result = groupListItemsByCategory(items, [shelter])
    expect(result).toHaveLength(1)
    expect(result[0]!.category).toBeNull()
  })

  // Load-bearing for useGroupedListItems' loop guard.
  it('returns the prior top-level array reference when nothing changed', () => {
    const items = [
      listItem({ id: 'a', category_id: 'cat-shelter' }),
      listItem({ id: 'b', category_id: 'cat-sleep' }),
    ]
    const cats = [shelter, sleep]
    const first = groupListItemsByCategory(items, cats)
    const second = groupListItemsByCategory(items, cats, first)
    expect(second).toBe(first)
  })

  it('reuses prior group + items references when only one category changed', () => {
    const items1 = [
      listItem({ id: 'a', category_id: 'cat-shelter' }),
      listItem({ id: 'b', category_id: 'cat-sleep' }),
    ]
    const cats = [shelter, sleep]
    const first = groupListItemsByCategory(items1, cats)

    // Toggle is_packed on the shelter item — fresh list_item objects, fresh
    // top-level array (simulates an optimistic update).
    const items2 = [
      { ...items1[0]!, is_packed: true },
      items1[1]!,
    ]
    const second = groupListItemsByCategory(items2, cats, first)

    expect(second).not.toBe(first) // top-level changed (one group changed)
    expect(second[0]!.items).not.toBe(first[0]!.items) // shelter group's items changed
    expect(second[1]!).toBe(first[1]!) // sleep group reused (group object AND items array)
    expect(second[1]!.items).toBe(first[1]!.items)
  })

  it('reuses prior items array when only an unrelated field on the item object changed', () => {
    const items1 = [listItem({ id: 'a', category_id: 'cat-shelter' })]
    const first = groupListItemsByCategory(items1, [shelter])

    // Same render-affecting fields, fresh object reference (simulates a
    // refetch that returns equivalent data).
    const items2 = [{ ...items1[0]!, updated_at: '2024-01-02' }]
    const second = groupListItemsByCategory(items2, [shelter], first)

    expect(second).toBe(first) // top-level reused
    expect(second[0]!.items).toBe(first[0]!.items) // items array reused
  })

  it('rebuilds when gear_item.description changes (regression: must be in comparator)', () => {
    const items1 = [listItem({ id: 'a', category_id: 'cat-shelter', description: 'old' })]
    const first = groupListItemsByCategory(items1, [shelter])

    const items2 = [listItem({ id: 'a', category_id: 'cat-shelter', description: 'new' })]
    const second = groupListItemsByCategory(items2, [shelter], first)

    expect(second).not.toBe(first)
    expect(second[0]!.items).not.toBe(first[0]!.items)
    expect(second[0]!.items[0]!.gear_item.description).toBe('new')
  })

  it('rebuilds when gear_item.name changes', () => {
    const items1 = [listItem({ id: 'a', category_id: 'cat-shelter', name: 'old name' })]
    const first = groupListItemsByCategory(items1, [shelter])

    const items2 = [listItem({ id: 'a', category_id: 'cat-shelter', name: 'new name' })]
    const second = groupListItemsByCategory(items2, [shelter], first)

    expect(second).not.toBe(first)
    expect(second[0]!.items).not.toBe(first[0]!.items)
  })
})

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
