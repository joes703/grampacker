import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queries'
import { queries } from '../lib/queries/options'
import { foodItemsShape, updateFoodItem } from '../lib/queries/food'
import { fieldScopedCache } from '../lib/queries/field-scoped'
import { mutationKeys } from '../lib/queries/keys'
import { showToast } from '../lib/toast'
import { foodGramsFor } from '../lib/weight-breakdown'
import type { ListFoodResponse } from '../../shared/food'

// Stable empty value so the food-derived memos below do not see a fresh object
// on every render while the query is still cold.
const EMPTY_LIST_FOOD: ListFoodResponse = { dayCount: 0, slots: [], items: [] }

// This list's food, and the two writes ListDetailPage makes against it, in
// the same shape as useListItemActions / useListGearActions. The page owns everything food-shaped that depends on PAGE state -
// the pack-mode filtering and by-location bucketing, the row menus, the drag
// planning - and this hook owns the part that only depends on the list id:
//   food             - the cached ListFoodResponse (never undefined)
//   grams            - the list's food weight, the one number both the mobile
//                      strip and the desktop table are handed
//   patchPackState   - the Packed/Ready checkboxes on a food row
//   moveFood         - move a food row between packing locations
//
// The mutations are returned RAW, for the same reason useListItemActions
// returns raw mutations: the page's []-deps handler memos capture the wrapper
// object from their first render and only ever call `.mutate` on it, and
// `.mutate` is referentially stable across renders where the wrapper is not.
// Do NOT wrap these in callbacks here - a fresh callback identity each render
// is exactly what those memos are avoiding.
//
// `isPending` / `loadFailed` / `refetch` are surfaced because food sits on the
// SAME load gate as items/gear/categories: a failed food fetch must not fall
// through as zero food weight, which would make the total look right and be
// wrong. `loadFailed` is the first-fetch-failed case specifically - an error on
// a background refetch leaves perfectly good cached food to keep rendering.
//
// This hook reads food's `isPending`/`isError` unconditionally, so they are
// always tracked (v5 re-renders only on properties you actually touch). That
// can cost an extra render or two while the page is still loading. It cannot
// change what renders, and it converges immediately: the observer's
// tracked-prop set only ever grows.
export function useListFood(listId: string) {
  const qc = useQueryClient()

  // Field-scoped access to the food cache. The shape is the part that makes
  // this cache different from list items: a document whose dayCount/slots
  // metadata every optimistic write passes through untouched.
  const foodCache = fieldScopedCache(qc, queryKeys.listFood(listId), foodItemsShape)

  const query = useQuery(queries.listFood(listId))
  const food = query.data ?? EMPTY_LIST_FOOD

  // foodGramsFor sums items alone - never across their slot associations,
  // which would multiply a shared bag by the meals it covers.
  const grams = useMemo(() => foodGramsFor(food.items), [food.items])

  // Pack state on a food row: the Packed/Ready checkboxes.
  type FoodPatchVars = {
    foodId: string
    patch: { isPacked?: boolean; isReady?: boolean }
  }
  // FIELD-SCOPED snapshot + rollback through foodCache, the same composition
  // rule as use-list-item-actions' gear patches and the union reorder: only
  // the fields THIS patch touched rewind, onto the CURRENT row, so a reorder
  // or the sibling checkbox that succeeded while this was in flight survives
  // the rollback.
  const patchPackState = useMutation({
    mutationKey: mutationKeys.updateFoodPackState(listId),
    mutationFn: ({ foodId, patch }: FoodPatchVars) =>
      updateFoodItem(listId, foodId, patch),
    onMutate: ({ foodId, patch }: FoodPatchVars) => foodCache.patchRow(foodId, patch),
    onError: (_err, { foodId }, previousFields) => {
      if (previousFields) foodCache.restoreRow(foodId, previousFields)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.listFood(listId) })
    },
  })

  // Moving a food row between packing locations - the write behind both a
  // cross-location drag of a food row and its row menu. Mirrors
  // useListItemActions' moveItem: the caller supplies the destination's next
  // UNION rank so the optimistic row lands where the refetch will confirm it.
  type MoveFoodVars = {
    foodId: string
    locationId: string | null
    nextPackSortOrder: number
  }
  // Field-scoped like the patch above: a failed move rewinds ONLY the moved
  // row's location + rank, so a Packed/Ready tick that landed mid-flight
  // survives.
  const moveFood = useMutation({
    mutationKey: mutationKeys.moveFoodItem(listId),
    mutationFn: ({ foodId, locationId }: MoveFoodVars) =>
      updateFoodItem(listId, foodId, { packingLocationId: locationId }),
    onMutate: ({ foodId, locationId, nextPackSortOrder }: MoveFoodVars) =>
      foodCache.patchRow(foodId, {
        packingLocationId: locationId,
        packSortOrder: nextPackSortOrder,
      }),
    onError: (_err, { foodId }, previousPlacement) => {
      if (previousPlacement) foodCache.restoreRow(foodId, previousPlacement)
      // Same toast rule as moveItem (use-list-item-actions.ts): this is the
      // write behind a drag, and a silent rollback is indistinguishable from
      // the user dragging back.
      showToast("Couldn't move that item. Please try again.", { type: 'error' })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.listFood(listId) })
    },
  })

  return {
    food,
    grams,
    isPending: query.isPending,
    loadFailed: query.isError && query.data === undefined,
    refetch: query.refetch,
    patchPackState,
    moveFood,
  }
}
