import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, resetPackedForList, resetReadyForList } from '../lib/queries'
import { showToast } from '../lib/toast'
import type { ListItemWithGear } from '../lib/types'

// Pack/Ready reset actions for ListDetailPage, lifted out of the page as the
// first ListDetailPage extraction slice (plan 2026-07-01-list-detail-f3). These
// are hand-rolled async actions (NOT useMutation): each owns its own cancel/
// snapshot/optimistic-clear/rollback/invalidate lifecycle on the per-list
// ['list-items', listId] cache, and resetPacked additionally resets the food
// projection's packed state after the gear reset settles.
//
// Field-scoped snapshot + rollback. resetPacked and resetReady are genuinely
// independent (different fields, different RPCs), so they must be safe to
// interleave. The earlier whole-row `previous` snapshot wasn't: a rollback
// restored every field on the row, so a failing reset would stomp the other
// reset's optimistic clear (or its already-server-committed clear before
// invalidate refetched).
//
// The fix: each reset only snapshots the ids whose own field was true at the
// moment of clear, and on failure flips ONLY that field back. The other reset's
// writes pass through untouched. No mutex needed; the operations compose.
//
// `resetPackedFoods` is the food-projection reset handle (from useFoodProjection);
// the page keeps owning the PackingProgress wiring, per-item toggles, and the
// ready-checks-enabled toggle.
export function useListResetActions(listId: string, resetPackedFoods: () => Promise<void>) {
  const qc = useQueryClient()

  async function resetPacked() {
    // Optimistic clear - flip is_packed=false on every cached item so the UI
    // updates immediately, then issue a single PATCH and invalidate to settle.
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const snapshot = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    const wasPackedIds = snapshot
      ? new Set(snapshot.filter((i) => i.is_packed).map((i) => i.id))
      : new Set<string>()
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.is_packed ? { ...i, is_packed: false } : i)) : curr,
    )
    try {
      await resetPackedForList(listId)
    } catch {
      // Restore only is_packed=true on the ids we cleared. Any concurrent
      // resetReady write on those same rows survives because we never
      // touch is_ready here.
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr ? curr.map((i) => (wasPackedIds.has(i.id) ? { ...i, is_packed: true } : i)) : curr,
      )
      // Non-optimistic action: surface the failure and CONSUME it. onReset() is
      // called fire-and-forget from PackingProgress (() => void), so rethrowing
      // would be an unhandled rejection.
      showToast("Couldn't reset packed items. Please try again.", { type: 'error' })
    } finally {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    }
    await resetPackedFoods()
  }

  // Mirror of resetPacked for Ready Checks. Reset Ready and Reset Packed
  // are independent: clearing one MUST NOT clear the other on the cache.
  async function resetReady() {
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const snapshot = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    const wasReadyIds = snapshot
      ? new Set(snapshot.filter((i) => i.is_ready).map((i) => i.id))
      : new Set<string>()
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.is_ready ? { ...i, is_ready: false } : i)) : curr,
    )
    try {
      await resetReadyForList(listId)
    } catch {
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr ? curr.map((i) => (wasReadyIds.has(i.id) ? { ...i, is_ready: true } : i)) : curr,
      )
      showToast("Couldn't reset ready checks. Please try again.", { type: 'error' })
    } finally {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    }
  }

  return { resetPacked, resetReady }
}
