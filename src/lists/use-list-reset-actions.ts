import { useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
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
export function useListResetActions(listId: string) {
  const qc = useQueryClient()

  async function resetPacked() {
    // Optimistic clear - flip isPacked=false on every cached item so the UI
    // updates immediately, then issue the call and invalidate to settle.
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const snapshot = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    const wasPackedIds = snapshot
      ? new Set(snapshot.filter((i) => i.isPacked).map((i) => i.id))
      : new Set<string>()
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.isPacked ? { ...i, isPacked: false } : i)) : curr,
    )

    try {
      await resetPackedForList(listId)
    } catch {
      // Restore only isPacked=true on the ids we cleared. Any concurrent
      // resetReady write on those same rows survives because we never
      // touch isReady here.
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr ? curr.map((i) => (wasPackedIds.has(i.id) ? { ...i, isPacked: true } : i)) : curr,
      )
      // Non-optimistic action: surface the failure and CONSUME it. onReset() is
      // called fire-and-forget from PackingProgress (() => void), so rethrowing
      // would be an unhandled rejection.
      showToast("Couldn't reset packed items. Please try again.", { type: 'error' })
    }
    void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
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
