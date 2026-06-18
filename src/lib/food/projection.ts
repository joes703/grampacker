import type { EntryBasis, FoodItemLite } from '../types'

export type ProjectionEntry = { food_item_id: string; basis: EntryBasis; amount: number }

// One derived row per distinct food across ALL entries (days, meals, Extras).
// Discriminated like the nutrition totals: an incomplete row carries NO grams, so
// it can never enter weight totals as a silent zero. The packed signature is
// server-computed and is NOT produced here.
//
// Typed against FoodItemLite (id/name/brand/serving_weight_grams/
// calories_per_serving/servings_per_package) because the projection needs only
// the serving columns; this widens the accepted input so full FoodItem callers
// still type-check (FoodItem is a structural superset of FoodItemLite).
export type ProjectionRow =
  | { foodItemId: string; food: FoodItemLite; state: 'complete'; totalEffectiveServings: number; totalPackedWeightGrams: number }
  | { foodItemId: string; food: FoodItemLite | null; state: 'incomplete'; reason: 'missing-food' | 'missing-metadata' }

type Acc = { food: FoodItemLite | null; servings: number; grams: number; bad: boolean }

function metadataOk(basis: EntryBasis, food: FoodItemLite): boolean {
  if (basis === 'packages') return food.servings_per_package != null && food.servings_per_package > 0
  return true // servings needs nothing; weight needs serving_weight_grams, which is NOT NULL > 0
}

export function projectFoodPlan(entries: ProjectionEntry[], foodById: Map<string, FoodItemLite>): ProjectionRow[] {
  const order: string[] = []
  const acc = new Map<string, Acc>()
  for (const e of entries) {
    let a = acc.get(e.food_item_id)
    if (!a) {
      a = { food: foodById.get(e.food_item_id) ?? null, servings: 0, grams: 0, bad: false }
      acc.set(e.food_item_id, a)
      order.push(e.food_item_id)
    }
    if (a.food === null || a.bad) continue
    if (!metadataOk(e.basis, a.food)) { a.bad = true; continue }
    const sw = a.food.serving_weight_grams
    // Compute grams directly per basis (matches the division-free SQL). For weight
    // basis the grams ARE the amount - never divide then multiply back.
    if (e.basis === 'servings') {
      a.servings += e.amount
      a.grams += e.amount * sw
    } else if (e.basis === 'packages') {
      const servings = e.amount * (a.food.servings_per_package as number)
      a.servings += servings
      a.grams += servings * sw
    } else { // weight
      a.grams += e.amount
      a.servings += e.amount / sw // servings is display-only; grams stays exact
    }
  }
  return order.map((id): ProjectionRow => {
    const a = acc.get(id)!
    if (a.food === null) return { foodItemId: id, food: null, state: 'incomplete', reason: 'missing-food' }
    if (a.bad) return { foodItemId: id, food: a.food, state: 'incomplete', reason: 'missing-metadata' }
    return { foodItemId: id, food: a.food, state: 'complete', totalEffectiveServings: a.servings, totalPackedWeightGrams: a.grams }
  })
}

// Sum of packed grams over COMPLETE rows only (incomplete contributes nothing).
export function totalProjectedConsumableGrams(rows: ProjectionRow[]): number {
  return rows.reduce((s, r) => (r.state === 'complete' ? s + r.totalPackedWeightGrams : s), 0)
}
