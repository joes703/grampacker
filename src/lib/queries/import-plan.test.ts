import { describe, it, expect } from 'vitest'
import type { Category, GearItem } from '../types'
import type { ListImportRow } from '../csv'
import { DEFAULT_GEAR_STATUS } from '../gear-status'
import {
  planNewCategories,
  planGearResolution,
  buildListImportPlan,
} from './import-plan'

// Deterministic id generator: ids are predictable so plan assertions can
// reference them directly (id-1, id-2, ...). Production injects randomTempId.
function makeGenId(): () => string {
  let n = 0
  return () => `id-${++n}`
}

function makeCategory(over: Partial<Category> & { id: string; name: string }): Category {
  return {
    id: over.id,
    user_id: over.user_id ?? 'user-1',
    name: over.name,
    sort_order: over.sort_order ?? 0,
    is_default: over.is_default ?? false,
    created_at: over.created_at ?? '2026-01-01T00:00:00Z',
  }
}

function makeGearItem(
  over: Partial<GearItem> & { id: string; name: string; weight_grams: number },
): GearItem {
  return {
    id: over.id,
    user_id: over.user_id ?? 'user-1',
    category_id: over.category_id ?? null,
    name: over.name,
    description: over.description ?? null,
    weight_grams: over.weight_grams,
    cost: over.cost ?? null,
    purchase_date: over.purchase_date ?? null,
    status: over.status ?? DEFAULT_GEAR_STATUS,
    sort_order: over.sort_order ?? 0,
    created_at: over.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: over.updated_at ?? '2026-01-01T00:00:00Z',
  }
}

function makeRow(over: Partial<ListImportRow> & { name: string }): ListImportRow {
  return {
    name: over.name,
    description: over.description ?? null,
    weight_grams: over.weight_grams ?? 0,
    category: over.category ?? '',
    quantity: over.quantity ?? 1,
    is_worn: over.is_worn ?? false,
    is_consumable: over.is_consumable ?? false,
  }
}

describe('planNewCategories', () => {
  it('dedups case-insensitively and only plans categories not already present', () => {
    const existing = [makeCategory({ id: 'cat-shelter', name: 'Shelter', sort_order: 0 })]
    const rows = [
      { category: 'Shelter' }, // matches existing
      { category: 'shelter' }, // case-insensitive dup of existing
      { category: 'Cooking' }, // new
      { category: 'COOKING' }, // dup of the new one (within rows)
    ]
    const plan = planNewCategories(rows, existing, makeGenId())
    expect(plan.newCategories).toHaveLength(1)
    const [cooking] = plan.newCategories
    expect(cooking).toMatchObject({ id: 'id-1', name: 'Cooking' })
    // refByLowerName covers both existing and new
    expect(plan.refByLowerName.get('shelter')).toBe('cat-shelter')
    expect(plan.refByLowerName.get('cooking')).toBe('id-1')
  })

  it('assigns ascending sort_order past the existing max, not the existing count', () => {
    // Gappy existing sort_orders: count is 2 but max is 9.
    const existing = [
      makeCategory({ id: 'cat-a', name: 'Alpha', sort_order: 9 }),
      makeCategory({ id: 'cat-b', name: 'Beta', sort_order: 3 }),
    ]
    const rows = [{ category: 'Gamma' }, { category: 'Delta' }]
    const plan = planNewCategories(rows, existing, makeGenId())
    const sortOrders = plan.newCategories.map((c) => c.sort_order)
    expect(sortOrders).toEqual([10, 11])
  })

  it('ignores empty and whitespace-only categories', () => {
    const rows = [{ category: '' }, { category: '   ' }, { category: 'Real' }]
    const plan = planNewCategories(rows, [], makeGenId())
    expect(plan.newCategories.map((c) => c.name)).toEqual(['Real'])
  })
})

describe('planGearResolution', () => {
  it('matches existing gear by (category, NFC-lowercased name, weight)', () => {
    const refByLowerName = new Map<string, string>([['shelter', 'cat-shelter']])
    const existing = [
      makeGearItem({
        id: 'gear-tent',
        name: 'Tent',
        weight_grams: 1200,
        category_id: 'cat-shelter',
      }),
    ]
    const rows = [
      // Case + surrounding whitespace differs but resolves to the same key.
      { name: '  tent ', description: null, weight_grams: 1200, category: 'Shelter' },
    ]
    const plan = planGearResolution(rows, existing, refByLowerName, 50, makeGenId())
    expect(plan.newGear).toHaveLength(0)
    expect(plan.gearRefByRow).toEqual(['gear-tent'])
  })

  it('creates new gear from startSortOrder for unmatched rows', () => {
    const refByLowerName = new Map<string, string>([['cooking', 'cat-cooking']])
    const rows = [
      {
        name: 'Stove',
        description: 'Canister stove',
        weight_grams: 90,
        category: 'Cooking',
        cost: 45,
        purchase_date: '2026-01-02',
      },
      { name: 'Pot', description: null, weight_grams: 150, category: 'Cooking' },
    ]
    const plan = planGearResolution(rows, [], refByLowerName, 50, makeGenId())
    expect(plan.newGear).toHaveLength(2)
    const [stove, pot] = plan.newGear
    expect(stove).toMatchObject({
      id: 'id-1',
      name: 'Stove',
      description: 'Canister stove',
      weight_grams: 90,
      category_id: 'cat-cooking',
      cost: 45,
      purchase_date: '2026-01-02',
      status: DEFAULT_GEAR_STATUS,
      sort_order: 50,
    })
    expect(pot).toMatchObject({ id: 'id-2', name: 'Pot', sort_order: 51 })
    expect(plan.gearRefByRow).toEqual(['id-1', 'id-2'])
  })

  it('treats within-CSV duplicates as separate new gear', () => {
    const rows = [
      { name: 'Spork', description: null, weight_grams: 10, category: '' },
      { name: 'Spork', description: null, weight_grams: 10, category: '' },
    ]
    const plan = planGearResolution(rows, [], new Map(), 0, makeGenId())
    expect(plan.newGear).toHaveLength(2)
    expect(plan.gearRefByRow).toEqual(['id-1', 'id-2'])
    expect(plan.newGear.map((g) => g.sort_order)).toEqual([0, 1])
  })

  it('produces no gear for empty-name rows and resolves unknown categories to null', () => {
    const rows = [
      { name: '   ', description: null, weight_grams: 10, category: 'Cooking' },
      { name: 'Map', description: null, weight_grams: 30, category: 'Nonexistent' },
    ]
    const plan = planGearResolution(rows, [], new Map(), 0, makeGenId())
    expect(plan.gearRefByRow[0]).toBeNull()
    expect(plan.newGear).toHaveLength(1)
    const [map] = plan.newGear
    expect(map).toMatchObject({ name: 'Map', category_id: null, sort_order: 0 })
    expect(plan.gearRefByRow[1]).toBe('id-1')
  })
})

describe('buildListImportPlan', () => {
  it('composes categories + gear + list_items with sort_order = original index', () => {
    const existingCategories = [
      makeCategory({ id: 'cat-shelter', name: 'Shelter', sort_order: 5 }),
    ]
    const existingGearItems = [
      makeGearItem({
        id: 'gear-tent',
        name: 'Tent',
        weight_grams: 1200,
        category_id: 'cat-shelter',
        sort_order: 7,
      }),
    ]
    const rows: ListImportRow[] = [
      // 0: matches existing gear in existing category
      makeRow({ name: 'Tent', weight_grams: 1200, category: 'Shelter', quantity: 1 }),
      // 1: empty name -> dropped, leaves a gap in list_item sort_order
      makeRow({ name: '', category: 'Shelter' }),
      // 2: new gear in a new category
      makeRow({
        name: 'Stove',
        weight_grams: 90,
        category: 'Cooking',
        quantity: 2,
        is_consumable: true,
      }),
      // 3: new gear in the same new category
      makeRow({ name: 'Pot', weight_grams: 150, category: 'cooking', is_worn: true }),
    ]
    const plan = buildListImportPlan(rows, existingGearItems, existingCategories, makeGenId())

    // One new category (Cooking), sort_order past the existing max (5 -> 6).
    expect(plan.newCategories).toHaveLength(1)
    const [cooking] = plan.newCategories
    expect(cooking).toMatchObject({ name: 'Cooking', sort_order: 6 })

    // Two new gear (Stove, Pot); start = nextGearItemSortOrder(existing) = max(7)+1 = 8.
    expect(plan.newGear.map((g) => g.name)).toEqual(['Stove', 'Pot'])
    expect(plan.newGear.map((g) => g.sort_order)).toEqual([8, 9])
    // Both new gear live in the new Cooking category.
    expect(new Set(plan.newGear.map((g) => g.category_id))).toEqual(new Set([cooking?.id]))

    // list_items: row 1 (empty) dropped; sort_order preserves original index.
    expect(plan.listItems).toHaveLength(3)
    expect(plan.listItems.map((li) => li.sort_order)).toEqual([0, 2, 3])
    // row 0 references the matched existing gear
    expect(plan.listItems[0]).toMatchObject({
      gear_item_id: 'gear-tent',
      quantity: 1,
      sort_order: 0,
    })
    // row 2 (Stove) carries its per-list fields
    expect(plan.listItems[1]).toMatchObject({
      quantity: 2,
      is_consumable: true,
      is_worn: false,
      sort_order: 2,
    })
    // row 3 (Pot) is_worn carried through
    expect(plan.listItems[2]).toMatchObject({ is_worn: true, sort_order: 3 })
    // gear ids on the surviving list_items match planned new gear
    const newGearIds = new Set(plan.newGear.map((g) => g.id))
    expect(newGearIds.has(plan.listItems[1]?.gear_item_id ?? '')).toBe(true)
    expect(newGearIds.has(plan.listItems[2]?.gear_item_id ?? '')).toBe(true)
  })

  it('starts gear sort_order at nextGearItemSortOrder of existing (gappy)', () => {
    const existingGearItems = [
      makeGearItem({ id: 'g1', name: 'A', weight_grams: 1, sort_order: 20 }),
      makeGearItem({ id: 'g2', name: 'B', weight_grams: 2, sort_order: 4 }),
    ]
    const rows: ListImportRow[] = [makeRow({ name: 'New', weight_grams: 5, category: '' })]
    const plan = buildListImportPlan(rows, existingGearItems, [], makeGenId())
    expect(plan.newGear).toHaveLength(1)
    expect(plan.newGear[0]?.sort_order).toBe(21)
  })
})
