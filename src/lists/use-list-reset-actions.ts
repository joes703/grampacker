import { useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  resetPackedForList,
  resetReadyForList,
} from '../lib/queries'
import { showToast } from '../lib/toast'
import { arrayShape, fieldScopedCache } from '../lib/queries/field-scoped'
import { foodItemsShape } from '../lib/queries/food'
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
// Each reset clears BOTH caches: the server clears gear and food in
// one batch, so the optimistic clear, the rollback, and the invalidate all
// span ['list-items', listId] AND ['list-food', listId] - a reset that left
// the food checkboxes ticked would contradict what the server just did.
export function useListResetActions(listId: string) {
  const qc = useQueryClient()

  // The same field-scoped cache access as the per-row mutations, composed at
  // its lower level (cancel/getRows/mapRows) because a reset is a BULK clear:
  // the snapshot is the set of ids whose flag was set, not one row's fields.
  const gearCache = fieldScopedCache(
    qc,
    queryKeys.listItems(listId),
    arrayShape<ListItemWithGear>(),
  )
  const foodCache = fieldScopedCache(qc, queryKeys.listFood(listId), foodItemsShape)

  async function resetFlag(
    flag: 'isPacked' | 'isReady',
    serverReset: (listId: string) => Promise<void>,
    failureToast: string,
  ) {
    // Both caches cancel before either applies, so the two clears land
    // back-to-back in one synchronous step.
    await gearCache.cancel()
    await foodCache.cancel()
    const wasSetGearIds = new Set(
      (gearCache.getRows() ?? []).filter((i) => i[flag]).map((i) => i.id),
    )
    const wasSetFoodIds = new Set(
      (foodCache.getRows() ?? []).filter((i) => i[flag]).map((i) => i.id),
    )
    gearCache.mapRows((i) => (i[flag] ? { ...i, [flag]: false } : i))
    foodCache.mapRows((i) => (i[flag] ? { ...i, [flag]: false } : i))

    try {
      await serverReset(listId)
    } catch {
      // Restore only this flag on the ids we cleared. Any concurrent write to
      // the OTHER flag on those same rows survives untouched.
      gearCache.mapRows((i) => (wasSetGearIds.has(i.id) ? { ...i, [flag]: true } : i))
      foodCache.mapRows((i) => (wasSetFoodIds.has(i.id) ? { ...i, [flag]: true } : i))
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
