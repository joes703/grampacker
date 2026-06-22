import type {
  FoodItem, FoodPlanDocument, PublicFoodPlanDocument, FoodPlanEntry,
  FoodPlanDailyTarget, MealTarget,
} from '../lib/types'
import { selectFoodPlanView } from './useFoodPlanDocument'
import { summarizeTrip } from '../lib/food/nutrition'
import FoodPlanSummary from './FoodPlanSummary'
import FoodPlanEntryRow from './FoodPlanEntryRow'
import FoodPlanExtras from './FoodPlanExtras'
import DayTotalsStrip from './DayTotalsStrip'
import MealTargetsBar from './MealTargetsBar'
import { FLAT_TABLE_EYEBROW, FLAT_TABLE_HEADER, FLAT_TABLE_SURFACE } from '../components/flat-table-styles'

export default function PublicFoodPlanSection({ doc }: { doc: PublicFoodPlanDocument }) {
  const fullDoc = toReadonlyFoodPlanDocument(doc)
  const view = selectFoodPlanView(fullDoc)
  const foodById = new Map<string, FoodItem>(toReadonlyFoods(doc).map((food) => [food.id, food]))
  const summary = summarizeTrip(view, foodById)
  const hasActiveDailyTargets = fullDoc.dailyTargets.some((target) => target.mode !== 'off')

  return (
    <section aria-label="Food plan" className="space-y-4">
      <FoodPlanSummary
        summary={summary}
        foodById={foodById}
        dailyTargets={fullDoc.dailyTargets}
      />
      {hasActiveDailyTargets ? (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <p className={FLAT_TABLE_EYEBROW}>Owner's plan targets</p>
          <p className="mt-1 text-xs text-gray-400">
            These are the list owner's saved targets, not grampacker nutrition recommendations.
          </p>
        </div>
      ) : null}

      <div data-testid="public-food-plan-document" className={FLAT_TABLE_SURFACE}>
        {view.days.map((dayView, i) => (
          <div
            key={dayView.day.id}
            data-testid={`public-food-day-${dayView.day.id}`}
            className="border-b border-gray-100 bg-white"
          >
            <div
              data-testid={`public-food-day-header-${dayView.day.id}`}
              className={`${FLAT_TABLE_HEADER} justify-between gap-1 px-3`}
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-900">Day {i + 1}</h2>
                <span className="text-xs uppercase tracking-wide text-gray-400">{dayView.dayType}</span>
              </div>
              <DayTotalsStrip dayView={dayView} foodById={foodById} />
            </div>
            {dayView.cells.map((cell) => (
              <section key={cell.dayMealId}>
                <div
                  data-testid="public-food-meal-header"
                  className="flex items-center border-t border-gray-100 px-3 py-1 pl-6"
                >
                  <span className={FLAT_TABLE_EYEBROW}>{cell.meal.name}</span>
                </div>
                <MealTargetsBar
                  entries={cell.entries}
                  foodById={foodById}
                  mealTargets={fullDoc.mealTargets.filter((target) => target.meal_id === cell.meal.id)}
                />
                {cell.entries.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-gray-400">No food yet.</p>
                ) : (
                  cell.entries.map((entry) => (
                    <FoodPlanEntryRow key={entry.id} entry={entry} food={foodById.get(entry.food_item_id)} />
                  ))
                )}
              </section>
            ))}
          </div>
        ))}
        <FoodPlanExtras embedded extras={view.extras} foodById={foodById} />
      </div>
    </section>
  )
}

function toReadonlyFoods(doc: PublicFoodPlanDocument): FoodItem[] {
  return doc.foods.map((food) => ({
    ...food,
    user_id: '',
    notes: null,
    created_at: '',
    updated_at: '',
  }))
}

function toReadonlyFoodPlanDocument(doc: PublicFoodPlanDocument): FoodPlanDocument {
  return {
    plan: {
      id: doc.plan.id,
      user_id: '',
      list_id: '',
      is_food_shared: true,
      created_at: '',
      updated_at: '',
    },
    meals: doc.meals.map((meal) => ({
      ...meal,
      user_id: '',
      food_plan_id: doc.plan.id,
      created_at: '',
      updated_at: '',
    })),
    days: doc.days.map((day) => ({
      ...day,
      user_id: '',
      food_plan_id: doc.plan.id,
      created_at: '',
      updated_at: '',
    })),
    dayMeals: doc.dayMeals.map((dayMeal) => ({
      ...dayMeal,
      user_id: '',
      food_plan_id: doc.plan.id,
      created_at: '',
      updated_at: '',
    })),
    entries: doc.entries.map((entry): FoodPlanEntry => ({
      ...entry,
      user_id: '',
      food_plan_id: doc.plan.id,
      created_at: '',
      updated_at: '',
    })),
    dailyTargets: doc.dailyTargets.map((target): FoodPlanDailyTarget => ({
      ...target,
      user_id: '',
      food_plan_id: doc.plan.id,
    })),
    mealTargets: doc.mealTargets.map((target): MealTarget => ({
      ...target,
      user_id: '',
      food_plan_id: doc.plan.id,
    })),
  }
}
