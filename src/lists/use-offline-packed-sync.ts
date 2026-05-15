import { useCallback, useEffect, useRef, useState } from 'react'
import {
  queuePendingPackedState,
  readPendingPackedStates,
  removePendingPackedStates,
  subscribeToPendingPackedStates,
  type PendingPackedState,
} from '../lib/offline-packed-queue'

// State machine for the pack-mode offline checkmark queue.
//
// Responsibilities:
//   - Hold the pending checkmark state (per userId/listId) backed by
//     localStorage, including cross-tab `storage`-event subscription.
//   - Drive the sync effect that flushes the queue when online.
//   - Surface UI signals: packingSyncing, packingSyncBlocked.
//   - Provide imperatives: queueOfflinePackedState, retrySync,
//     clearForReset.
//
// Non-responsibilities:
//   - Cache management. The hook exposes per-item `onItemSynced` and
//     batch `onSyncComplete` / `onSyncError` callbacks so the consumer
//     can update TanStack Query (setQueryData / invalidateQueries) and
//     surface toasts. Keeping QueryClient out of the hook lets the tests
//     run without a QueryClientProvider wrapper.
//
// Reset/sync race handling:
//   The sync loop captures a generation snapshot at entry and checks
//   it before AND after each `await`. clearForReset() bumps the
//   generation so an in-flight sync's post-resolution per-item callback
//   does NOT fire for an item the user just reset.

export type OfflinePackedSyncOptions = {
  userId: string
  listId: string
  online: boolean
  updateListItem: (itemId: string, patch: { is_packed: boolean }) => Promise<void>
  // Fires after a single item successfully syncs to the server. Caller
  // typically updates its TanStack cache here for immediate UI feedback
  // during a partial-failure scenario; subsequent invalidations refresh
  // authoritative state.
  onItemSynced?: (itemId: string, isPacked: boolean) => void
  // Fires after the whole queue is drained (success path). Caller
  // typically invalidates the list-items query.
  onSyncComplete?: () => void
  // Fires after a sync attempt errors. Caller typically surfaces a toast.
  onSyncError?: (error: unknown) => void
}

export type OfflinePackedSyncResult = {
  pendingPackedStates: PendingPackedState[]
  packingSyncing: boolean
  packingSyncBlocked: boolean
  queueOfflinePackedState: (itemId: string, isPacked: boolean) => void
  retrySync: () => void
  // Caller invokes this from its Reset handler before issuing the
  // server-side clear. Bumps the sync generation so an in-flight sync
  // aborts before its next cache mutation, drops the queue entirely,
  // and clears any prior blocked state.
  clearForReset: () => void
}

export function useOfflinePackedSync({
  userId,
  listId,
  online,
  updateListItem,
  onItemSynced,
  onSyncComplete,
  onSyncError,
}: OfflinePackedSyncOptions): OfflinePackedSyncResult {
  const [pendingPackedStates, setPendingPackedStates] = useState<PendingPackedState[]>(() =>
    readPendingPackedStates(userId, listId),
  )
  const [packingSyncing, setPackingSyncing] = useState(false)
  // Parallel handles on "sync is blocked":
  //   - packingSyncBlockedRef drives the sync effect's early-return
  //     guard; staying out of deps avoids a read+write loop inside the
  //     same effect.
  //   - packingSyncBlocked (state) drives the visible Retry affordance.
  // markSyncBlocked keeps the two in sync.
  // packingSyncRetryNonce is the explicit retry signal: bumping it
  // changes the effect's deps so a Retry click re-runs the effect even
  // when the underlying state machine is otherwise unchanged.
  const [packingSyncBlocked, setPackingSyncBlocked] = useState(false)
  const packingSyncBlockedRef = useRef(false)
  const [packingSyncRetryNonce, setPackingSyncRetryNonce] = useState(0)
  const packingSyncInFlight = useRef(false)
  // See the file header for the reset/sync race contract.
  const syncGeneration = useRef(0)
  // Latest callbacks captured in refs so the sync effect's deps don't
  // churn every render. The consumer's callbacks are typically
  // closure-bound on each render (e.g. arrow funcs in JSX), so depending
  // on them directly would re-run the effect needlessly.
  const onItemSyncedRef = useRef(onItemSynced)
  const onSyncCompleteRef = useRef(onSyncComplete)
  const onSyncErrorRef = useRef(onSyncError)
  const updateListItemRef = useRef(updateListItem)
  useEffect(() => { onItemSyncedRef.current = onItemSynced })
  useEffect(() => { onSyncCompleteRef.current = onSyncComplete })
  useEffect(() => { onSyncErrorRef.current = onSyncError })
  useEffect(() => { updateListItemRef.current = updateListItem })

  const markSyncBlocked = useCallback((blocked: boolean) => {
    packingSyncBlockedRef.current = blocked
    setPackingSyncBlocked(blocked)
  }, [])

  // Offline transition clears any prior sync-blocked state so the next
  // reconnect (or Retry click) attempts a fresh sync.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- offline transition is the natural trigger for clearing the blocker; alternative idioms (online-edge detection via a ref, or a route-level event handler) buy nothing here
    if (!online) markSyncBlocked(false)
  }, [online, markSyncBlocked])

  useEffect(() => {
    if (!online) return
    if (packingSyncBlockedRef.current || pendingPackedStates.length === 0 || packingSyncInFlight.current) return
    let cancelled = false

    async function syncPendingPackedStates() {
      packingSyncInFlight.current = true
      const generation = syncGeneration.current
      setPackingSyncing(true)
      const syncedIds: string[] = []
      function aborted() {
        return cancelled || syncGeneration.current !== generation
      }
      try {
        for (const entry of pendingPackedStates) {
          if (aborted()) return
          await updateListItemRef.current(entry.itemId, { is_packed: entry.is_packed })
          if (aborted()) return
          onItemSyncedRef.current?.(entry.itemId, entry.is_packed)
          syncedIds.push(entry.itemId)
        }
        removePendingPackedStates(userId, listId, syncedIds)
        if (!aborted()) {
          setPendingPackedStates(readPendingPackedStates(userId, listId))
          onSyncCompleteRef.current?.()
        }
      } catch (err) {
        removePendingPackedStates(userId, listId, syncedIds)
        if (!aborted()) {
          setPendingPackedStates(readPendingPackedStates(userId, listId))
          markSyncBlocked(true)
          onSyncErrorRef.current?.(err)
        }
      } finally {
        // Unconditional clear: leaving packingSyncing=true after the
        // cleanup (cancelled === true case) leaks the "Syncing..."
        // banner past the effect re-run when the new effect run doesn't
        // enter the sync body. setState on an unmounted component is a
        // no-op in React 19.
        setPackingSyncing(false)
        packingSyncInFlight.current = false
      }
    }

    syncPendingPackedStates()
    return () => {
      cancelled = true
    }
  }, [online, pendingPackedStates, userId, listId, packingSyncRetryNonce, markSyncBlocked])

  // Cross-tab consistency. When another tab queues or syncs a pending
  // checkmark, refresh local state so the UI matches what's on disk.
  useEffect(() => {
    return subscribeToPendingPackedStates(userId, listId, setPendingPackedStates)
  }, [userId, listId])

  const queueOfflinePackedState = useCallback(
    (itemId: string, isPacked: boolean) => {
      const entry = queuePendingPackedState(userId, listId, itemId, isPacked)
      // Clear any prior sync-blocked state so the next reconnect (or
      // a Retry click) attempts a fresh sync that includes this entry.
      markSyncBlocked(false)
      setPendingPackedStates((curr) => [
        ...curr.filter((pending) => pending.itemId !== itemId),
        entry,
      ])
    },
    [userId, listId, markSyncBlocked],
  )

  const retrySync = useCallback(() => {
    // Clear both handles AND bump the nonce so the sync effect re-runs.
    markSyncBlocked(false)
    setPackingSyncRetryNonce((n) => n + 1)
  }, [markSyncBlocked])

  const clearForReset = useCallback(() => {
    // Invalidate any in-flight sync loop. Bumping syncGeneration before
    // we touch the queue means the loop's pre/post-await aborted() checks
    // will trip.
    syncGeneration.current += 1
    const stored = readPendingPackedStates(userId, listId)
    if (stored.length > 0) {
      removePendingPackedStates(userId, listId, stored.map((p) => p.itemId))
    }
    setPendingPackedStates([])
    markSyncBlocked(false)
  }, [userId, listId, markSyncBlocked])

  return {
    pendingPackedStates,
    packingSyncing,
    packingSyncBlocked,
    queueOfflinePackedState,
    retrySync,
    clearForReset,
  }
}
