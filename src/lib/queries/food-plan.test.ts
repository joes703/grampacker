import { describe, it, expect, vi } from 'vitest'
vi.mock('../supabase', () => ({ supabase: {} }))
import { assertFoodPlanDayWithinCap, assertMealDefinitionWithinCap, assertFoodPlanEntryWithinCap } from './food-plan'
import { FOOD_PLAN_DAY_CAP, MEAL_DEFINITION_CAP, FOOD_PLAN_ENTRY_CAP } from '../caps'

describe('food plan cap preflight', () => {
  it('allows under the day cap, throws at it', () => {
    expect(() => assertFoodPlanDayWithinCap(FOOD_PLAN_DAY_CAP - 1)).not.toThrow()
    expect(() => assertFoodPlanDayWithinCap(FOOD_PLAN_DAY_CAP)).toThrow(/days/i)
  })
  it('throws at the meal cap', () => { expect(() => assertMealDefinitionWithinCap(MEAL_DEFINITION_CAP)).toThrow(/meals/i) })
  it('throws at the entry cap', () => { expect(() => assertFoodPlanEntryWithinCap(FOOD_PLAN_ENTRY_CAP)).toThrow(/entries/i) })
})
