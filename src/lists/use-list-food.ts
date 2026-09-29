import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys, fetchListFood } from '../lib/queries'
import { updateFoodItem } from '../lib/queries/food'
import { mutationKeys } from '../lib/queries/keys'
import { showToast } from '../lib/toast'
import { foodGramsFor } from '../lib/weight-breakdown'
import type { ListFoodResponse } from '../../shared/food'

// Stable empty value so the food-derived memos below do not see a fresh object
// on every render while the query is still cold.
const EMPTY_LIST_FOOD: ListFoodResponse = { dayCount: 0, slots: [], items: [] }

// This list's food, and the two writes ListDetailPage makes against it, lifted
// out of the page following the useListItemActions / useListGearActions
// precedent. The page owns everything food-shaped that depends on PAGE state -
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
// One deliberate difference from the inline version this replaced. The page
// composed its gate as one `||` chain with food LAST, so on renders where an
// earlier query already answered, food's `isPending`/`isError` went unread and
// so untracked (v5 re-renders only on properties you actually touch). Reading
// them unconditionally here can cost an extra render or two while the page is
// still loading. It cannot change what renders, and it converges immediately:
// the observer's tracked-prop set only ever grows, so both were permanently
// tracked from the first render where the other queries had resolved anyway.
export function useListFood(listId: string) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.listFood(listId),
    queryFn: () => fetchListFood(listId),
  })
  const food = query.data ?? EMPTY_LIST_FOOD

  // foodGramsFor sums items alone - never across their slot associations,
  // which would multiply a shared bag by the meals it covers.
  const grams = useMemo(() => foodGramsFor(food.items), [food.items])

  // Pack state on a food row: the Packed/Ready checkboxes. Optimistic on the
  // food cache; hand-rolled rather than makeOptimisticUpdate because the food
  // cache is one object holding an items array, not a bare collection.
  type FoodPatchVars = {
    foodId: string
    patch: { isPacked?: boolean; isReady?: boolean }
  }
  // FIELD-SCOPED snapshot + rollback, the same composition rule as
  // use-list-item-actions' gear patches and the union reorder: only the
  // fields THIS patch touched are snapshotted, and on failure only those
  // fields rewind onto the CURRENT row - so a reorder or the sibling
  // checkbox that succeeded while this was in flight survives the rollback.
  const patchPackState = useMutation({
    mutationKey: mutationKeys.updateFoodPackState(listId),
    mutationFn: ({ foodId, patch }: FoodPatchVars) =>
      updateFoodItem(listId, foodId, patch),
    onMutate: async ({ foodId, patch }: FoodPatchVars) => {
      await qc.cancelQueries({ queryKey: queryKeys.listFood(listId) })
      const row = qc
        .getQueryData<ListFoodResponse>(queryKeys.listFood(listId))
        ?.items.find((item) => item.id === foodId)
      const previousFields = row
        ? {
            ...(patch.isPacked !== undefined ? { isPacked: row.isPacked } : {}),
            ...(patch.isReady !== undefined ? { isReady: row.isReady } : {}),
          }
        : undefined
      qc.setQueryData<ListFoodResponse>(queryKeys.listFood(listId), (curr) =>
        curr
          ? {
              ...curr,
              items: curr.items.map((item) =>
                item.id === foodId ? { ...item, ...patch } : item,
              ),
            }
          : curr,
      )
      return { previousFields }
    },
    onError: (
      _err: unknown,
      { foodId }: FoodPatchVars,
      ctx: { previousFields: { isPacked?: boolean; isReady?: boolean } | undefined } | undefined,
    ) => {
      const previousFields = ctx?.previousFields
      if (!previousFields) return
      qc.setQueryData<ListFoodResponse>(queryKeys.listFood(listId), (curr) =>
        curr
          ? {
              ...curr,
              items: curr.items.map((item) =>
                item.id === foodId ? { ...item, ...previousFields } : item,
              ),
            }
          : curr,
      )
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
    onMutate: async ({ foodId, locationId, nextPackSortOrder }: MoveFoodVars) => {
      await qc.cancelQueries({ queryKey: queryKeys.listFood(listId) })
      const row = qc
        .getQueryData<ListFoodResponse>(queryKeys.listFood(listId))
        ?.items.find((item) => item.id === foodId)
      const previousPlacement = row
        ? { packingLocationId: row.packingLocationId, packSortOrder: row.packSortOrder }
        : undefined
      qc.setQueryData<ListFoodResponse>(queryKeys.listFood(listId), (curr) =>
        curr
          ? {
              ...curr,
              items: curr.items.map((item) =>
                item.id === foodId
                  ? {
                      ...item,
                      packingLocationId: locationId,
                      packSortOrder: nextPackSortOrder,
                    }
                  : item,
              ),
            }
          : curr,
      )
      return { previousPlacement }
    },
    onError: (
      _err: unknown,
      { foodId }: MoveFoodVars,
      ctx: {
        previousPlacement:
          | { packingLocationId: string | null; packSortOrder: number }
          | undefined
      } | undefined,
    ) => {
      const previousPlacement = ctx?.previousPlacement
      if (previousPlacement) {
        qc.setQueryData<ListFoodResponse>(queryKeys.listFood(listId), (curr) =>
          curr
            ? {
                ...curr,
                items: curr.items.map((item) =>
                  item.id === foodId ? { ...item, ...previousPlacement } : item,
                ),
              }
            : curr,
        )
      }
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
