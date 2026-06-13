import { beforeEach, describe, it, expect, vi } from 'vitest'
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc, from } }))
import {
  assertFoodPlanDayWithinCap,
  assertMealDefinitionWithinCap,
  assertFoodPlanEntryWithinCap,
  upsertFoodPlanEntries,
  fetchFoodPlan,
  upsertDailyTarget,
  upsertMealTarget,
} from './food-plan'
import type { DailyTargetInput, MealTargetInput } from '../types'
import { FOOD_PLAN_DAY_CAP, MEAL_DEFINITION_CAP, FOOD_PLAN_ENTRY_CAP } from '../caps'

describe('food plan cap preflight', () => {
  it('allows under the day cap, throws at it', () => {
    expect(() => assertFoodPlanDayWithinCap(FOOD_PLAN_DAY_CAP - 1)).not.toThrow()
    expect(() => assertFoodPlanDayWithinCap(FOOD_PLAN_DAY_CAP)).toThrow(/days/i)
  })
  it('throws at the meal cap', () => { expect(() => assertMealDefinitionWithinCap(MEAL_DEFINITION_CAP)).toThrow(/meals/i) })
  it('throws at the entry cap', () => { expect(() => assertFoodPlanEntryWithinCap(FOOD_PLAN_ENTRY_CAP)).toThrow(/entries/i) })
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

describe('target upserts', () => {
  beforeEach(() => from.mockReset())

  it('upsertDailyTarget strips a leaked id and conflicts on (food_plan_id, metric)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    from.mockReturnValue({ upsert })

    // Simulate a caller that leaks an id at runtime (e.g. spreading a full row).
    // The `as unknown as` cast bypasses the id?: never compile guard on purpose.
    await upsertDailyTarget({
      id: 'leaked', user_id: 'u', food_plan_id: 'p', metric: 'calories',
      mode: 'range', target_min: 2000, target_max: 3000,
    } as unknown as DailyTargetInput)

    expect(from).toHaveBeenCalledWith('food_plan_daily_targets')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ metric: 'calories', food_plan_id: 'p' }),
      { onConflict: 'food_plan_id,metric' },
    )
    const payload = upsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect('id' in payload).toBe(false)
  })

  it('upsertMealTarget strips a leaked id and conflicts on (meal_id, metric)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    from.mockReturnValue({ upsert })

    await upsertMealTarget({
      id: 'leaked', user_id: 'u', food_plan_id: 'p', meal_id: 'm', metric: 'protein',
      mode: 'min', target_min: 20, target_max: null,
    } as unknown as MealTargetInput)

    expect(from).toHaveBeenCalledWith('meal_targets')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ meal_id: 'm', metric: 'protein' }),
      { onConflict: 'meal_id,metric' },
    )
    const payload = upsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect('id' in payload).toBe(false)
  })
})
