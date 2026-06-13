import type { FoodPlanDay, Meal, FoodPlanEntry } from '../types'

export type CellView = { dayMealId: string; meal: Meal; entries: FoodPlanEntry[] }
export type DayView = {
  day: FoodPlanDay
  dayType: 'full' | 'partial'
  cells: CellView[]
  scheduledMealIds: Set<string>
}
export type FoodPlanView = { meals: Meal[]; days: DayView[]; extras: FoodPlanEntry[] }
