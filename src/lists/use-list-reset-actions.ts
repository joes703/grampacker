import { useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  resetPackedForList,
  resetReadyForList,
} from '../lib/queries'
import { showToast } from '../lib/toast'
import type { ListFoodResponse } from '../../shared/food'
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
// Since 0022 each reset clears BOTH caches: the server clears gear and food in
// one batch, so the optimistic clear, the rollback, and the invalidate all
// span ['list-items', listId] AND ['list-food', listId] - a reset that left
// the food checkboxes ticked would contradict what the server just did.
export function useListResetActions(listId: string) {
  const qc = useQueryClient()

  async function resetFlag(
    flag: 'isPacked' | 'isReady',
    serverReset: (listId: string) => Promise<void>,
    failureToast: string,
  ) {
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    await qc.cancelQueries({ queryKey: queryKeys.listFood(listId) })
    const gearSnapshot = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    const foodSnapshot = qc.getQueryData<ListFoodResponse>(queryKeys.listFood(listId))
    const wasSetGearIds = gearSnapshot
      ? new Set(gearSnapshot.filter((i) => i[flag]).map((i) => i.id))
      : new Set<string>()
    const wasSetFoodIds = foodSnapshot
      ? new Set(foodSnapshot.items.filter((i) => i[flag]).map((i) => i.id))
      : new Set<string>()
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i[flag] ? { ...i, [flag]: false } : i)) : curr,
    )
    qc.setQueryData<ListFoodResponse>(queryKeys.listFood(listId), (curr) =>
      curr
        ? {
            ...curr,
            items: curr.items.map((i) => (i[flag] ? { ...i, [flag]: false } : i)),
          }
        : curr,
    )

    try {
      await serverReset(listId)
    } catch {
      // Restore only this flag on the ids we cleared. Any concurrent write to
      // the OTHER flag on those same rows survives untouched.
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr
          ? curr.map((i) => (wasSetGearIds.has(i.id) ? { ...i, [flag]: true } : i))
          : curr,
      )
      qc.setQueryData<ListFoodResponse>(queryKeys.listFood(listId), (curr) =>
        curr
          ? {
              ...curr,
              items: curr.items.map((i) =>
                wasSetFoodIds.has(i.id) ? { ...i, [flag]: true } : i,
              ),
            }
          : curr,
      )
      // Non-optimistic action: surface the failure and CONSUME it. The reset
      // handlers are called fire-and-forget from PackingProgress (() => void),
      // so rethrowing would be an unhandled rejection.
      showToast(failureToast, { type: 'error' })
    } finally {
      void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
      void qc.invalidateQueries({ queryKey: queryKeys.listFood(listId) })
    }
  }

  async function resetPacked() {
    await resetFlag(
      'isPacked',
      resetPackedForList,
      "Couldn't reset packed items. Please try again.",
    )
  }

  // Mirror of resetPacked for Ready Checks. Reset Ready and Reset Packed
  // are independent: clearing one MUST NOT clear the other on the cache.
  async function resetReady() {
    await resetFlag(
      'isReady',
      resetReadyForList,
      "Couldn't reset ready checks. Please try again.",
    )
  }

  return { resetPacked, resetReady }
}
