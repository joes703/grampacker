import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFoodItems, fetchFoodPlan, queryKeys } from '../lib/queries'
import { selectFoodPlanView } from '../food/plan-view'

export type FoodProjection = {
  planId: string
  // Plan name, for the derived row's label: "Food (Summer 3-day)".
  name: string
  // Already rounded ONCE, at the projection boundary (design 5.6/12.10). Hand
  // this straight to withProjectedFood; never round it again downstream.
  grams: number
  // The total is an undercount: some entry contributed nothing, so this must say
  // so wherever it is shown. NOT a load failure - see isError.
  //
  // design 5.4 says the only cause is a `packages` entry whose food has a null
  // servings_per_package, but selectFoodPlanView also raises it for an entry
  // whose food is missing from the ['food-items'] cache (src/food/plan-view.ts).
  // Copy that renders this flag is therefore generic about the cause; the two
  // want pulling apart in plan-view rather than papering over here.
  incomplete: boolean
}

type Result = {
  // null when this list has no plan attached - the common case.
  projection: FoodProjection | null
  isPending: boolean
  // The plan or food library failed to load. Kept SEPARATE from `incomplete`:
  // that word means one specific, permanent data condition (5.4), and
  // overloading it with a transient fetch failure would make an undercount and
  // an outage indistinguishable. The page shows a banner instead.
  isError: boolean
}

// Reads the plan a list points AT and projects it into a single pack weight.
//
// This is derived, not cached: the projection is a pure function of two queries
// the app already holds - the plan document (['food-plan', id]) and the food
// library (['food-items']) - so it needs no key of its own. A
// foodProjection(listId) cache would be a cache OF a derivation: it could go
// stale against the editor, and it would need invalidating on every plan edit
// (a whole prefix fan-out, back when one plan could back many lists - a plan
// backs at most one list since 2026-07-16). Deriving costs one
// pure call and cannot disagree with the editor, which reads the same document
// through the same selector (design 5.1: no second implementation).
export function useFoodProjection(foodPlanId: string | null): Result {
  const planQuery = useQuery({
    queryKey: queryKeys.foodPlan(foodPlanId ?? undefined),
    queryFn: () => fetchFoodPlan(foodPlanId as string),
    enabled: foodPlanId !== null,
  })

  const foodsQuery = useQuery({
    queryKey: queryKeys.foodItems(),
    queryFn: fetchFoodItems,
    enabled: foodPlanId !== null,
  })

  const doc = planQuery.data
  const foods = foodsQuery.data

  const projection = useMemo(() => {
    if (foodPlanId === null || !doc || !foods) return null
    // The same selector the editor renders from, so the list's number and the
    // editor's total are the same number by construction.
    const view = selectFoodPlanView(doc, foods)
    return {
      planId: view.id,
      name: view.name,
      grams: view.totalGrams,
      incomplete: view.incomplete,
    }
  }, [foodPlanId, doc, foods])

  return {
    projection,
    isPending:
      foodPlanId !== null && (planQuery.isPending || foodsQuery.isPending),
    isError: foodPlanId !== null && (planQuery.isError || foodsQuery.isError),
  }
}
