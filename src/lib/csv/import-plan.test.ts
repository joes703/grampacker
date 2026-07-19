import { describe, it, expect } from 'vitest'
import type { Category, GearItem } from '../types'
import type { GearCsvRow } from './gear'
import type { ListCsvRow } from './list'
import { GEAR_ITEM_CAP, LIST_ITEM_CAP } from '../caps'
import {
  planNewCategories,
  planGearResolution,
  planGearImport,
  planListImport,
  assertListImportWithinCaps,
  type CategoryRef,
} from './import-plan'

// Deterministic id generator: tempIds are predictable so plan assertions can
// reference them directly (id-1, id-2, ...). Production defaults to
// randomTempId.
function makeGenId(): () => string {
  let n = 0
  return () => `id-${++n}`
}

function makeCategory(over: Partial<Category> & { id: string; name: string }): Category {
  return {
    id: over.id,
    name: over.name,
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
  }
}

function makeGearItem(
  over: Partial<GearItem> & { id: string; name: string; weightGrams: number },
): GearItem {
  return {
    id: over.id,
    categoryId: over.categoryId ?? null,
    name: over.name,
    description: over.description ?? null,
    weightGrams: over.weightGrams,
    cost: over.cost ?? null,
    purchaseDate: over.purchaseDate ?? null,
    status: over.status ?? 'active',
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: over.updatedAt ?? '2026-01-01T00:00:00Z',
  }
}

function makeRow(over: Partial<GearCsvRow> & { name: string }): GearCsvRow {
  return {
    name: over.name,
    description: over.description ?? null,
    weightGrams: over.weightGrams ?? 0,
    categoryName: over.categoryName ?? '',
    cost: over.cost ?? null,
    purchaseDate: over.purchaseDate ?? null,
  }
}

describe('planNewCategories', () => {
  it('dedups case-insensitively against existing and within-CSV, minting a tempId', () => {
    const existing = [makeCategory({ id: 'cat-shelter', name: 'Shelter' })]
    const rows = [
      { categoryName: 'Shelter' }, // matches existing
      { categoryName: 'shelter' }, // case-insensitive dup of existing
      { categoryName: 'Cooking' }, // new
      { categoryName: 'COOKING' }, // dup of the new one (within rows)
    ]
    const plan = planNewCategories(rows, existing, makeGenId())
    expect(plan.newCategories).toEqual([{ tempId: 'id-1', name: 'Cooking' }])
    // refByLowerName covers both existing and new
    expect(plan.refByLowerName.get('shelter')).toEqual({ kind: 'existing', id: 'cat-shelter' })
    expect(plan.refByLowerName.get('cooking')).toEqual({ kind: 'new', tempId: 'id-1' })
  })

  it('ignores empty and whitespace-only category names', () => {
    const rows = [{ categoryName: '' }, { categoryName: '   ' }, { categoryName: 'Real' }]
    const plan = planNewCategories(rows, [], makeGenId())
    expect(plan.newCategories.map((c) => c.name)).toEqual(['Real'])
  })
})

describe('planGearResolution', () => {
  it('matches existing gear by (category, NFC-lowercased name, weight) and skips it', () => {
    const refByLowerName = new Map<string, CategoryRef>([
      ['shelter', { kind: 'existing', id: 'cat-shelter' }],
    ])
    const existing = [
      makeGearItem({ id: 'gear-tent', name: 'Tent', weightGrams: 1200, categoryId: 'cat-shelter' }),
    ]
    // Case + surrounding whitespace differ but resolve to the same key.
    const rows = [makeRow({ name: '  tent ', weightGrams: 1200, categoryName: 'Shelter' })]
    const plan = planGearResolution(rows, existing, refByLowerName)
    expect(plan.newItems).toHaveLength(0)
    expect(plan.skippedCount).toBe(1)
  })

  it('creates new items for unmatched rows and carries their category ref + metadata', () => {
    const refByLowerName = new Map<string, CategoryRef>([
      ['cooking', { kind: 'existing', id: 'cat-cooking' }],
    ])
    const rows = [
      makeRow({
        name: 'Stove', description: 'Canister stove', weightGrams: 90,
        categoryName: 'Cooking', cost: 45, purchaseDate: '2026-01-02',
      }),
      makeRow({ name: 'Pot', weightGrams: 150, categoryName: 'Cooking' }),
    ]
    const plan = planGearResolution(rows, [], refByLowerName)
    expect(plan.skippedCount).toBe(0)
    expect(plan.newItems).toHaveLength(2)
    expect(plan.newItems[0]).toEqual({
      name: 'Stove',
      description: 'Canister stove',
      weightGrams: 90,
      cost: 45,
      purchaseDate: '2026-01-02',
      category: { kind: 'existing', id: 'cat-cooking' },
    })
    expect(plan.newItems[1]).toMatchObject({ name: 'Pot', category: { kind: 'existing', id: 'cat-cooking' } })
  })

  it('omits server-assigned fields (id, sortOrder, status) from planned items', () => {
    const rows = [makeRow({ name: 'Spork', weightGrams: 10 })]
    const plan = planGearResolution(rows, [], new Map<string, CategoryRef>())
    const [item] = plan.newItems
    expect(item).not.toHaveProperty('id')
    expect(item).not.toHaveProperty('sortOrder')
    expect(item).not.toHaveProperty('status')
  })

  it('treats within-CSV duplicates as separate new items', () => {
    const rows = [
      makeRow({ name: 'Spork', weightGrams: 10 }),
      makeRow({ name: 'Spork', weightGrams: 10 }),
    ]
    const plan = planGearResolution(rows, [], new Map<string, CategoryRef>())
    expect(plan.newItems).toHaveLength(2)
    expect(plan.skippedCount).toBe(0)
  })

  it('ignores empty-name rows and resolves unknown categories to null', () => {
    const rows = [
      makeRow({ name: '   ', weightGrams: 10, categoryName: 'Cooking' }),
      makeRow({ name: 'Map', weightGrams: 30, categoryName: 'Nonexistent' }),
    ]
    const plan = planGearResolution(rows, [], new Map<string, CategoryRef>())
    expect(plan.newItems).toHaveLength(1)
    expect(plan.newItems[0]).toMatchObject({ name: 'Map', category: null })
  })
})

describe('planGearImport', () => {
  it('composes new categories + new items + skippedCount with correct category refs', () => {
    const existingCategories = [makeCategory({ id: 'cat-shelter', name: 'Shelter', sortOrder: 5 })]
    const existingGearItems = [
      makeGearItem({ id: 'gear-tent', name: 'Tent', weightGrams: 1200, categoryId: 'cat-shelter' }),
    ]
    const rows: GearCsvRow[] = [
      makeRow({ name: 'Tent', weightGrams: 1200, categoryName: 'Shelter' }), // matches existing -> skip
      makeRow({ name: 'Stove', weightGrams: 90, categoryName: 'Cooking', cost: 45 }), // new item + new category
      makeRow({ name: 'Pot', weightGrams: 150, categoryName: 'cooking' }), // new item, same new category
      makeRow({ name: 'Compass', weightGrams: 30, categoryName: 'Shelter' }), // new item, existing category
    ]
    const plan = planGearImport(rows, existingCategories, existingGearItems, makeGenId())

    expect(plan.newCategories).toEqual([{ tempId: 'id-1', name: 'Cooking' }])
    expect(plan.skippedCount).toBe(1)
    expect(plan.newItems.map((i) => i.name)).toEqual(['Stove', 'Pot', 'Compass'])
    // Stove + Pot reference the new Cooking category by tempId.
    expect(plan.newItems[0]?.category).toEqual({ kind: 'new', tempId: 'id-1' })
    expect(plan.newItems[1]?.category).toEqual({ kind: 'new', tempId: 'id-1' })
    // Compass references the existing Shelter category by id.
    expect(plan.newItems[2]?.category).toEqual({ kind: 'existing', id: 'cat-shelter' })
  })

  it('never matches an existing item when the CSV row is in a brand-new category', () => {
    // Same name + weight as the existing Tent, but a NEW category -> the
    // gearKey differs (new tempId), so it is a new item, not a skip.
    const existingCategories = [makeCategory({ id: 'cat-shelter', name: 'Shelter' })]
    const existingGearItems = [
      makeGearItem({ id: 'gear-tent', name: 'Tent', weightGrams: 1200, categoryId: 'cat-shelter' }),
    ]
    const rows = [makeRow({ name: 'Tent', weightGrams: 1200, categoryName: 'Backpacking' })]
    const plan = planGearImport(rows, existingCategories, existingGearItems, makeGenId())
    expect(plan.skippedCount).toBe(0)
    expect(plan.newCategories).toEqual([{ tempId: 'id-1', name: 'Backpacking' }])
    expect(plan.newItems).toHaveLength(1)
    expect(plan.newItems[0]?.category).toEqual({ kind: 'new', tempId: 'id-1' })
  })

  it('never plans an orphan category from an empty-name row (endpoint rejects unreferenced tempIds)', () => {
    // parseGearCsv drops empty-name rows upstream, but a direct caller
    // passing one must not get a plan whose new category has no items -
    // the import endpoint 400s unreferenced tempIds, failing the import.
    const rows = [
      makeRow({ name: '   ', weightGrams: 100, categoryName: 'Ghost Category' }),
      makeRow({ name: 'Real item', weightGrams: 50, categoryName: '' }),
    ]
    const plan = planGearImport(rows, [], [], makeGenId())
    expect(plan.newCategories).toEqual([])
    expect(plan.newItems.map((i) => i.name)).toEqual(['Real item'])
    expect(plan.newItems[0]?.category).toBeNull()
  })

  it('mints unique, non-empty tempIds with the default id generator', () => {
    const rows = [
      makeRow({ name: 'A', weightGrams: 1, categoryName: 'X' }),
      makeRow({ name: 'B', weightGrams: 2, categoryName: 'Y' }),
    ]
    const plan = planGearImport(rows, [], [])
    const ids = plan.newCategories.map((c) => c.tempId)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })
})

// ── list import ──────────────────────────────────────────────────────────────

function makeListRow(over: Partial<ListCsvRow> & { name: string }): ListCsvRow {
  return {
    name: over.name,
    description: over.description ?? null,
    weightGrams: over.weightGrams ?? 0,
    categoryName: over.categoryName ?? '',
    quantity: over.quantity ?? 1,
    isWorn: over.isWorn ?? false,
    isConsumable: over.isConsumable ?? false,
    cost: over.cost ?? null,
  }
}

describe('planListImport cost', () => {
  it('carries cost onto NEW gear, against an empty inventory', () => {
    // Against an empty library every row is new, so this proves the CSV
    // cost actually propagates. Planning against a matching inventory
    // could pass for the wrong reason - the match preserves the stored
    // cost and never exercises the new-gear path at all.
    const rows = [
      makeListRow({ name: 'Tent', weightGrams: 1200, cost: 27.29 }),
      makeListRow({ name: 'Gifted mug', weightGrams: 50, cost: 0 }),
      makeListRow({ name: 'Old rope', weightGrams: 60, cost: null }),
    ]
    const plan = planListImport(rows, [], [], makeGenId())
    expect(plan.newGear.map((g) => g.cost)).toEqual([27.29, 0, null])
  })

  it('never applies a CSV cost to gear already in the library', () => {
    // The safety boundary. A list import that rewrote stored prices would
    // silently damage inventory the user curated by hand - and a matched
    // row is exactly where that would happen. The matched row must resolve
    // to an existing-id ref carrying no cost at all.
    const existingGear = [
      makeGearItem({ id: 'g-tarp', name: 'Tarp', weightGrams: 240, categoryId: null, cost: 89.99 }),
    ]
    const rows = [
      // Same identity as the stored item, but a DIFFERENT price in the file.
      makeListRow({ name: 'Tarp', weightGrams: 240, cost: 5 }),
      makeListRow({ name: 'Brand new thing', weightGrams: 300, cost: 12.5 }),
    ]
    const plan = planListImport(rows, [], existingGear, makeGenId())
    // The matched row produced no new gear, so no cost can reach the store.
    expect(plan.newGear).toHaveLength(1)
    expect(plan.newGear[0]?.name).toBe('Brand new thing')
    expect(plan.newGear[0]?.cost).toBe(12.5)
    expect(plan.items[0]?.gear).toEqual({ kind: 'existing', id: 'g-tarp' })
    // Nothing in the plan references the stored item's cost - the only
    // channel by which an import could overwrite it.
    expect(JSON.stringify(plan)).not.toContain('89.99')
    expect(plan.newGear.some((g) => g.cost === 5)).toBe(false)
  })
})

describe('planListImport', () => {
  it('reuses existing library gear as a ref instead of skipping the row', () => {
    const existingCats = [makeCategory({ id: 'cat-shelter', name: 'Shelter' })]
    const existingGear = [
      makeGearItem({ id: 'g-tarp', name: 'Tarp', weightGrams: 240, categoryId: 'cat-shelter' }),
    ]
    const rows = [
      makeListRow({ name: 'Tarp', weightGrams: 240, categoryName: 'shelter', quantity: 1 }),
      makeListRow({ name: 'Stove', weightGrams: 85, categoryName: 'Shelter', quantity: 2 }),
    ]
    const plan = planListImport(rows, existingCats, existingGear, makeGenId())
    // Matched row becomes an existing-gear ref (this is the gear-import
    // semantics difference: a dedup hit is a reuse, not a skip).
    expect(plan.items).toHaveLength(2)
    expect(plan.items[0]?.gear).toEqual({ kind: 'existing', id: 'g-tarp' })
    expect(plan.reusedGearCount).toBe(1)
    // Unmatched row plans new gear referenced by tempId.
    expect(plan.newGear).toHaveLength(1)
    expect(plan.newGear[0]).toMatchObject({
      tempId: 'id-1', name: 'Stove', weightGrams: 85,
      category: { kind: 'existing', id: 'cat-shelter' },
    })
    expect(plan.items[1]?.gear).toEqual({ kind: 'new', tempId: 'id-1' })
    expect(plan.newCategories).toEqual([])
  })

  it('carries quantity/isWorn/isConsumable through and numbers sortOrder by row index', () => {
    const rows = [
      makeListRow({ name: 'Shoes', weightGrams: 600, quantity: 1, isWorn: true }),
      makeListRow({ name: 'Trail mix', weightGrams: 50, quantity: 3, isConsumable: true }),
    ]
    const plan = planListImport(rows, [], [], makeGenId())
    expect(plan.items[0]).toMatchObject({ quantity: 1, isWorn: true, isConsumable: false, sortOrder: 0 })
    expect(plan.items[1]).toMatchObject({ quantity: 3, isWorn: false, isConsumable: true, sortOrder: 1 })
  })

  it('creates new categories with refs shared across gear entries', () => {
    const rows = [
      makeListRow({ name: 'Pot', weightGrams: 120, categoryName: 'Kitchen' }),
      makeListRow({ name: 'Spork', weightGrams: 10, categoryName: 'kitchen' }),
    ]
    const plan = planListImport(rows, [], [], makeGenId())
    expect(plan.newCategories).toEqual([{ tempId: 'id-1', name: 'Kitchen' }])
    expect(plan.newGear.map((g) => g.category)).toEqual([
      { kind: 'new', tempId: 'id-1' },
      { kind: 'new', tempId: 'id-1' },
    ])
  })

  it('treats within-CSV duplicates as separate new gear, but the same existing gear twice as two refs', () => {
    const existingGear = [makeGearItem({ id: 'g-1', name: 'Socks', weightGrams: 60 })]
    const rows = [
      makeListRow({ name: 'Socks', weightGrams: 60 }),
      makeListRow({ name: 'Socks', weightGrams: 60 }),
      makeListRow({ name: 'Buff', weightGrams: 35 }),
      makeListRow({ name: 'Buff', weightGrams: 35 }),
    ]
    const plan = planListImport(rows, [], existingGear, makeGenId())
    // Existing match: both rows ref the same library gear.
    expect(plan.items[0]?.gear).toEqual({ kind: 'existing', id: 'g-1' })
    expect(plan.items[1]?.gear).toEqual({ kind: 'existing', id: 'g-1' })
    expect(plan.reusedGearCount).toBe(2)
    // Within-CSV dup: dedup is against the EXISTING library only, so two
    // separate new gear entries (matching user typing intent).
    expect(plan.newGear).toHaveLength(2)
    expect(plan.items[2]?.gear).toEqual({ kind: 'new', tempId: plan.newGear[0]?.tempId })
    expect(plan.items[3]?.gear).toEqual({ kind: 'new', tempId: plan.newGear[1]?.tempId })
  })

  it('ignores empty-name rows so sortOrder stays contiguous over the named rows', () => {
    const rows = [
      makeListRow({ name: 'Kept', weightGrams: 10 }),
      makeListRow({ name: '   ', weightGrams: 20 }),
      makeListRow({ name: 'Also kept', weightGrams: 30 }),
    ]
    const plan = planListImport(rows, [], [], makeGenId())
    expect(plan.items.map((i) => i.sortOrder)).toEqual([0, 1])
    expect(plan.newGear.map((g) => g.name)).toEqual(['Kept', 'Also kept'])
  })

  it('a row in a brand-new category never matches existing gear (tempId feeds the dedup key)', () => {
    const existingGear = [makeGearItem({ id: 'g-1', name: 'Tarp', weightGrams: 240, categoryId: null })]
    const rows = [makeListRow({ name: 'Tarp', weightGrams: 240, categoryName: 'Brand New' })]
    const plan = planListImport(rows, [], existingGear, makeGenId())
    expect(plan.reusedGearCount).toBe(0)
    expect(plan.newGear).toHaveLength(1)
    expect(plan.newCategories).toHaveLength(1)
  })
})

describe('assertListImportWithinCaps', () => {
  function planOf(itemCount: number, newGearCount: number) {
    return {
      newCategories: [],
      newGear: Array.from({ length: newGearCount }, (_, i) => ({
        tempId: `t-${i}`, name: `G${i}`, description: null, weightGrams: 0, category: null,
        cost: null,
      })),
      items: Array.from({ length: itemCount }, (_, i) => ({
        gear: { kind: 'new', tempId: `t-${i}` } as const,
        quantity: 1, isWorn: false, isConsumable: false, sortOrder: i,
      })),
      reusedGearCount: 0,
    }
  }

  it('passes at exactly the caps', () => {
    expect(() => assertListImportWithinCaps(planOf(LIST_ITEM_CAP, 0), 0)).not.toThrow()
    expect(() => assertListImportWithinCaps(planOf(1, 1), GEAR_ITEM_CAP - 1)).not.toThrow()
  })

  it('rejects an over-cap item count with the old copy (list cap checked first)', () => {
    expect(() => assertListImportWithinCaps(planOf(LIST_ITEM_CAP + 1, 0), GEAR_ITEM_CAP)).toThrow(
      `A single list can hold at most ${LIST_ITEM_CAP} items; this file has ${LIST_ITEM_CAP + 1}. Split it across multiple lists.`,
    )
  })

  it('rejects an import that would push the inventory over the gear cap', () => {
    expect(() => assertListImportWithinCaps(planOf(2, 2), GEAR_ITEM_CAP - 1)).toThrow(
      `This import would add 2 new gear items to your ${GEAR_ITEM_CAP - 1} existing, exceeding the ${GEAR_ITEM_CAP}-item inventory limit. Remove some items or split the file into smaller batches.`,
    )
    // Singular form for a single new item.
    expect(() => assertListImportWithinCaps(planOf(1, 1), GEAR_ITEM_CAP)).toThrow(
      /would add 1 new gear item to your/,
    )
  })

  it('reused refs do not count toward the gear cap', () => {
    const plan = {
      ...planOf(5, 0),
      items: Array.from({ length: 5 }, (_, i) => ({
        gear: { kind: 'existing', id: `g-${i}` } as const,
        quantity: 1, isWorn: false, isConsumable: false, sortOrder: i,
      })),
      reusedGearCount: 5,
    }
    expect(() => assertListImportWithinCaps(plan, GEAR_ITEM_CAP)).not.toThrow()
  })
})
