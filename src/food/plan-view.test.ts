import { describe, expect, it } from 'vitest'
import type { FoodItem } from '../lib/types'
import type { FoodPlanDocument } from '../../shared/food-plans'
import { selectFoodPlanView } from './plan-view'

// A food with only the projection-relevant fields set; the rest are filled with
// harmless defaults so the factory returns a complete FoodItem.
function food(
  id: string,
  servingWeightGrams: number,
  servingsPerPackage: number | null = null,
): FoodItem {
  return {
    id,
    name: `Food ${id}`,
    brand: null,
    servingDescription: null,
    servingWeightGrams,
    caloriesPerServing: 100,
    servingsPerPackage,
    fatGrams: null,
    saturatedFatGrams: null,
    carbsGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    proteinGrams: null,
    sodiumMg: null,
    potassiumMg: null,
    notes: null,
    sortOrder: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
}

// A two-day, two-meal plan document. Day/meal sort orders are deliberately
// out of insertion order to prove the view sorts them.
function doc(overrides: Partial<FoodPlanDocument> = {}): FoodPlanDocument {
  return {
    id: 'plan1',
    name: 'Test Plan',
    sortOrder: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    meals: [
      { id: 'm-dinner', name: 'Dinner', anchorRole: 'dinner', isDefault: true, sortOrder: 2 },
      { id: 'm-bfast', name: 'Breakfast', anchorRole: 'breakfast', isDefault: true, sortOrder: 0 },
    ],
    days: [
      { id: 'd2', dayTypeOverride: null, sortOrder: 1 },
      { id: 'd1', dayTypeOverride: null, sortOrder: 0 },
    ],
    dayMeals: [
      { id: 'c-d1-bfast', dayId: 'd1', mealId: 'm-bfast' },
      { id: 'c-d1-dinner', dayId: 'd1', mealId: 'm-dinner' },
      { id: 'c-d2-bfast', dayId: 'd2', mealId: 'm-bfast' },
      { id: 'c-d2-dinner', dayId: 'd2', mealId: 'm-dinner' },
    ],
    entries: [],
    ...overrides,
  }
}

describe('selectFoodPlanView', () => {
  it('orders days and cells by sort order regardless of array order', () => {
    const view = selectFoodPlanView(doc(), [])
    expect(view.days.map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(view.days[0]!.index).toBe(1)
    expect(view.days[1]!.index).toBe(2)
    // Breakfast (sortOrder 0) before Dinner (sortOrder 2) within each day.
    expect(view.days[0]!.cells.map((c) => c.mealName)).toEqual([
      'Breakfast',
      'Dinner',
    ])
  })

  it('projects entries into a cell and totals up through day and plan', () => {
    const view = selectFoodPlanView(
      doc({
        entries: [
          // 2 servings of a 50 g serving = 100 g, in Day 1 breakfast.
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f1', basis: 'servings', amount: 2, sortOrder: 0 },
          // 1.5 packages * 2 servings/pkg * 40 g = 120 g, in Day 1 dinner.
          { id: 'e2', dayMealId: 'c-d1-dinner', isExtra: false, foodItemId: 'f2', basis: 'packages', amount: 1.5, sortOrder: 0 },
        ],
      }),
      [food('f1', 50), food('f2', 40, 2)],
    )
    const day1 = view.days[0]!
    expect(day1.cells[0]!.grams).toBe(100)
    expect(day1.cells[1]!.grams).toBe(120)
    expect(day1.grams).toBe(220)
    expect(view.totalGrams).toBe(220)
    expect(view.incomplete).toBe(false)
    expect(view.entryCount).toBe(2)
  })

  it('flags a packages entry with no package size as incomplete and counts 0', () => {
    const view = selectFoodPlanView(
      doc({
        entries: [
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f1', basis: 'servings', amount: 1, sortOrder: 0 },
          { id: 'e2', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f2', basis: 'packages', amount: 1, sortOrder: 1 },
        ],
      }),
      [food('f1', 50), food('f2', 40, null)],
    )
    const cell = view.days[0]!.cells[0]!
    expect(cell.grams).toBe(50) // only the projectable entry counts
    expect(cell.incomplete).toBe(true)
    expect(cell.entries[1]!.incomplete).toBe(true)
    expect(cell.entries[1]!.grams).toBe(0)
    expect(view.incomplete).toBe(true)
  })

  it('flags an entry whose food is missing from the cache', () => {
    const view = selectFoodPlanView(
      doc({
        entries: [
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'gone', basis: 'servings', amount: 1, sortOrder: 0 },
        ],
      }),
      [], // empty food cache
    )
    const entry = view.days[0]!.cells[0]!.entries[0]!
    expect(entry.food).toBeNull()
    expect(entry.incomplete).toBe(true)
    expect(view.incomplete).toBe(true)
  })

  it('collects Extras separately and includes them in the plan total', () => {
    const view = selectFoodPlanView(
      doc({
        entries: [
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f1', basis: 'weight', amount: 100, sortOrder: 0 },
          { id: 'x1', dayMealId: null, isExtra: true, foodItemId: 'f1', basis: 'weight', amount: 30, sortOrder: 0 },
        ],
      }),
      [food('f1', 50)],
    )
    expect(view.extras.entries).toHaveLength(1)
    expect(view.extras.grams).toBe(30)
    expect(view.days[0]!.grams).toBe(100)
    expect(view.totalGrams).toBe(130) // days + extras
  })

  it('rounds the plan total once, not per cell', () => {
    // Two entries of 0.3 g each in different cells: per-cell rounding gives
    // 0 + 0 = 0; the plan total must round the 0.6 g full-precision sum to 1.
    const view = selectFoodPlanView(
      doc({
        entries: [
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f1', basis: 'weight', amount: 0.3, sortOrder: 0 },
          { id: 'e2', dayMealId: 'c-d2-bfast', isExtra: false, foodItemId: 'f1', basis: 'weight', amount: 0.3, sortOrder: 0 },
        ],
      }),
      [food('f1', 50)],
    )
    expect(view.days[0]!.cells[0]!.grams).toBe(0)
    expect(view.days[1]!.cells[0]!.grams).toBe(0)
    expect(view.totalGrams).toBe(1)
  })

  it('skips a cell whose meal has been removed', () => {
    const base = doc()
    const view = selectFoodPlanView(
      {
        ...base,
        meals: base.meals.filter((m) => m.id !== 'm-dinner'),
      },
      [],
    )
    // Dinner cells are dropped; only Breakfast remains per day.
    expect(view.days[0]!.cells.map((c) => c.mealName)).toEqual(['Breakfast'])
    expect(view.meals).toHaveLength(1)
  })
})
