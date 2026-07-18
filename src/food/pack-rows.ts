import { roundProjectedGrams } from '../../shared/food-projection'
import type { FoodPlanView, PlanEntryView } from './plan-view'

// The pack-mode checklist's read model (food-planning-design.md 8, slice 4):
// one row per DISTINCT food in the plan, because food_pack_state is keyed
// (list_id, food_item_id) - you pack "the ramen", not "day 2 dinner's ramen".
//
// Derived from FoodPlanView (the same selector the editor and the Food row
// render from) plus the packed id set, so the checklist cannot disagree with
// the plan editor about what is in the plan.
export type FoodPackRow = {
  foodItemId: string
  // null when the food is not in the ['food-items'] cache (a stale window;
  // the server FK guarantees the row exists). Still packable - the entry is
  // in the plan, so the server's pack gate passes; only the display name is
  // missing. Nothing blocks packing (decided 2026-07-17).
  name: string | null
  brand: string | null
  // roundProjectedGrams over this food's summed FULL-precision entry grams
  // (days + extras) - the single-rounding contract (design 5.6). Never a sum
  // of the entries' already-rounded grams.
  grams: number
  // Some entry for this food could not be projected, so grams is an
  // undercount. Display-only; does not gate the checkbox.
  estimate: boolean
  packed: boolean
}

// Ordered by first appearance: days in view order, then extras - the order
// the plan reads in. A packed id whose food no longer appears in the plan
// produces no row (rule 2 reconciles the row away server-side; the client
// simply never renders the stale window).
export function selectFoodPackRows(
  view: FoodPlanView,
  packedIds: ReadonlySet<string>,
): FoodPackRow[] {
  type Acc = { entry: PlanEntryView; fullGrams: number; estimate: boolean }
  // Map preserves insertion order = first appearance.
  const byFood = new Map<string, Acc>()
  const allEntries = [
    ...view.days.flatMap((d) => d.cells.flatMap((c) => c.entries)),
    ...view.extras.entries,
  ]
  for (const entry of allEntries) {
    const acc = byFood.get(entry.foodItemId)
    if (acc) {
      acc.fullGrams += entry.fullGrams
      acc.estimate = acc.estimate || entry.incomplete
    } else {
      byFood.set(entry.foodItemId, {
        entry,
        fullGrams: entry.fullGrams,
        estimate: entry.incomplete,
      })
    }
  }
  return [...byFood.entries()].map(([foodItemId, acc]) => ({
    foodItemId,
    name: acc.entry.food?.name ?? null,
    brand: acc.entry.food?.brand ?? null,
    grams: roundProjectedGrams(acc.fullGrams),
    estimate: acc.estimate,
    packed: packedIds.has(foodItemId),
  }))
}
