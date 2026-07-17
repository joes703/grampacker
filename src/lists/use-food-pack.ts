import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchFoodItems,
  fetchFoodPackState,
  fetchFoodPlan,
  queryKeys,
  toggleFoodPack,
} from '../lib/queries'
import { selectFoodPlanView } from '../food/plan-view'
import { selectFoodPackRows, type FoodPackRow } from '../food/pack-rows'
import { showToast } from '../lib/toast'

// Pack-mode food checklist state: the rows AND the toggle, colocated with
// their own useQuery subscriptions (the reorder-surfaces lesson, commit
// b8624ec: prop-drilling a derived array across a memo boundary recreates
// the snap-back race).
//
// The plan-document and food-library queries hit the SAME keys
// useFoodProjection already caches, so pack mode adds exactly one fetch:
// the ['food-pack', listId] id set. All three are gated on `enabled`
// (hasFoodPlan && pack mode) - packing is this data's only reader.
//
// The cache stores the id set as a plain string[] (the wire shape;
// structural sharing works on plain data). Sets are derived per render.
//
// The toggle is the highest-frequency mutation in the app (design 6), so
// its lifecycle copies use-list-item-actions' updateItem discipline:
//  - per-id rollback (restore THAT food's prior membership), never a
//    whole-array snapshot restore, so concurrent ticks on different foods
//    compose;
//  - last-one-out invalidation via mutationKey + qc.isMutating, so an
//    early settle can't refetch stale server state over a sibling's
//    optimistic tick.
// applied:false is a lost CAS - the plan link moved after this render
// observed it. Not an error status: roll the tick back, tell the user, and
// refetch ['lists'] (the link) alongside the pack state.
export function useFoodPack(
  listId: string,
  foodPlanId: string | null,
  enabled: boolean,
): {
  rows: FoodPackRow[]
  packableTotal: number
  packedTotal: number
  isError: boolean
  toggle: (foodItemId: string, packed: boolean) => void
} {
  const qc = useQueryClient()
  const on = enabled && foodPlanId !== null

  const planQuery = useQuery({
    queryKey: queryKeys.foodPlan(foodPlanId ?? undefined),
    queryFn: () => fetchFoodPlan(foodPlanId as string),
    enabled: on,
  })
  const foodsQuery = useQuery({
    queryKey: queryKeys.foodItems(),
    queryFn: fetchFoodItems,
    enabled: on,
  })
  const packQuery = useQuery({
    queryKey: queryKeys.foodPackState(listId),
    queryFn: async () => (await fetchFoodPackState(listId)).packedFoodItemIds,
    enabled: on,
  })

  const doc = planQuery.data
  const foods = foodsQuery.data
  const packedIds = packQuery.data

  const rows = useMemo(() => {
    // All three or nothing: rendering rows before the id set resolves would
    // paint every checkbox unchecked and then flick the packed ones on.
    if (!on || !doc || !foods || !packedIds) return []
    return selectFoodPackRows(selectFoodPlanView(doc, foods), new Set(packedIds))
  }, [on, doc, foods, packedIds])

  const toggleMutKey = ['food-pack-toggle', listId] as const
  const toggleMut = useMutation({
    mutationKey: toggleMutKey,
    mutationFn: ({ foodItemId, packed }: { foodItemId: string; packed: boolean }) =>
      // foodPlanId is the link THIS render observed - the CAS expectation
      // (design 6 rule 3). toggle() guards the null case.
      toggleFoodPack(listId, foodItemId, packed, foodPlanId as string),
    onMutate: async ({ foodItemId, packed }) => {
      await qc.cancelQueries({ queryKey: queryKeys.foodPackState(listId) })
      const ids = qc.getQueryData<string[]>(queryKeys.foodPackState(listId))
      const wasPacked = ids?.includes(foodItemId) ?? false
      qc.setQueryData<string[]>(queryKeys.foodPackState(listId), (curr = []) =>
        packed
          ? curr.includes(foodItemId) ? curr : [...curr, foodItemId]
          : curr.filter((id) => id !== foodItemId),
      )
      return { foodItemId, wasPacked }
    },
    onSuccess: (data, _vars, ctx) => {
      if (data.applied) return
      // Lost CAS: the plan link moved. Roll this tick back and resync both
      // the link (['lists']) and the pack state.
      rollback(ctx)
      showToast("This list's food plan changed, so that checkmark didn't stick.", {
        type: 'error',
      })
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.foodPackState(listId) })
    },
    onError: (_err, _vars, ctx) => {
      rollback(ctx)
      showToast("Couldn't update packing. Please try again.", { type: 'error' })
    },
    onSettled: () => {
      // `> 1` = true siblings still pending (the settling mutation counts
      // itself); the last one out invalidates once for the whole burst.
      if (qc.isMutating({ mutationKey: toggleMutKey }) > 1) return
      void qc.invalidateQueries({ queryKey: queryKeys.foodPackState(listId) })
    },
  })

  // Restore ONE food's prior membership; every other id (including sibling
  // optimistic ticks) passes through untouched.
  function rollback(ctx: { foodItemId: string; wasPacked: boolean } | undefined) {
    if (!ctx) return
    qc.setQueryData<string[]>(queryKeys.foodPackState(listId), (curr = []) =>
      ctx.wasPacked
        ? curr.includes(ctx.foodItemId) ? curr : [...curr, ctx.foodItemId]
        : curr.filter((id) => id !== ctx.foodItemId),
    )
  }

  return {
    rows,
    // Every row is packable - nothing blocks packing (decided 2026-07-17):
    // even a food missing from the library cache is a real plan entry the
    // server will accept a checkmark for.
    packableTotal: rows.length,
    packedTotal: rows.filter((r) => r.packed).length,
    isError:
      on && (planQuery.isError || foodsQuery.isError || packQuery.isError),
    toggle: (foodItemId: string, packed: boolean) => {
      if (foodPlanId === null) return
      toggleMut.mutate({ foodItemId, packed })
    },
  }
}
