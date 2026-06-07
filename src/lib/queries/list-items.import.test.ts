import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GearItem, Category, List } from '../types'
import type { ListImportRow } from '../csv'
import type { ListImportPlan } from './import-plan'

// Hoisted spies for the collaborators importListFromCsv orchestrates. We mock
// at the module boundary so this test exercises ONLY the orchestration in
// list-items.ts: cap preflight -> plan -> atomic RPC. The real planner and RPC
// are covered by their own tests.
const h = vi.hoisted(() => ({
  assertListImportWithinCaps: vi.fn(),
  buildListImportPlan: vi.fn(),
  createListWithImportedItems: vi.fn(),
}))

// list-items.ts imports `../supabase` at module scope; CI has no
// VITE_SUPABASE_URL so the real module throws on import. Stub it (the code
// under test never touches it - all writes go through the mocked ./lists RPC).
vi.mock('../supabase', () => ({ supabase: {} }))
vi.mock('./import-helpers', () => ({ assertListImportWithinCaps: h.assertListImportWithinCaps }))
vi.mock('./import-plan', () => ({ buildListImportPlan: h.buildListImportPlan }))
vi.mock('./lists', () => ({ createListWithImportedItems: h.createListWithImportedItems }))

import { importListFromCsv } from './list-items'

const GEAR: GearItem = {
  id: 'g1',
  user_id: 'u1',
  name: 'Tent',
  description: null,
  weight_grams: 1000,
  category_id: 'c1',
  status: 'active',
  cost: null,
  purchase_date: null,
  sort_order: 0,
  created_at: '',
  updated_at: '',
}

const CAT: Category = {
  id: 'c1',
  user_id: 'u1',
  name: 'Shelter',
  is_default: false,
  sort_order: 0,
  created_at: '',
}

const ROWS: ListImportRow[] = [
  {
    name: 'Tent',
    description: null,
    weight_grams: 1000,
    category: 'Shelter',
    quantity: 1,
    is_worn: false,
    is_consumable: false,
  },
]

const PLAN: ListImportPlan = { newCategories: [], newGear: [], listItems: [] }
const RESULT_LIST: List = {
  id: 'L1',
  user_id: 'u1',
  name: 'Imported',
  description: null,
  slug: 'abc123',
  is_shared: false,
  is_draft: false,
  group_worn: false,
  ready_checks_enabled: false,
  sort_order: 0,
  created_at: '',
  updated_at: '',
}

describe('importListFromCsv', () => {
  beforeEach(() => {
    h.assertListImportWithinCaps.mockReset().mockImplementation(() => {})
    h.buildListImportPlan.mockReset().mockReturnValue(PLAN)
    h.createListWithImportedItems.mockReset().mockResolvedValue(RESULT_LIST)
  })

  it('preflights caps BEFORE the RPC: when caps throw, the RPC is never called', async () => {
    h.assertListImportWithinCaps.mockImplementation(() => {
      throw new Error('over cap')
    })

    await expect(importListFromCsv('u1', 'Imported', ROWS, [GEAR], [CAT], 7)).rejects.toThrow(
      'over cap',
    )
    expect(h.createListWithImportedItems).not.toHaveBeenCalled()
  })

  it('when caps pass, forwards the planner plan to the atomic RPC', async () => {
    const result = await importListFromCsv('u1', 'Imported', ROWS, [GEAR], [CAT], 7)

    expect(h.assertListImportWithinCaps).toHaveBeenCalledWith(ROWS, [GEAR], [CAT])
    expect(h.buildListImportPlan).toHaveBeenCalledWith(ROWS, [GEAR], [CAT], expect.any(Function))
    // The plan from buildListImportPlan is forwarded verbatim, with the
    // userId/name/sortOrder, to the atomic RPC wrapper.
    expect(h.createListWithImportedItems).toHaveBeenCalledWith('u1', 'Imported', 7, PLAN)
    expect(result).toBe(RESULT_LIST)
  })
})
