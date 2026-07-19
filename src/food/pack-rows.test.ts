import { describe, expect, it } from 'vitest'
import type { FoodItem } from '../lib/types'
import type { FoodPlanDocument } from '../../shared/food-plans'
import { selectFoodPlanView } from './plan-view'
import { selectFoodPackRows } from './pack-rows'

// Same factory shapes as plan-view.test.ts: a food with only the
// projection-relevant fields set, and a two-day, two-meal plan document.
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
    dailyTargets: [],
    mealTargets: [],
    usedByList: null,
    ...overrides,
  }
}

const none: ReadonlySet<string> = new Set()

function rows(
  d: FoodPlanDocument,
  foods: FoodItem[],
  packedIds: ReadonlySet<string> = none,
) {
  return selectFoodPackRows(selectFoodPlanView(d, foods), packedIds)
}

describe('selectFoodPackRows', () => {
  it('aggregates one food across cells and extras into one row, rounding once', () => {
    const result = rows(
      doc({
        entries: [
          // Three entries of the SAME food at 33.4 full grams each. Rounded
          // per entry they read 33 + 33 + 33 = 99; the food-scope contract
          // (design 5.6) is round(100.2) = 100. This fixture fails if the
          // implementation ever sums rounded children.
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f1', basis: 'servings', amount: 1, sortOrder: 0 },
          { id: 'e2', dayMealId: 'c-d2-dinner', isExtra: false, foodItemId: 'f1', basis: 'servings', amount: 1, sortOrder: 0 },
          { id: 'e3', dayMealId: null, isExtra: true, foodItemId: 'f1', basis: 'servings', amount: 1, sortOrder: 0 },
        ],
      }),
      [food('f1', 33.4)],
    )
    expect(result).toEqual([
      {
        foodItemId: 'f1',
        name: 'Food f1',
        brand: null,
        grams: 100,
        estimate: false,
        packed: false,
      },
    ])
  })

  it('renders a food missing from the library cache as a nameless estimate row', () => {
    const result = rows(
      doc({
        entries: [
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'gone', basis: 'servings', amount: 1, sortOrder: 0 },
        ],
      }),
      [],
    )
    expect(result).toEqual([
      {
        foodItemId: 'gone',
        name: null,
        brand: null,
        grams: 0,
        estimate: true,
        packed: false,
      },
    ])
  })

  it('flags an unprojectable packages entry as an estimate but keeps the projectable part', () => {
    const result = rows(
      doc({
        entries: [
          // Projectable: 1 serving * 50 g. Unprojectable: packages with no
          // package size. The food is still fully identifiable and packable;
          // only the weight is an undercount.
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f1', basis: 'servings', amount: 1, sortOrder: 0 },
          { id: 'e2', dayMealId: 'c-d1-dinner', isExtra: false, foodItemId: 'f1', basis: 'packages', amount: 1, sortOrder: 0 },
        ],
      }),
      [food('f1', 50, null)],
    )
    expect(result).toEqual([
      {
        foodItemId: 'f1',
        name: 'Food f1',
        brand: null,
        grams: 50,
        estimate: true,
        packed: false,
      },
    ])
  })

  it('maps packed from the id set and ignores packed ids no longer in the plan', () => {
    const result = rows(
      doc({
        entries: [
          { id: 'e1', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f1', basis: 'servings', amount: 1, sortOrder: 0 },
          { id: 'e2', dayMealId: 'c-d1-bfast', isExtra: false, foodItemId: 'f2', basis: 'servings', amount: 1, sortOrder: 1 },
        ],
      }),
      [food('f1', 50), food('f2', 60)],
      // 'left-plan' is a stale rule-2 window (the food left the plan but the
      // reconcile has not landed client-side yet): it must produce no row.
      new Set(['f2', 'left-plan']),
    )
    expect(result.map((r) => [r.foodItemId, r.packed])).toEqual([
      ['f1', false],
      ['f2', true],
    ])
  })

  it('orders rows by first appearance: days in view order, then extras', () => {
    const result = rows(
      doc({
        entries: [
          // Extras entry first in the ARRAY, but extras render last.
          { id: 'e0', dayMealId: null, isExtra: true, foodItemId: 'f-extra', basis: 'servings', amount: 1, sortOrder: 0 },
          // d2 appears after d1 in the view despite array order.
          { id: 'e1', dayMealId: 'c-d2-bfast', isExtra: false, foodItemId: 'f-day2', basis: 'servings', amount: 1, sortOrder: 0 },
          { id: 'e2', dayMealId: 'c-d1-dinner', isExtra: false, foodItemId: 'f-day1', basis: 'servings', amount: 1, sortOrder: 0 },
        ],
      }),
      [food('f-extra', 10), food('f-day2', 20), food('f-day1', 30)],
    )
    expect(result.map((r) => r.foodItemId)).toEqual([
      'f-day1',
      'f-day2',
      'f-extra',
    ])
  })

  it('returns [] for a plan with no entries', () => {
    expect(rows(doc(), [])).toEqual([])
  })
})
