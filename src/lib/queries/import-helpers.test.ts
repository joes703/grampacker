import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted: declared at the same hoist tier as vi.mock so the factory
// below can close over mockState safely. A plain top-level `const
// insertCalls: ... = []` would be hit by TDZ at hoist time and the mock
// would throw "Cannot access 'insertCalls' before initialization."
const mockState = vi.hoisted(() => ({
  insertCalls: [] as { table: string; rows: unknown }[],
  nextInsertReturn: {
    data: [] as { id: string }[],
    error: null as Error | null,
  },
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (rows: unknown) => {
        mockState.insertCalls.push({ table, rows })
        return {
          select: () => Promise.resolve(mockState.nextInsertReturn),
        }
      },
    }),
  },
  // resolveOrCreateCategories isn't on the test path (we pass a fully
  // populated catByName), but createCategory is imported at the top of
  // import-helpers.ts via './categories'. That module also imports from
  // '../supabase' — covered by this mock. No further stubbing needed.
}))

import { resolveOrCreateGearForImport } from './import-helpers'
import type { GearItem } from '../types'

beforeEach(() => {
  mockState.insertCalls.length = 0
  mockState.nextInsertReturn = { data: [], error: null }
})

function makeGearItem(overrides: Partial<GearItem>): GearItem {
  return {
    id: 'g-default',
    user_id: 'u-1',
    name: 'Default',
    description: null,
    weight_grams: 100,
    category_id: 'cat-default',
    cost: null,
    purchase_date: null,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveOrCreateGearForImport', () => {
  it('matches against an existing gear row by exact (category, name, weight) triple', async () => {
    const result = await resolveOrCreateGearForImport({
      userId: 'u-1',
      rows: [{ name: 'Headlamp', description: null, weight_grams: 50, category: 'Electronics' }],
      existingGearItems: [
        makeGearItem({ id: 'g-1', name: 'Headlamp', weight_grams: 50, category_id: 'cat-electronics' }),
      ],
      catByName: new Map([['electronics', 'cat-electronics']]),
      startSortOrder: 0,
    })

    expect(result).toEqual({ gearIdByRow: ['g-1'], newCount: 0, matchedCount: 1 })
    expect(mockState.insertCalls).toHaveLength(0)
  })

  it('matches case-insensitively on name (gearKey lowercases)', async () => {
    const result = await resolveOrCreateGearForImport({
      userId: 'u-1',
      rows: [{ name: 'headlamp', description: null, weight_grams: 50, category: 'Electronics' }],
      existingGearItems: [
        makeGearItem({ id: 'g-1', name: 'Headlamp', weight_grams: 50, category_id: 'cat-electronics' }),
      ],
      catByName: new Map([['electronics', 'cat-electronics']]),
      startSortOrder: 0,
    })

    expect(result.gearIdByRow).toEqual(['g-1'])
    expect(result.matchedCount).toBe(1)
    expect(mockState.insertCalls).toHaveLength(0)
  })

  it('matches whitespace-trimmed names', async () => {
    const result = await resolveOrCreateGearForImport({
      userId: 'u-1',
      rows: [{ name: '  Headlamp  ', description: null, weight_grams: 50, category: 'Electronics' }],
      existingGearItems: [
        makeGearItem({ id: 'g-1', name: 'Headlamp', weight_grams: 50, category_id: 'cat-electronics' }),
      ],
      catByName: new Map([['electronics', 'cat-electronics']]),
      startSortOrder: 0,
    })

    expect(result.gearIdByRow).toEqual(['g-1'])
    expect(result.matchedCount).toBe(1)
  })

  it('creates SEPARATE gear rows for within-CSV duplicates (no within-batch dedup)', async () => {
    // Per import-helpers.ts:36-40, newly-created gear in the same import
    // is NOT considered a match candidate for later rows. Two CSV rows
    // with the same (category, name, weight) become two separate gear
    // items, matching user typing intent.
    mockState.nextInsertReturn = {
      data: [{ id: 'new-1' }, { id: 'new-2' }],
      error: null,
    }
    const result = await resolveOrCreateGearForImport({
      userId: 'u-1',
      rows: [
        { name: 'Stake', description: null, weight_grams: 12, category: 'Shelter' },
        { name: 'Stake', description: null, weight_grams: 12, category: 'Shelter' },
      ],
      existingGearItems: [],
      catByName: new Map([['shelter', 'cat-shelter']]),
      startSortOrder: 100,
    })

    expect(result.gearIdByRow).toEqual(['new-1', 'new-2'])
    expect(result.newCount).toBe(2)
    expect(result.matchedCount).toBe(0)
    expect(mockState.insertCalls).toHaveLength(1)
    expect(mockState.insertCalls[0]?.table).toBe('gear_items')
    const insertedRows = mockState.insertCalls[0]?.rows as Array<{ name: string; sort_order: number }>
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows[0]?.name).toBe('Stake')
    expect(insertedRows[1]?.name).toBe('Stake')
    expect(insertedRows[0]?.sort_order).toBe(100)
    expect(insertedRows[1]?.sort_order).toBe(101)
  })

  it('schedules an insert with the expected payload shape when no existing match', async () => {
    mockState.nextInsertReturn = { data: [{ id: 'new-1' }], error: null }
    const result = await resolveOrCreateGearForImport({
      userId: 'u-1',
      rows: [
        {
          name: 'Tent',
          description: 'Two-person freestanding',
          weight_grams: 1300,
          category: 'Shelter',
          cost: 450,
          purchase_date: '2024-06-15',
        },
      ],
      existingGearItems: [],
      catByName: new Map([['shelter', 'cat-shelter']]),
      startSortOrder: 0,
    })

    expect(result.gearIdByRow).toEqual(['new-1'])
    expect(result.newCount).toBe(1)

    const insertedRows = mockState.insertCalls[0]?.rows as Array<{
      user_id: string
      name: string
      description: string | null
      weight_grams: number
      category_id: string | null
      cost: number | null
      purchase_date: string | null
      sort_order: number
    }>
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toEqual({
      user_id: 'u-1',
      name: 'Tent',
      description: 'Two-person freestanding',
      weight_grams: 1300,
      category_id: 'cat-shelter',
      cost: 450,
      purchase_date: '2024-06-15',
      sort_order: 0,
    })
  })

  it('yields null for empty-name rows without scheduling an insert', async () => {
    const result = await resolveOrCreateGearForImport({
      userId: 'u-1',
      rows: [
        { name: '   ', description: null, weight_grams: 100, category: 'Misc' },
      ],
      existingGearItems: [],
      catByName: new Map([['misc', 'cat-misc']]),
      startSortOrder: 0,
    })

    expect(result.gearIdByRow).toEqual([null])
    expect(result.newCount).toBe(0)
    expect(result.matchedCount).toBe(0)
    expect(mockState.insertCalls).toHaveLength(0)
  })
})
