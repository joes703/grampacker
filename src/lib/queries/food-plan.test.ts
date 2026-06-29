import { beforeEach, describe, it, expect, vi } from 'vitest'
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc, from } }))
import {
  assertFoodPlanDayWithinCap,
  assertMealDefinitionWithinCap,
  assertFoodPlanEntryWithinCap,
  assertFoodPlanEntriesWithinCap,
  upsertFoodPlanEntries,
  createFoodPlan,
  fetchFoodPlanCopyOptions,
  copyFoodPlanToList,
  fetchFoodPlan,
  saveFoodPlanTargets,
  updateFoodPlanShare,
} from './food-plan'
import { FOOD_PLAN_DAY_CAP, MEAL_DEFINITION_CAP, FOOD_PLAN_ENTRY_CAP } from '../caps'

describe('food plan cap preflight', () => {
  it('allows under the day cap, throws at it', () => {
    expect(() => assertFoodPlanDayWithinCap(FOOD_PLAN_DAY_CAP - 1)).not.toThrow()
    expect(() => assertFoodPlanDayWithinCap(FOOD_PLAN_DAY_CAP)).toThrow(/days/i)
  })
  it('throws at the meal cap', () => { expect(() => assertMealDefinitionWithinCap(MEAL_DEFINITION_CAP)).toThrow(/meals/i) })
  it('throws at the entry cap', () => { expect(() => assertFoodPlanEntryWithinCap(FOOD_PLAN_ENTRY_CAP)).toThrow(/entries/i) })
})

describe('assertFoodPlanEntriesWithinCap (adding N)', () => {
  it('is a no-op when adding nothing, even at the cap', () => {
    expect(() => assertFoodPlanEntriesWithinCap(FOOD_PLAN_ENTRY_CAP, 0)).not.toThrow()
    expect(() => assertFoodPlanEntriesWithinCap(FOOD_PLAN_ENTRY_CAP, -1)).not.toThrow()
  })
  it('allows a batch that lands exactly on the cap', () => {
    expect(() => assertFoodPlanEntriesWithinCap(FOOD_PLAN_ENTRY_CAP - 2, 2)).not.toThrow()
    expect(() => assertFoodPlanEntriesWithinCap(FOOD_PLAN_ENTRY_CAP - 1, 1)).not.toThrow()
  })
  it('throws when the batch would exceed the cap', () => {
    expect(() => assertFoodPlanEntriesWithinCap(FOOD_PLAN_ENTRY_CAP - 2, 3)).toThrow(/entries/i)
    expect(() => assertFoodPlanEntriesWithinCap(FOOD_PLAN_ENTRY_CAP, 1)).toThrow(/entries/i)
  })
})

describe('upsertFoodPlanEntries', () => {
  beforeEach(() => rpc.mockReset())

  it('sends the full batch in one RPC call', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const additions = [{
      entry: {
        id: 'entry-1',
        food_plan_id: 'plan-1',
        day_meal_id: 'day-meal-1',
        is_extra: false,
        food_item_id: 'food-1',
        basis: 'servings' as const,
        amount: 1,
        sort_order: 0,
      },
      preserve_basis: null,
    }]

    await upsertFoodPlanEntries('user-1', additions)

    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('upsert_food_plan_entries', {
      p_user_id: 'user-1',
      p_additions: additions,
    })
  })
})

describe('createFoodPlan', () => {
  beforeEach(() => rpc.mockReset())

  it('creates a day-based plan without sending a nights value', async () => {
    rpc.mockResolvedValue({ data: { id: 'plan-1' }, error: null })
    const structure = {
      meals: [{ id: 'meal-1', name: 'Breakfast', anchor_role: 'breakfast' as const, is_default: true, sort_order: 0 }],
      days: [{ id: 'day-1', sort_order: 0 }],
      dayMeals: [{ id: 'cell-1', day_id: 'day-1', meal_id: 'meal-1' }],
    }

    await createFoodPlan('user-1', 'list-1', structure)

    expect(rpc).toHaveBeenCalledWith('create_food_plan', {
      p_user_id: 'user-1',
      p_list_id: 'list-1',
      p_meals: structure.meals,
      p_days: structure.days,
      p_day_meals: structure.dayMeals,
    })
    const payload = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect('p_num_nights' in payload).toBe(false)
  })
})

describe('food plan copy helpers', () => {
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
  })

  it('copies a source food plan to a target list through one RPC call', async () => {
    rpc.mockResolvedValue({ data: { id: 'copied-plan' }, error: null })

    await copyFoodPlanToList('user-1', 'source-plan', 'target-list')

    expect(rpc).toHaveBeenCalledWith('copy_food_plan_to_list', {
      p_user_id: 'user-1',
      p_source_food_plan_id: 'source-plan',
      p_target_list_id: 'target-list',
    })
  })

  it('loads copy options from the user plans and list names, excluding the target list', async () => {
    const planBuilder = {
      select: vi.fn(() => planBuilder),
      eq: vi.fn(() => planBuilder),
      neq: vi.fn(() => planBuilder),
      order: vi.fn(() => Promise.resolve({
        data: [
          { id: 'plan-2', list_id: 'list-2', created_at: '2026-01-02' },
          { id: 'plan-3', list_id: 'list-3', created_at: '2026-01-01' },
        ],
        error: null,
      })),
    }
    const listBuilder = {
      select: vi.fn(() => listBuilder),
      eq: vi.fn(() => listBuilder),
      in: vi.fn(() => Promise.resolve({
        data: [
          { id: 'list-2', name: 'Wind River' },
          { id: 'list-3', name: 'Wonderland' },
        ],
        error: null,
      })),
    }
    from.mockImplementation((table: string) => {
      if (table === 'food_plans') return planBuilder
      if (table === 'lists') return listBuilder
      throw new Error(`unexpected table ${table}`)
    })

    await expect(fetchFoodPlanCopyOptions('user-1', 'target-list')).resolves.toEqual([
      { food_plan_id: 'plan-2', list_id: 'list-2', list_name: 'Wind River' },
      { food_plan_id: 'plan-3', list_id: 'list-3', list_name: 'Wonderland' },
    ])
    expect(planBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(planBuilder.neq).toHaveBeenCalledWith('list_id', 'target-list')
    expect(listBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(listBuilder.in).toHaveBeenCalledWith('id', ['list-2', 'list-3'])
  })
})

// A chainable PostgREST builder stub: .select/.eq/.order return self; the chain
// is awaitable (thenable) resolving { data, error }; .maybeSingle resolves the
// first row. Lets us exercise fetchFoodPlan's composite read offline.
function okBuilder(rows: unknown[]) {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.order = () => b
  b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve)
  return b
}

describe('fetchFoodPlan target reads', () => {
  beforeEach(() => from.mockReset())

  it('includes dailyTargets and mealTargets in the assembled document', async () => {
    from.mockImplementation((table: string) => {
      switch (table) {
        case 'food_plans': return okBuilder([{ id: 'plan-1' }])
        case 'food_plan_daily_targets': return okBuilder([{ id: 'dt-1', metric: 'calories' }])
        case 'meal_targets': return okBuilder([{ id: 'mt-1', metric: 'protein' }])
        default: return okBuilder([])
      }
    })

    const doc = await fetchFoodPlan('user-1', 'list-1')

    expect(doc?.dailyTargets).toHaveLength(1)
    expect(doc?.mealTargets).toHaveLength(1)
    expect(from).toHaveBeenCalledWith('food_plan_daily_targets')
    expect(from).toHaveBeenCalledWith('meal_targets')
  })
})

describe('saveFoodPlanTargets', () => {
  beforeEach(() => rpc.mockReset())
  it('sends one RPC call with the four payload arrays', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const payload = {
      dailyUpserts: [{ metric: 'calories' as const, mode: 'range' as const, target_min: 2000, target_max: 3000 }],
      dailyDeletes: ['protein' as const],
      mealUpserts: [{ meal_id: 'm', metric: 'fat_pct' as const, mode: 'max' as const, target_min: null, target_max: 30 }],
      mealDeletes: [{ meal_id: 'm', metric: 'sugar_pct' as const }],
    }
    await saveFoodPlanTargets('u', 'p', payload)
    expect(rpc).toHaveBeenCalledWith('save_food_plan_targets', {
      p_user_id: 'u', p_food_plan_id: 'p',
      p_daily_upserts: payload.dailyUpserts, p_daily_deletes: payload.dailyDeletes,
      p_meal_upserts: payload.mealUpserts, p_meal_deletes: payload.mealDeletes,
    })
  })
  it('throws on rpc error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(saveFoodPlanTargets('u', 'p', { dailyUpserts: [], dailyDeletes: [], mealUpserts: [], mealDeletes: [] })).rejects.toBeDefined()
  })
})

describe('updateFoodPlanShare', () => {
  beforeEach(() => from.mockReset())

  it('updates only is_food_shared on the chosen plan row', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq }))
    from.mockReturnValue({ update })

    await updateFoodPlanShare('plan-1', true)

    expect(from).toHaveBeenCalledWith('food_plans')
    expect(update).toHaveBeenCalledWith({ is_food_shared: true })
    expect(eq).toHaveBeenCalledWith('id', 'plan-1')
  })

  it('throws on update errors', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    const update = vi.fn(() => ({ eq }))
    from.mockReturnValue({ update })

    await expect(updateFoodPlanShare('plan-1', false)).rejects.toBeDefined()
  })
})
