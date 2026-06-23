import { describe, expect, it } from 'vitest'
import { buildSampleFoodPlanPayload, densityKcalPerGram, mapBasis } from './sample-plan'

// Deterministic id generator so payloads are stable and assertable.
function counter() {
  let n = 0
  return () => `id-${n++}`
}

function build(existingFoods: { id: string; name: string; brand: string | null; sort_order: number }[] = []) {
  return buildSampleFoodPlanPayload({ existingFoods, genId: counter() })
}

describe('mapBasis', () => {
  it('translates the prototype basis to the production enum', () => {
    expect(mapBasis('serving')).toBe('servings')
    expect(mapBasis('package')).toBe('packages')
    expect(mapBasis('weight')).toBe('weight')
  })
})

describe('buildSampleFoodPlanPayload foods', () => {
  it('keeps Instant coffee unknown macros as null (never zero) and its measured zeros', () => {
    const { foods } = build()
    const coffee = foods.find((f) => f.name === 'Instant coffee')!
    expect(coffee.fat_grams).toBeNull()
    expect(coffee.protein_grams).toBeNull()
    expect(coffee.sodium_mg).toBeNull()
    expect(coffee.carbs_grams).toBe(0)
  })

  it('keeps Olive oil sodium as a measured 0 and maps empty brand to null', () => {
    const { foods } = build()
    const oil = foods.find((f) => f.name === 'Olive oil')!
    expect(oil.sodium_mg).toBe(0)
    expect(oil.potassium_mg).toBe(0)
    expect(oil.brand).toBeNull()
    expect(oil.servings_per_package).toBeNull()
  })

  it('inserts all 22 foods on a fresh library', () => {
    expect(build().foods).toHaveLength(22)
  })

  it('reuses an existing library food by name + brand instead of cloning it', () => {
    const payload = build([{ id: 'existing-oats', name: 'Instant oatmeal', brand: 'Quaker', sort_order: 4 }])
    expect(payload.foods).toHaveLength(21)
    expect(payload.foods.some((f) => f.name === 'Instant oatmeal')).toBe(false)
    expect(payload.entries.some((e) => e.food_item_id === 'existing-oats')).toBe(true)
  })
})

describe('buildSampleFoodPlanPayload entries', () => {
  it('includes servings, packages, and weight/grams basis examples', () => {
    const { entries } = build()
    const bases = new Set(entries.map((e) => e.basis))
    expect(bases.has('servings')).toBe(true)
    expect(bases.has('packages')).toBe(true)
    expect(bases.has('weight')).toBe(true)
    // Day 1 on-trail trail mix is entered by weight as 60 g.
    expect(entries.some((e) => e.basis === 'weight' && e.amount === 60)).toBe(true)
  })

  it('flags the three extras with is_extra and no day_meal_id', () => {
    const extras = build().entries.filter((e) => e.is_extra)
    expect(extras).toHaveLength(3)
    expect(extras.every((e) => e.day_meal_id === null)).toBe(true)
  })

  it('gives every scheduled entry a day_meal_id and a positive amount', () => {
    for (const e of build().entries.filter((e) => !e.is_extra)) {
      expect(e.day_meal_id).not.toBeNull()
      expect(e.amount).toBeGreaterThan(0)
    }
  })
})

describe('buildSampleFoodPlanPayload schedule + targets', () => {
  it('builds 5 meals, 7 days, and the partial Day 1 / Day 7 schedule', () => {
    const { meals, days, day_meals } = build()
    expect(meals).toHaveLength(5)
    expect(days).toHaveLength(7)
    expect(days.every((d) => d.day_type_override === null)).toBe(true)
    // Day 1 + Day 7 schedule 2 meals each; Days 2-6 schedule all 5.
    expect(day_meals).toHaveLength(2 + 5 * 5 + 2)
  })

  it('drops the unsupported potassium daily target and converts density to kcal/g', () => {
    const { daily_targets } = build()
    expect(daily_targets.map((t) => t.metric).sort()).toEqual(
      ['calorie_density', 'calories', 'carbs', 'fiber', 'protein', 'sodium'],
    )
    const density = daily_targets.find((t) => t.metric === 'calorie_density')!
    expect(density.mode).toBe('min')
    expect(density.target_min).toBeCloseTo(densityKcalPerGram(125), 6)
  })

  it('builds 4 meal targets (Happy hour has none)', () => {
    expect(build().meal_targets).toHaveLength(4)
  })
})

describe('buildSampleFoodPlanPayload safety', () => {
  it('never includes pack state in the payload', () => {
    const payload = build()
    expect(payload).not.toHaveProperty('packState')
    expect(payload).not.toHaveProperty('food_pack_state')
    expect(Object.keys(payload).sort()).toEqual(
      ['daily_targets', 'day_meals', 'days', 'entries', 'foods', 'meal_targets', 'meals'],
    )
  })
})
