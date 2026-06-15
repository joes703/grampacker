import type {
  FoodItem, FoodPlanDocument, PublicFoodPlanDocument, FoodPlanEntry,
  FoodPlanDailyTarget, MealTarget,
} from '../lib/types'
import { selectFoodPlanView } from './useFoodPlanDocument'
import FoodPlanSummary from './FoodPlanSummary'
import FoodPlanEntryRow from './FoodPlanEntryRow'
import FoodPlanExtras from './FoodPlanExtras'
import DayTotalsStrip from './DayTotalsStrip'
import MealTargetsBar from './MealTargetsBar'
import { FLAT_TABLE_HEADER, FLAT_TABLE_SURFACE } from '../components/flat-table-styles'

export default function PublicFoodPlanSection({ doc }: { doc: PublicFoodPlanDocument }) {
  const fullDoc = toReadonlyFoodPlanDocument(doc)
  const view = selectFoodPlanView(fullDoc)
  const foodById = new Map<string, FoodItem>(toReadonlyFoods(doc).map((food) => [food.id, food]))

  return (
    <section aria-label="Food plan" className="space-y-4">
      <FoodPlanSummary
        view={view}
        foodById={foodById}
        dailyTargets={fullDoc.dailyTargets}
      />

      <div className="space-y-4">
        {view.days.map((dayView, i) => (
          <div key={dayView.day.id} className={FLAT_TABLE_SURFACE}>
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-900">Day {i + 1}</h2>
                <span className="text-xs uppercase tracking-wide text-gray-400">{dayView.dayType}</span>
              </div>
              <DayTotalsStrip dayView={dayView} foodById={foodById} />
            </div>
            {dayView.cells.map((cell) => (
              <section key={cell.dayMealId} className="mt-2">
                <div className={FLAT_TABLE_HEADER}>{cell.meal.name}</div>
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
      </div>

      <FoodPlanExtras extras={view.extras} foodById={foodById} />
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
