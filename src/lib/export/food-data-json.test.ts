import { describe, expect, it } from 'vitest'
import type { FoodItem } from '../types'
import type { FoodPlanDocument } from '../queries'
import { buildFoodDataJson } from './food-data-json'

function makeFood(over: Partial<FoodItem> & { id: string; name: string }): FoodItem {
  return {
    id: over.id,
    name: over.name,
    brand: over.brand ?? null,
    servingDescription: over.servingDescription ?? null,
    servingWeightGrams: over.servingWeightGrams ?? 50,
    caloriesPerServing: over.caloriesPerServing ?? 200,
    servingsPerPackage: over.servingsPerPackage ?? null,
    fatGrams: over.fatGrams ?? null,
    saturatedFatGrams: over.saturatedFatGrams ?? null,
    carbsGrams: over.carbsGrams ?? null,
    fiberGrams: over.fiberGrams ?? null,
    sugarGrams: over.sugarGrams ?? null,
    proteinGrams: over.proteinGrams ?? null,
    sodiumMg: over.sodiumMg ?? null,
    potassiumMg: over.potassiumMg ?? null,
    notes: over.notes ?? null,
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: over.updatedAt ?? '2026-01-01T00:00:00Z',
  }
}

function makePlan(over: Partial<FoodPlanDocument> & { id: string; name: string }): FoodPlanDocument {
  return {
    id: over.id,
    name: over.name,
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: over.updatedAt ?? '2026-01-01T00:00:00Z',
    meals: over.meals ?? [
      { id: 'm-1', name: 'Breakfast', anchorRole: 'breakfast', isDefault: true, sortOrder: 0 },
    ],
    days: over.days ?? [{ id: 'd-1', dayTypeOverride: null, sortOrder: 0 }],
    dayMeals: over.dayMeals ?? [{ id: 'dm-1', dayId: 'd-1', mealId: 'm-1' }],
    entries: over.entries ?? [
      {
        id: 'e-1',
        dayMealId: 'dm-1',
        isExtra: false,
        foodItemId: 'f-1',
        basis: 'servings',
        amount: 2,
        sortOrder: 0,
      },
    ],
    dailyTargets: over.dailyTargets ?? [],
    mealTargets: over.mealTargets ?? [],
    usedByList: over.usedByList ?? null,
  }
}

describe('buildFoodDataJson', () => {
  it('wraps the library and full plan documents in a version-3 envelope', () => {
    const foodItems = [makeFood({ id: 'f-1', name: 'Oats', sodiumMg: 0 })]
    const foodPlans = [makePlan({ id: 'p-1', name: 'JMT week 1', usedByList: { id: 'l-1', name: 'JMT' } })]
    const doc = buildFoodDataJson({ foodItems, foodPlans })
    expect(doc).toEqual({ version: 3, foodItems, foodPlans })
    // Exactly the envelope - nothing else rides along (pack state is
    // deliberately excluded: ephemeral trip-prep, not portable data).
    expect(Object.keys(doc).sort()).toEqual(['foodItems', 'foodPlans', 'version'])
  })

  it('keeps empty collections as empty arrays so the shape is stable', () => {
    expect(buildFoodDataJson({ foodItems: [], foodPlans: [] })).toEqual({
      version: 3,
      foodItems: [],
      foodPlans: [],
    })
  })
})
