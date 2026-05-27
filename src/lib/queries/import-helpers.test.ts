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
  // resolveOrCreateCategories isn't on the gear-resolution test path
  // (we pass a fully populated catByName there), but it IS exercised by
  // its own describe block below — which stubs createCategory via the
  // vi.mock('./categories', ...) call below to capture sort_order args
  // directly. The supabase mock above is reused only for gear inserts.
}))

const createCategorySpy = vi.hoisted(() => vi.fn())
vi.mock('./categories', async (importOriginal) => {
  // Keep nextCategorySortOrder (and any other pure helper) wired to the
  // real export so the sparse-order math under test is the same code the
  // app runs. Only createCategory is stubbed so the test can assert the
  // sortOrder argument the helper computed.
  const actual = await importOriginal<typeof import('./categories')>()
  return {
    ...actual,
    createCategory: createCategorySpy,
  }
})

import { resolveOrCreateGearForImport, resolveOrCreateCategories } from './import-helpers'
import type { Category, GearItem } from '../types'

beforeEach(() => {
  mockState.insertCalls.length = 0
  mockState.nextInsertReturn = { data: [], error: null }
  createCategorySpy.mockReset()
})

function makeCategory(overrides: Partial<Category>): Category {
  return {
    id: 'cat-default',
    user_id: 'u-1',
    name: 'Default',
    sort_order: 0,
    is_default: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

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
    status: 'active',
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

  it('matches NFC and NFD compositions of the same name (Unicode normalization)', async () => {
    // Two byte-different but visually identical names: a precomposed `é`
    // (NFC, single codepoint U+00E9) and a decomposed `e` + combining
    // acute (NFD, two codepoints U+0065 U+0301). Some spreadsheet tools
    // and macOS filesystems emit NFD; an export+re-import round-trip
    // shouldn't double-insert. gearKey() normalizes to NFC before
    // lowercasing so both forms produce the same dedup key.
    const nfd = 'caf' + 'é' // "café" composed as e + combining acute
    const nfc = 'café' // "café" with precomposed é
    expect(nfd).not.toBe(nfc) // sanity: the two strings are not identical
    expect(nfd.length).toBe(5) // 'c','a','f','e',combining acute -- 5 codepoints
    expect(nfc.length).toBe(4) // 'c','a','f','é'                  -- 4 codepoints
    const result = await resolveOrCreateGearForImport({
      userId: 'u-1',
      rows: [{ name: nfd, description: null, weight_grams: 50, category: 'Kitchen' }],
      existingGearItems: [
        makeGearItem({ id: 'g-1', name: nfc, weight_grams: 50, category_id: 'cat-kitchen' }),
      ],
      catByName: new Map([['kitchen', 'cat-kitchen']]),
      startSortOrder: 0,
    })

    expect(result.gearIdByRow).toEqual(['g-1'])
    expect(result.matchedCount).toBe(1)
    expect(result.newCount).toBe(0)
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
      status: string
      sort_order: number
    }>
    expect(insertedRows).toHaveLength(1)
    // Status is hard-coded to the default in the import path — CSV
    // import does not carry status. See src/lib/queries/import-helpers.ts.
    expect(insertedRows[0]).toEqual({
      user_id: 'u-1',
      name: 'Tent',
      description: 'Two-person freestanding',
      weight_grams: 1300,
      category_id: 'cat-shelter',
      cost: 450,
      purchase_date: '2024-06-15',
      status: 'active',
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

describe('resolveOrCreateCategories', () => {
  it('assigns sort_order at max(existing.sort_order) + 1, then increments per new category', async () => {
    // Regression: previous code did `existingCategories.length + catByName.size`
    // but catByName was already seeded with existingCategories.length entries,
    // so the first new category got 2*existingCategories.length and every
    // subsequent new category shifted further off. The first-pass fix used
    // catByName.size, which still ties when existing sort_orders are sparse
    // (deleteCategory does not compact). New categories should slot in past
    // the existing max: max+1, max+2, ...
    const existingCategories: Category[] = [
      makeCategory({ id: 'cat-1', name: 'Shelter', sort_order: 0 }),
      makeCategory({ id: 'cat-2', name: 'Sleep', sort_order: 1 }),
      makeCategory({ id: 'cat-3', name: 'Cooking', sort_order: 2 }),
    ]
    let nextId = 1
    createCategorySpy.mockImplementation((userId: string, name: string, sortOrder: number) =>
      Promise.resolve(
        makeCategory({ id: `new-${nextId++}`, user_id: userId, name, sort_order: sortOrder }),
      ),
    )

    await resolveOrCreateCategories(
      'u-1',
      [{ category: 'Hydration' }, { category: 'Electronics' }],
      existingCategories,
    )

    expect(createCategorySpy).toHaveBeenCalledTimes(2)
    expect(createCategorySpy.mock.calls[0]?.[2]).toBe(3) // max(0,1,2) + 1
    expect(createCategorySpy.mock.calls[1]?.[2]).toBe(4) // max + 2
  })

  it('skips past sparse sort_order gaps left by prior deletes', async () => {
    // Original sequence had 4 categories at sort_orders 0, 1, 2, 3. The
    // one at sort_order 1 was deleted without compacting, leaving rows at
    // 0, 2, 3 — length 3 but max 3. A length-based slot would tie with
    // the existing sort_order=3 row, then ascending sort would order by
    // name to break the tie, scrambling the user's intended ordering.
    const existingCategories: Category[] = [
      makeCategory({ id: 'cat-a', name: 'Shelter', sort_order: 0 }),
      makeCategory({ id: 'cat-c', name: 'Cooking', sort_order: 2 }),
      makeCategory({ id: 'cat-d', name: 'Hydration', sort_order: 3 }),
    ]
    let nextId = 1
    createCategorySpy.mockImplementation((_userId: string, name: string, sortOrder: number) =>
      Promise.resolve(makeCategory({ id: `new-${nextId++}`, name, sort_order: sortOrder })),
    )

    await resolveOrCreateCategories('u-1', [{ category: 'Electronics' }], existingCategories)

    expect(createCategorySpy).toHaveBeenCalledTimes(1)
    expect(createCategorySpy.mock.calls[0]?.[2]).toBe(4) // max(0,2,3) + 1, not length 3
  })

  it('returns a name->id map covering both pre-existing and new categories', async () => {
    const existingCategories: Category[] = [
      makeCategory({ id: 'cat-1', name: 'Shelter' }),
    ]
    createCategorySpy.mockImplementation((_userId: string, name: string, sortOrder: number) =>
      Promise.resolve(makeCategory({ id: 'new-1', name, sort_order: sortOrder })),
    )

    const result = await resolveOrCreateCategories(
      'u-1',
      [{ category: 'Shelter' }, { category: 'Hydration' }],
      existingCategories,
    )

    expect(result.get('shelter')).toBe('cat-1')
    expect(result.get('hydration')).toBe('new-1')
    // Only Hydration was new; Shelter matched existing.
    expect(createCategorySpy).toHaveBeenCalledTimes(1)
  })

  it('starts sort_order at 0 when there are no existing categories', async () => {
    let nextId = 1
    createCategorySpy.mockImplementation((_userId: string, name: string, sortOrder: number) =>
      Promise.resolve(makeCategory({ id: `new-${nextId++}`, name, sort_order: sortOrder })),
    )

    await resolveOrCreateCategories(
      'u-1',
      [{ category: 'Shelter' }, { category: 'Sleep' }],
      [],
    )

    expect(createCategorySpy.mock.calls[0]?.[2]).toBe(0)
    expect(createCategorySpy.mock.calls[1]?.[2]).toBe(1)
  })
})
