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

const NO_IDS: ReadonlySet<string> = new Set()

// Pack-mode food checklist state: the rows AND the toggle, colocated with
// their own useQuery subscriptions (the reorder-surfaces lesson, commit
// b8624ec: prop-drilling a derived array across a memo boundary recreates
// the snap-back race).
//
// The plan-document and food-library queries hit the SAME keys
// useFoodProjection already caches, so pack mode adds exactly one fetch:
// the ['food-pack', listId, foodPlanId] id set. All three are gated on
// `enabled` (hasFoodPlan && pack mode) - packing is this data's only
// reader. The observed plan id is part of the pack-state key (see keys.ts)
// so a relink can never render the previous plan's ids as phantom
// pre-checks; every write in this hook goes through the key of the link
// the CLICK observed (vars.expectedFoodPlanId), not the link at settle
// time.
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
//    optimistic tick. The lost-CAS path relies on the same gate rather
//    than invalidating eagerly, for the same reason.
// applied:false is a lost CAS - the plan link moved after the click
// observed it. Not an error status: roll the tick back, tell the user, and
// refetch ['lists'] (the link) eagerly; the id set reconciles when the
// burst's last mutation settles.
//
// Known, accepted race class (shared with the gear checkboxes' updateItem
// and the resets): two in-flight writes for the SAME food, or a reset
// racing a toggle, commit server-side in arrival order, so the earlier
// click can win until the trailing invalidate resyncs. Serializing or
// disabling checkboxes would trade it for blocked packing.
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
    queryKey: queryKeys.foodPackState(listId, foodPlanId ?? ''),
    queryFn: async () => (await fetchFoodPackState(listId)).packedFoodItemIds,
    enabled: on,
  })

  const doc = planQuery.data
  const foods = foodsQuery.data
  const packedIds = packQuery.data

  const planView = useMemo(
    () => (on && doc && foods ? selectFoodPlanView(doc, foods) : null),
    [on, doc, foods],
  )
  // The checklist waits for the id set (rendering it earlier would paint
  // every checkbox unchecked and then flick the packed ones on), but the
  // TOTALS come from the plan document + library alone - usually already
  // cached from edit mode - so the progress denominator is stable while the
  // ids are in flight instead of jumping when they land.
  const planRows = useMemo(
    () => (planView ? selectFoodPackRows(planView, NO_IDS) : []),
    [planView],
  )
  const rows = useMemo(() => {
    if (!planView || !packedIds) return []
    return selectFoodPackRows(planView, new Set(packedIds))
  }, [planView, packedIds])

  type ToggleVars = {
    foodItemId: string
    packed: boolean
    // The plan link the CLICK observed - both the CAS expectation on the
    // wire and the cache generation every callback below writes through,
    // captured in vars so a mid-flight relink can't redirect a rollback
    // into the new plan's entry.
    expectedFoodPlanId: string
  }
  const packKey = (vars: ToggleVars) =>
    queryKeys.foodPackState(listId, vars.expectedFoodPlanId)

  const toggleMutKey = ['food-pack-toggle', listId] as const
  const toggleMut = useMutation({
    mutationKey: toggleMutKey,
    mutationFn: ({ foodItemId, packed, expectedFoodPlanId }: ToggleVars) =>
      toggleFoodPack(listId, foodItemId, packed, expectedFoodPlanId),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: packKey(vars) })
      const ids = qc.getQueryData<string[]>(packKey(vars))
      const wasPacked = ids?.includes(vars.foodItemId) ?? false
      qc.setQueryData<string[]>(packKey(vars), (curr = []) =>
        vars.packed
          ? curr.includes(vars.foodItemId) ? curr : [...curr, vars.foodItemId]
          : curr.filter((id) => id !== vars.foodItemId),
      )
      return { wasPacked }
    },
    onSuccess: (data, vars, ctx) => {
      if (data.applied) return
      // Lost CAS: the plan link moved. Roll this tick back and refetch the
      // link eagerly; the id set itself reconciles through the last-one-out
      // gate in onSettled (an eager invalidate here could refetch
      // pre-toggle server state over a pending sibling's checkmark).
      rollback(vars, ctx)
      showToast("This list's food plan changed, so that checkmark didn't stick.", {
        type: 'error',
      })
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
    },
    onError: (_err, vars, ctx) => {
      rollback(vars, ctx)
      showToast("Couldn't update packing. Please try again.", { type: 'error' })
    },
    onSettled: (_data, _err, vars) => {
      // `> 1` = true siblings still pending (the settling mutation counts
      // itself); the last one out invalidates once for the whole burst.
      if (qc.isMutating({ mutationKey: toggleMutKey }) > 1) return
      void qc.invalidateQueries({ queryKey: packKey(vars) })
    },
  })

  // Restore ONE food's prior membership; every other id (including sibling
  // optimistic ticks) passes through untouched.
  function rollback(vars: ToggleVars, ctx: { wasPacked: boolean } | undefined) {
    if (!ctx) return
    qc.setQueryData<string[]>(packKey(vars), (curr = []) =>
      ctx.wasPacked
        ? curr.includes(vars.foodItemId) ? curr : [...curr, vars.foodItemId]
        : curr.filter((id) => id !== vars.foodItemId),
    )
  }

  return {
    rows,
    // Every row is packable - nothing blocks packing (decided 2026-07-17):
    // even a food missing from the library cache is a real plan entry the
    // server will accept a checkmark for.
    packableTotal: planRows.length,
    packedTotal: rows.filter((r) => r.packed).length,
    isError:
      on && (planQuery.isError || foodsQuery.isError || packQuery.isError),
    toggle: (foodItemId: string, packed: boolean) => {
      if (foodPlanId === null) return
      toggleMut.mutate({ foodItemId, packed, expectedFoodPlanId: foodPlanId })
    },
  }
}
