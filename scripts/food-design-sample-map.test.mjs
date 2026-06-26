import { describe, expect, it } from 'vitest'
import * as data from './food-design-sample-data.mjs'
import { buildSeedPlan, densityKcalPerGram, mapBasis, toFoodItemInput } from './food-design-sample-map.mjs'

// Deterministic id generator so payloads are stable and assertable.
function counter() {
  let n = 0
  return () => `id-${n++}`
}

function build(existingFoods = []) {
  return buildSeedPlan({ data, userId: 'owner-1', listId: 'list-1', genId: counter(), existingFoods })
}

const foodInput = (protoId) => toFoodItemInput(data.FOODS.find((f) => f.id === protoId))

describe('toFoodItemInput null/zero fidelity', () => {
  it('keeps Instant coffee unknown macros as null (never zero)', () => {
    const coffee = foodInput('coffee')
    expect(coffee.fat_grams).toBeNull()
    expect(coffee.saturated_fat_grams).toBeNull()
    expect(coffee.protein_grams).toBeNull()
    expect(coffee.sodium_mg).toBeNull()
    expect(coffee.potassium_mg).toBeNull()
    // ...but its measured zeros stay zero.
    expect(coffee.carbs_grams).toBe(0)
    expect(coffee.calories_per_serving).toBe(5)
  })

  it('keeps Olive oil sodium as a measured 0 (not null)', () => {
    const oil = foodInput('oil')
    expect(oil.sodium_mg).toBe(0)
    expect(oil.potassium_mg).toBe(0)
    expect(oil.fat_grams).toBe(14)
    expect(oil.brand).toBeNull() // empty brand -> null
  })

  it('maps a weight-only food with no package to servings_per_package null', () => {
    expect(foodInput('trailmix').servings_per_package).toBeNull()
    expect(foodInput('oats').servings_per_package).toBe(1)
  })
})

describe('mapBasis', () => {
  it('translates prototype singular basis to the production enum', () => {
    expect(mapBasis('serving')).toBe('servings')
    expect(mapBasis('package')).toBe('packages')
    expect(mapBasis('weight')).toBe('weight')
  })
  it('throws on an unknown basis', () => {
    expect(() => mapBasis('bites')).toThrow()
  })
})

describe('densityKcalPerGram', () => {
  it('converts the design 110 kcal/oz daily target to canonical kcal/g', () => {
    expect(densityKcalPerGram(110)).toBeCloseTo(3.880, 3)
  })
})

describe('buildSeedPlan entries', () => {
  it('maps a package-basis entry to basis "packages" with the raw amount', () => {
    const { entries } = build()
    // Day 1 Dinner: beef stroganoff entered as 1 package.
    const strogId = build().foodItemsToInsert.find((r) => r.name === 'Beef stroganoff').id
    const strog = entries.find((e) => e.food_item_id === strogId && !e.is_extra)
    expect(strog.basis).toBe('packages')
    expect(strog.amount).toBe(1)
  })

  it('maps a weight-basis entry to grams in amount', () => {
    const { entries, foodItemsToInsert } = build()
    const trailmixId = foodItemsToInsert.find((r) => r.name === 'Trail mix').id
    // Day 1 On-trail: trail mix entered by weight, 60 g.
    const trail = entries.find((e) => e.food_item_id === trailmixId && e.basis === 'weight')
    expect(trail.basis).toBe('weight')
    expect(trail.amount).toBe(60)
  })

  it('flags extras with is_extra and no day_meal_id', () => {
    const { entries, foodItemsToInsert } = build()
    const extras = entries.filter((e) => e.is_extra)
    // Design EXTRAS = ration, lyte, coffee.
    expect(extras).toHaveLength(3)
    for (const e of extras) {
      expect(e.is_extra).toBe(true)
      expect(e.day_meal_id).toBeNull()
    }
    const rationId = foodItemsToInsert.find((r) => r.name === 'Emergency ration bar').id
    expect(extras.some((e) => e.food_item_id === rationId)).toBe(true)
  })

  it('gives every day entry a day_meal_id and no fake zero amounts', () => {
    const { entries } = build()
    const dayEntries = entries.filter((e) => !e.is_extra)
    for (const e of dayEntries) {
      expect(e.day_meal_id).not.toBeNull()
      expect(e.amount).toBeGreaterThan(0)
    }
  })
})

describe('buildSeedPlan structure', () => {
  it('never builds food_pack_state and never sets share state', () => {
    const result = build()
    expect(result).not.toHaveProperty('packState')
    expect(result).not.toHaveProperty('foodPackState')
    // The plan row carries no is_food_shared (defaults false in the DB).
    expect(result.foodPlan).not.toHaveProperty('is_food_shared')
  })

  it('seeds 5 meals, 7 days, and the expected schedule (Day 1 + Day 7 partial)', () => {
    const { meals, days, dayMeals } = build()
    expect(meals).toHaveLength(5)
    expect(days).toHaveLength(7)
    expect(days.every((d) => d.day_type_override === null)).toBe(true)
    // Day 1 omits breakfast/recovery/happy -> 2 scheduled meals;
    // Day 7 omits dinner/recovery/happy -> 2 scheduled meals; Days 2-6 -> 5 each.
    expect(dayMeals).toHaveLength(2 + 5 * 5 + 2)
  })

  it('drops the unsupported potassium daily target and converts density', () => {
    const { dailyTargets } = build()
    expect(dailyTargets.map((t) => t.metric).sort()).toEqual(
      ['calorie_density', 'calories', 'carbs', 'fiber', 'protein', 'sodium'],
    )
    const density = dailyTargets.find((t) => t.metric === 'calorie_density')
    expect(density.mode).toBe('min')
    expect(density.target_min).toBeCloseTo(3.880, 3)
    const calories = dailyTargets.find((t) => t.metric === 'calories')
    expect(calories.mode).toBe('range')
    expect(calories.target_min).toBe(3000)
    expect(calories.target_max).toBe(4500)
  })

  it('seeds 4 meal targets (Happy hour has none)', () => {
    const { meals, mealTargets } = build()
    expect(mealTargets).toHaveLength(4)
    const byMeal = new Map(meals.map((m) => [m.id, m.name]))
    const named = mealTargets.map((t) => ({ name: byMeal.get(t.meal_id), metric: t.metric, min: t.target_min }))
    expect(named).toContainEqual({ name: 'Dinner', metric: 'protein', min: 28 })
    expect(named).toContainEqual({ name: 'Breakfast', metric: 'calories', min: 500 })
    expect(named.some((t) => t.name === 'Happy hour')).toBe(false)
  })

  it('inserts all 22 foods on a fresh library and carries the owner id', () => {
    const { foodItemsToInsert, reusedFoodCount } = build()
    expect(foodItemsToInsert).toHaveLength(22)
    expect(reusedFoodCount).toBe(0)
    expect(foodItemsToInsert.every((r) => r.user_id === 'owner-1')).toBe(true)
  })

  it('reuses an existing library food by (name, brand) instead of cloning it', () => {
    const { foodItemsToInsert, reusedFoodCount, entries } = build([
      { id: 'existing-oats', name: 'Instant oatmeal', brand: 'Quaker', sort_order: 4 },
    ])
    expect(reusedFoodCount).toBe(1)
    expect(foodItemsToInsert).toHaveLength(21)
    expect(foodItemsToInsert.some((r) => r.name === 'Instant oatmeal')).toBe(false)
    // Entries for oatmeal point at the reused row.
    expect(entries.some((e) => e.food_item_id === 'existing-oats')).toBe(true)
  })
})
