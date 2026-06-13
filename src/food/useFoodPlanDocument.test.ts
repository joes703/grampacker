import { describe, it, expect } from 'vitest'
import { selectFoodPlanView } from './useFoodPlanDocument'
import type { FoodPlanDocument } from '../lib/types'

function baseDoc(): FoodPlanDocument {
  const ts = ''
  return {
    plan: { id: 'p', user_id: 'u', list_id: 'l', num_nights: 1, is_food_shared: false, created_at: ts, updated_at: ts },
    meals: [
      { id: 'mB', user_id: 'u', food_plan_id: 'p', name: 'Breakfast', anchor_role: 'breakfast', is_default: true, sort_order: 0, created_at: ts, updated_at: ts },
      { id: 'mD', user_id: 'u', food_plan_id: 'p', name: 'Dinner', anchor_role: 'dinner', is_default: true, sort_order: 1, created_at: ts, updated_at: ts },
    ],
    days: [{ id: 'd1', user_id: 'u', food_plan_id: 'p', day_type_override: null, sort_order: 0, created_at: ts, updated_at: ts }],
    dayMeals: [{ id: 'dm1', user_id: 'u', food_plan_id: 'p', day_id: 'd1', meal_id: 'mB', created_at: ts, updated_at: ts }],
    entries: [
      { id: 'e1', user_id: 'u', food_plan_id: 'p', day_meal_id: 'dm1', is_extra: false, food_item_id: 'f1', basis: 'servings', amount: 2, sort_order: 0, created_at: ts, updated_at: ts },
      { id: 'e2', user_id: 'u', food_plan_id: 'p', day_meal_id: null, is_extra: true, food_item_id: 'f2', basis: 'servings', amount: 1, sort_order: 0, created_at: ts, updated_at: ts },
    ],
  }
}

describe('selectFoodPlanView', () => {
  it('groups entries into cells and surfaces Extras', () => {
    const view = selectFoodPlanView(baseDoc())
    expect(view.days[0]?.cells[0]?.entries.map((e) => e.id)).toEqual(['e1'])
    expect(view.extras.map((e) => e.id)).toEqual(['e2'])
  })

  it('Partial when an anchor Meal is not scheduled; Full when all anchors are', () => {
    expect(selectFoodPlanView(baseDoc()).days[0]?.dayType).toBe('partial') // Dinner anchor unscheduled
    const doc = baseDoc()
    doc.dayMeals.push({ id: 'dm2', user_id: 'u', food_plan_id: 'p', day_id: 'd1', meal_id: 'mD', created_at: '', updated_at: '' })
    expect(selectFoodPlanView(doc).days[0]?.dayType).toBe('full')
  })

  it('a plan with ZERO anchors classifies as Full (vacuous), not Partial', () => {
    const doc = baseDoc()
    doc.meals = doc.meals.map((m) => ({ ...m, anchor_role: null }))
    expect(selectFoodPlanView(doc).days[0]?.dayType).toBe('full')
  })

  it('honors an explicit day_type_override', () => {
    const doc = baseDoc()
    doc.days[0] = { ...doc.days[0]!, day_type_override: 'partial' }
    expect(selectFoodPlanView(doc).days[0]?.dayType).toBe('partial')
  })
})
