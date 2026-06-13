import { beforeEach, describe, it, expect, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc } }))
import {
  assertFoodPlanDayWithinCap,
  assertMealDefinitionWithinCap,
  assertFoodPlanEntryWithinCap,
  upsertFoodPlanEntries,
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
