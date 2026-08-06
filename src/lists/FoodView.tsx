import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FoodSection from './FoodSection'
import { queryKeys, mutationKeys } from '../lib/queries/keys'
import {
  createFoodItem,
  deleteFoodItem,
  fetchListFood,
  setFoodDays,
  setFoodSlotNeeded,
  updateFoodItem,
} from '../lib/queries/food'
import { ApiError } from '../lib/api'
import { showToast } from '../lib/toast'
import { FOOD_ITEM_CAP } from '../../shared/food'
import { useWeightUnit } from '../lib/use-weight-unit'

// The Food view: /lists/:id/food. Owns the food document query and every food
// mutation; ListDetailPage keeps its OWN subscription to the same query key
// for the weight breakdown and the summary row (React Query dedupes the
// fetch). Moved verbatim from ListDetailPage when food got its own view.
export default function FoodView({ listId }: { listId: string }) {
  const qc = useQueryClient()
  const { weightUnit } = useWeightUnit()

  const listFoodQuery = useQuery({
    queryKey: queryKeys.listFood(listId),
    queryFn: () => fetchListFood(listId),
  })

  // Plain mutate-and-invalidate, deliberately not optimistic. A slot toggle
  // also clears that slot's associations server-side, and an optimistic
  // transform that flipped only `needed` would show a state the server is
  // never going to produce.
  const invalidateFood = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.listFood(listId) })
  }, [qc, listId])
  const foodDaysMut = useMutation({
    mutationKey: mutationKeys.setFoodDays(listId),
    // Refetch first: FoodSection decides whether to warn about losing planned
    // meals from its cached snapshot, and that cache is up to 30s stale. This
    // narrows the window to a single round trip. It does not close it - that
    // needs a revision check on the write itself.
    mutationFn: async (days: number) => {
      await listFoodQuery.refetch()
      return setFoodDays(listId, days)
    },
    meta: { errorToast: "Couldn't change the trip length. Please try again." },
    onSuccess: invalidateFood,
  })
  const foodSlotMut = useMutation({
    mutationKey: mutationKeys.setFoodSlot(listId),
    mutationFn: (vars: { slotId: string; needed: boolean }) =>
      setFoodSlotNeeded(listId, vars.slotId, vars.needed),
    meta: { errorToast: "Couldn't update that meal. Please try again." },
    onSuccess: invalidateFood,
  })
  const foodItemCreateMut = useMutation({
    mutationKey: mutationKeys.createFoodItem(listId),
    mutationFn: (input: {
      name: string
      weightGrams: number
      quantity: number
      slotIds: string[]
    }) => createFoodItem(listId, input),
    // Deliberately no meta.errorToast: the server's 422 at the item cap and
    // its 400 for a stale slot each say something the generic message cannot,
    // and the cap is the one refusal a user can act on. onError surfaces the
    // real reason and consumes the rejection.
    onError: (err) => {
      const status = err instanceof ApiError ? err.status : 0
      showToast(
        status === 422
          ? `Food item limit reached (${FOOD_ITEM_CAP} per list).`
          : status === 400
            // 400 covers a pruned slot AND a value the server rejects, and the
            // client cannot tell which from the status alone - so the message
            // must not assert one of them.
            ? "Couldn't add that food - check the name, weight and meals and try again."
            : "Couldn't add that food. Please try again.",
        { type: 'error' },
      )
    },
    onSuccess: invalidateFood,
  })
  const foodItemSlotsMut = useMutation({
    mutationKey: mutationKeys.setFoodItemSlots(listId),
    mutationFn: (vars: { itemId: string; slotIds: string[] }) =>
      updateFoodItem(listId, vars.itemId, { slotIds: vars.slotIds }),
    meta: { errorToast: "Couldn't reschedule that food. Please try again." },
    onSuccess: invalidateFood,
  })
  const foodItemDeleteMut = useMutation({
    mutationKey: mutationKeys.deleteFoodItem(listId),
    mutationFn: (itemId: string) => deleteFoodItem(listId, itemId),
    meta: { errorToast: "Couldn't remove that food. Please try again." },
    onSuccess: invalidateFood,
  })
  const foodBusy =
    foodDaysMut.isPending ||
    foodSlotMut.isPending ||
    foodItemCreateMut.isPending ||
    foodItemSlotsMut.isPending ||
    foodItemDeleteMut.isPending

  // Same three-state gate every reader uses (AGENTS.md): a fabricated empty
  // food object under live controls would let a day change write against
  // real rows. FoodSection only renders on resolved data.
  if (listFoodQuery.isLoadingError) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        Couldn't load the food plan.{' '}
        <button
          type="button"
          onClick={() => void listFoodQuery.refetch()}
          className="font-medium underline"
        >
          Retry
        </button>
      </div>
    )
  }
  if (listFoodQuery.isPending) {
    return <p className="mt-3 px-3 py-2 text-sm text-gray-500">Loading food…</p>
  }

  return (
    <FoodSection
      food={listFoodQuery.data}
      weightUnit={weightUnit}
      busy={foodBusy}
      onSetDays={(days) => foodDaysMut.mutate(days)}
      onSetSlotNeeded={(slotId, needed) => foodSlotMut.mutate({ slotId, needed })}
      onAddItem={(input, onSuccess) =>
        foodItemCreateMut.mutate(input, { onSuccess: () => { invalidateFood(); onSuccess() } })
      }
      onDeleteItem={(itemId) => foodItemDeleteMut.mutate(itemId)}
      onSetItemSlots={(itemId, slotIds) => foodItemSlotsMut.mutate({ itemId, slotIds })}
    />
  )
}
