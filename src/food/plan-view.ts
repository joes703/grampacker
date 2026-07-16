import type { FoodItem } from '../lib/types'
import type {
  FoodPlanBasis,
  FoodPlanDocument,
  FoodPlanEntry,
  Meal,
} from '../../shared/food-plans'
import {
  projectFoodGrams,
  roundProjectedGrams,
} from '../../shared/food-projection'
import { formatItemWeight, type WeightUnit } from '../lib/weight'

// How an entry's input reads in the UI: a servings/packages count, or the raw
// weight formatted in the user's unit (a weight-basis amount IS grams).
export function describeEntryAmount(
  basis: FoodPlanBasis,
  amount: number,
  unit: WeightUnit,
): string {
  if (basis === 'weight') return formatItemWeight(amount, unit)
  const noun = basis === 'servings' ? 'serving' : 'package'
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`
}

// The editor's read model. Turns one FoodPlanDocument (the single cache entry)
// plus the ['food-items'] cache into an ordered, projected tree the components
// render directly - days -> meal cells -> entries, plus the Extras bucket, with
// a consumable-weight total at every scope. Pure and synchronous: no hooks, no
// fetches, unit-testable in isolation (design 5.5).
//
// Rounding contract (design 5.6/12.10): every displayed gram figure is
// roundProjectedGrams() of a FULL-PRECISION subtotal for that exact scope, never
// a sum of already-rounded children. Because projectFoodGrams is a linear fold,
// summing per-entry full-precision grams equals projecting the set at once, so
// the plan total here is byte-identical to the server/public-share total over
// the same entries. A day may therefore read 100 g while its two cells read 33
// and 66 (=99): each number is individually correct-to-the-gram, which is the
// intended behavior, not drift.

export type PlanEntryView = {
  id: string
  foodItemId: string
  // null when the referenced food is not in the ['food-items'] cache (a stale
  // window, e.g. a plan edited on another device). The server FK guarantees the
  // row exists; the client just may not have fetched it yet.
  food: FoodItem | null
  basis: FoodPlanBasis
  amount: number
  // Rounded consumable grams this entry contributes (0 when unprojectable).
  grams: number
  // True when this entry cannot be projected: a missing food, or a `packages`
  // entry whose food has no servings_per_package.
  incomplete: boolean
  sortOrder: number
  // Carried so it can be aggregated without re-projecting.
  fullGrams: number
}

export type PlanCellView = {
  dayMealId: string
  mealId: string
  mealName: string
  anchorRole: 'breakfast' | 'dinner' | null
  entries: PlanEntryView[]
  grams: number
  incomplete: boolean
}

export type PlanDayView = {
  id: string
  // 1-based position, for the "Day N" label.
  index: number
  dayTypeOverride: 'full' | 'partial' | null
  cells: PlanCellView[]
  grams: number
  incomplete: boolean
}

export type PlanExtrasView = {
  entries: PlanEntryView[]
  grams: number
  incomplete: boolean
}

export type FoodPlanView = {
  id: string
  name: string
  meals: Meal[]
  days: PlanDayView[]
  extras: PlanExtrasView
  // Whole-plan consumable weight (all days + extras), rounded once. This is the
  // number the public share will show (slice 5).
  totalGrams: number
  incomplete: boolean
  entryCount: number
}

function bySortOrder<T extends { sortOrder: number }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder
}

// Project a single entry against the food cache. Missing food or an
// unprojectable packages line contributes nothing and flags incomplete.
function toEntryView(
  entry: FoodPlanEntry,
  foodsById: Map<string, FoodItem>,
): PlanEntryView {
  const food = foodsById.get(entry.foodItemId) ?? null
  if (!food) {
    return {
      id: entry.id,
      foodItemId: entry.foodItemId,
      food: null,
      basis: entry.basis,
      amount: entry.amount,
      grams: 0,
      incomplete: true,
      sortOrder: entry.sortOrder,
      fullGrams: 0,
    }
  }
  const { grams, incomplete } = projectFoodGrams([
    {
      basis: entry.basis,
      amount: entry.amount,
      servingWeightGrams: food.servingWeightGrams,
      servingsPerPackage: food.servingsPerPackage,
    },
  ])
  return {
    id: entry.id,
    foodItemId: entry.foodItemId,
    food,
    basis: entry.basis,
    amount: entry.amount,
    grams: roundProjectedGrams(grams),
    incomplete,
    sortOrder: entry.sortOrder,
    fullGrams: grams,
  }
}

// Sum a set of already-projected entries at full precision, then round once.
function aggregate(entries: PlanEntryView[]): {
  grams: number
  incomplete: boolean
} {
  let full = 0
  let incomplete = false
  for (const e of entries) {
    full += e.fullGrams
    if (e.incomplete) incomplete = true
  }
  return { grams: roundProjectedGrams(full), incomplete }
}

export function selectFoodPlanView(
  doc: FoodPlanDocument,
  foods: FoodItem[],
): FoodPlanView {
  const foodsById = new Map(foods.map((f) => [f.id, f]))
  const mealsById = new Map(doc.meals.map((m) => [m.id, m]))

  // Bucket entries once: by cell (dayMealId) and the Extras pile.
  const entriesByCell = new Map<string, PlanEntryView[]>()
  const extraEntries: PlanEntryView[] = []
  for (const entry of doc.entries) {
    const view = toEntryView(entry, foodsById)
    if (entry.isExtra || entry.dayMealId === null) {
      extraEntries.push(view)
    } else {
      const bucket = entriesByCell.get(entry.dayMealId)
      if (bucket) bucket.push(view)
      else entriesByCell.set(entry.dayMealId, [view])
    }
  }

  // Cells grouped by day, so each day renders its scheduled meals in order.
  const cellsByDay = new Map<string, PlanCellView[]>()
  for (const dm of doc.dayMeals) {
    const meal = mealsById.get(dm.mealId)
    if (!meal) continue // a cell whose meal was removed; nothing to render
    const entries = (entriesByCell.get(dm.id) ?? []).sort(bySortOrder)
    const { grams, incomplete } = aggregate(entries)
    const cell: PlanCellView = {
      dayMealId: dm.id,
      mealId: dm.mealId,
      mealName: meal.name,
      anchorRole: meal.anchorRole,
      entries,
      grams,
      incomplete,
    }
    const bucket = cellsByDay.get(dm.dayId)
    if (bucket) bucket.push(cell)
    else cellsByDay.set(dm.dayId, [cell])
  }

  const orderedMeals = [...doc.meals].sort(bySortOrder)
  const mealOrder = new Map(orderedMeals.map((m, i) => [m.id, i]))

  const days: PlanDayView[] = [...doc.days]
    .sort(bySortOrder)
    .map((day, i) => {
      const cells = (cellsByDay.get(day.id) ?? []).sort(
        (a, b) =>
          (mealOrder.get(a.mealId) ?? 0) - (mealOrder.get(b.mealId) ?? 0),
      )
      const dayEntries = cells.flatMap((c) => c.entries)
      const { grams, incomplete } = aggregate(dayEntries)
      return {
        id: day.id,
        index: i + 1,
        dayTypeOverride: day.dayTypeOverride,
        cells,
        grams,
        incomplete,
      }
    })

  const sortedExtras = extraEntries.sort(bySortOrder)
  const extrasAgg = aggregate(sortedExtras)
  const extras: PlanExtrasView = {
    entries: sortedExtras,
    grams: extrasAgg.grams,
    incomplete: extrasAgg.incomplete,
  }

  // Plan total is projected over EVERY entry at once (days + extras): extras are
  // food you carry, so they count toward the pack weight and the share.
  const allEntries = [...days.flatMap((d) => d.cells.flatMap((c) => c.entries)), ...sortedExtras]
  const total = aggregate(allEntries)

  return {
    id: doc.id,
    name: doc.name,
    meals: orderedMeals,
    days,
    extras,
    totalGrams: total.grams,
    incomplete: total.incomplete,
    entryCount: doc.entries.length,
  }
}
