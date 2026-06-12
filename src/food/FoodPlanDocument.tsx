import { useQuery } from '@tanstack/react-query'
import { queryKeys, fetchFoodItems } from '../lib/queries'
import type { FoodItem, FoodPlanDocument as Doc } from '../lib/types'
import { useFoodPlanView } from './useFoodPlanDocument'
import FoodPlanDayCard from './FoodPlanDayCard'
import FoodPlanExtras from './FoodPlanExtras'

export default function FoodPlanDocument({ listId: _listId, userId, doc }: { listId: string; userId: string; doc: Doc }) {
  const view = useFoodPlanView(doc)
  const foodsQuery = useQuery({ queryKey: queryKeys.foodItems(), queryFn: () => fetchFoodItems(userId) })
  const foodById = new Map<string, FoodItem>((foodsQuery.data ?? []).map((f) => [f.id, f]))

  return (
    <div className="mt-4">
      <h1 className="text-lg font-semibold text-gray-900">Food plan</h1>
      <div className="mt-4 space-y-4">
        {view.days.map((dayView, i) => (
          <FoodPlanDayCard key={dayView.day.id} dayView={dayView} dayIndex={i} foodById={foodById} />
        ))}
      </div>
      <FoodPlanExtras extras={view.extras} foodById={foodById} />
    </div>
  )
}
