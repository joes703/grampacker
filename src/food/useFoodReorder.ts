import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys, bulkUpdateSortOrder } from '../lib/queries'
import { showToast } from '../lib/toast'
import type { FoodPlanDocument } from '../lib/types'
import type { ReorderableTable } from '../lib/queries/bulk-reorder'

type Slice = 'days' | 'meals' | 'entries'

const TABLE: Record<Slice, ReorderableTable> = {
  days: 'food_plan_days',
  meals: 'meals',
  entries: 'food_plan_entries',
}

const FIELD: Record<Slice, 'days' | 'meals' | 'entries'> = {
  days: 'days',
  meals: 'meals',
  entries: 'entries',
}

// Reorder a document slice by id list. Optimistic on the ['food-plan', listId]
// cache; rolls back AND toasts on failure (the snap-back is otherwise invisible).
export function useFoodReorder(listId: string, slice: Slice) {
  const qc = useQueryClient()
  const key = queryKeys.foodPlan(listId)
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      bulkUpdateSortOrder(TABLE[slice], orderedIds.map((id, i) => ({ id, sort_order: i }))),
    onMutate: async (orderedIds: string[]) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<FoodPlanDocument | null>(key)
      qc.setQueryData<FoodPlanDocument | null>(key, (old) => {
        if (!old) return old
        const orderById = new Map(orderedIds.map((id, i) => [id, i] as const))
        const field = FIELD[slice]
        // Cast to minimal shape; all three arrays are { id: string; sort_order: number; ... }[]
        const rows = (old[field] as { id: string; sort_order: number }[]).map((r) => {
          const idx = orderById.get(r.id)
          return idx === undefined ? r : { ...r, sort_order: idx }
        })
        return { ...old, [field]: rows }
      })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev)
      showToast("Couldn't save the new order. Please try again.", { type: 'error' })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}
