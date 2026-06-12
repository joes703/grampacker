import { useMemo } from 'react'
import type { FoodPlanDocument, FoodPlanDay, FoodPlanEntry, Meal } from '../lib/types'

export type CellView = { dayMealId: string; meal: Meal; entries: FoodPlanEntry[] }
export type DayView = {
  day: FoodPlanDay
  dayType: 'full' | 'partial'
  cells: CellView[]
  scheduledMealIds: Set<string>
}
export type FoodPlanView = { meals: Meal[]; days: DayView[]; extras: FoodPlanEntry[] }

const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order

export function selectFoodPlanView(doc: FoodPlanDocument): FoodPlanView {
  const meals = [...doc.meals].sort(bySort)
  const mealById = new Map(meals.map((m) => [m.id, m]))
  const anchorMealIds = meals.filter((m) => m.anchor_role !== null).map((m) => m.id)

  const entriesByDayMeal = new Map<string, FoodPlanEntry[]>()
  const extras: FoodPlanEntry[] = []
  for (const e of doc.entries) {
    if (e.is_extra || e.day_meal_id === null) {
      extras.push(e)
    } else {
      const list = entriesByDayMeal.get(e.day_meal_id) ?? []
      list.push(e)
      entriesByDayMeal.set(e.day_meal_id, list)
    }
  }
  for (const list of entriesByDayMeal.values()) list.sort(bySort)
  extras.sort(bySort)

  const days: DayView[] = [...doc.days].sort(bySort).map((day) => {
    const dms = doc.dayMeals
      .filter((dm) => dm.day_id === day.id)
      .map((dm) => ({ dm, meal: mealById.get(dm.meal_id) }))
      .filter((x): x is { dm: typeof x.dm; meal: Meal } => x.meal !== undefined)
      .sort((a, b) => bySort(a.meal, b.meal))

    const scheduledMealIds = new Set(dms.map((x) => x.meal.id))
    const cells: CellView[] = dms.map((x) => ({
      dayMealId: x.dm.id,
      meal: x.meal,
      entries: entriesByDayMeal.get(x.dm.id) ?? [],
    }))

    const allAnchorsScheduled = anchorMealIds.every((mid) => scheduledMealIds.has(mid))
    const dayType: 'full' | 'partial' =
      day.day_type_override ?? (allAnchorsScheduled ? 'full' : 'partial')

    return { day, dayType, cells, scheduledMealIds }
  })

  return { meals, days, extras }
}

export function useFoodPlanView(doc: FoodPlanDocument): FoodPlanView {
  return useMemo(() => selectFoodPlanView(doc), [doc])
}
