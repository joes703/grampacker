import { describe, it, expect } from 'vitest'
import type { Category, GearItem } from '../types'
import type { GearCsvRow } from './gear'
import {
  planNewCategories,
  planGearResolution,
  planGearImport,
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
