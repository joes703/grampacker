import { useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  resetFoodPackForList,
  resetPackedForList,
  resetReadyForList,
} from '../lib/queries'
import { showToast } from '../lib/toast'
import type { ListItemWithGear } from '../lib/types'

// Pack/Ready reset actions for ListDetailPage. These are hand-rolled async
// actions (NOT useMutation): each owns its own cancel/snapshot/
// optimistic-clear/rollback/invalidate lifecycle on the per-list
// ['list-items', listId] cache.
//
// Field-scoped snapshot + rollback. resetPacked and resetReady are genuinely
// independent (different fields, different endpoints), so they must be safe
// to interleave. The earlier whole-row `previous` snapshot wasn't: a rollback
// restored every field on the row, so a failing reset would stomp the other
// reset's optimistic clear (or its already-server-committed clear before
// invalidate refetched).
//
// The fix: each reset only snapshots the ids whose own field was true at the
// moment of clear, and on failure flips ONLY that field back. The other reset's
// writes pass through untouched. No mutex needed; the operations compose.
//
// Since slice 4b, resetPacked spans the FOOD checklist too (design 8:
// "Reset packed spans both") when a plan is attached: two independent
// endpoints, two independent per-side rollbacks, one toast at most. The
// same field-scoping argument applies between the two sides - a failed
// gear reset must not resurrect cleared food checkmarks or vice versa.
//
// foodPlanId is the list row's link (null = no plan): both the "does the
// food side exist" switch and part of the pack-state cache key (see
// keys.ts - the id set is cached per observed link).
export function useListResetActions(listId: string, foodPlanId: string | null) {
  const qc = useQueryClient()
  const hasFoodPlan = foodPlanId !== null
  const foodKey = () => queryKeys.foodPackState(listId, foodPlanId as string)

  async function resetPacked() {
    // Optimistic clear - flip isPacked=false on every cached item (and empty
    // the food id set) so the UI updates immediately, then issue the calls
    // and invalidate to settle.
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const snapshot = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    const wasPackedIds = snapshot
      ? new Set(snapshot.filter((i) => i.isPacked).map((i) => i.id))
      : new Set<string>()
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.isPacked ? { ...i, isPacked: false } : i)) : curr,
    )

    // Food side, only under an attached plan. hasFoodPlan comes from the
    // list ROW (the authority on the link); a stale ['food-pack'] cache from
    // an earlier attachment is not this reset's to touch.
    let wasPackedFoodIds: string[] = []
    if (hasFoodPlan) {
      await qc.cancelQueries({ queryKey: foodKey() })
      wasPackedFoodIds =
        qc.getQueryData<string[]>(foodKey()) ?? []
      qc.setQueryData<string[]>(foodKey(), [])
    }

    // allSettled, not all: the sides are independent, so one failing must
    // not abandon (or roll back) the other's committed clear.
    const [gearResult, foodResult] = await Promise.allSettled([
      resetPackedForList(listId),
      hasFoodPlan ? resetFoodPackForList(listId) : Promise.resolve(),
    ])
    if (gearResult.status === 'rejected') {
      // Restore only isPacked=true on the ids we cleared. Any concurrent
      // resetReady write on those same rows survives because we never
      // touch isReady here.
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr ? curr.map((i) => (wasPackedIds.has(i.id) ? { ...i, isPacked: true } : i)) : curr,
      )
    }
    if (foodResult.status === 'rejected') {
      // Union rather than overwrite: a toggle's optimistic tick landing
      // mid-reset passes through, mirroring the gear side's field scoping.
      qc.setQueryData<string[]>(foodKey(), (curr = []) => [
        ...new Set([...curr, ...wasPackedFoodIds]),
      ])
    }
    if (gearResult.status === 'rejected' || foodResult.status === 'rejected') {
      // Non-optimistic action: surface the failure and CONSUME it. onReset() is
      // called fire-and-forget from PackingProgress (() => void), so rethrowing
      // would be an unhandled rejection. One toast no matter which side failed.
      showToast("Couldn't reset packed items. Please try again.", { type: 'error' })
    }
    void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    if (hasFoodPlan) {
      void qc.invalidateQueries({ queryKey: foodKey() })
    }
  }

  // Mirror of resetPacked for Ready Checks. Reset Ready and Reset Packed
  // are independent: clearing one MUST NOT clear the other on the cache.
  async function resetReady() {
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const snapshot = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    const wasReadyIds = snapshot
      ? new Set(snapshot.filter((i) => i.isReady).map((i) => i.id))
      : new Set<string>()
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.isReady ? { ...i, isReady: false } : i)) : curr,
    )
    try {
      await resetReadyForList(listId)
    } catch {
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr ? curr.map((i) => (wasReadyIds.has(i.id) ? { ...i, isReady: true } : i)) : curr,
      )
      showToast("Couldn't reset ready checks. Please try again.", { type: 'error' })
    } finally {
      void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    }
  }

  return { resetPacked, resetReady }
}
