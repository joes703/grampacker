import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  dropFieldFromPendingChecks,
  incrementFailedAttempts,
  queuePendingPackedState,
  queuePendingReadyState,
  readPendingCheckStates,
  removePendingChecks,
  subscribeToPendingCheckStates,
  type PendingCheckState,
  type PendingPatch,
} from '../lib/offline-packed-queue'

// Drop an entry from the queue once it has thrown this many times in a
// row. Bounded retry stops one permanently-doomed entry (e.g. its gear
// row was deleted from another device) from blocking every entry behind
// it FIFO. 3 is balanced for this app: tolerates a transient
// reconnect/server hiccup or two, but doesn't trap the queue for long
// when an entry is genuinely unsync-able.
const MAX_FAILED_ATTEMPTS = 3

// State machine for the pack-mode offline check queue (both is_packed and
// is_ready). One queue, one sync loop, one set of generation-based
// race-handling guards — Ready Checks (added in 20260516010000) reuses
// every primitive that already shipped for Packed.
//
// Responsibilities:
//   - Hold the pending check state (per userId/listId) backed by
//     localStorage, including cross-tab `storage`-event subscription.
//   - Drive the sync effect that flushes the queue when online.
//   - Surface UI signals: packingSyncing, packingSyncBlocked.
//   - Provide imperatives: queueOfflinePackedState, queueOfflineReadyState,
//     retrySync, clearPackedForReset, clearReadyForReset.
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
//   it before AND after each `await`. clearPackedForReset() and
//   clearReadyForReset() each bump the generation and drop only their
//   own field from the pending queue — so a Reset Packed while Ready
//   ticks are pending must not clear the ready queue, and vice versa.

export type OfflinePackedSyncOptions = {
  userId: string
  listId: string
  online: boolean
  // Issues one PATCH carrying whichever fields were toggled offline. The
  // queue merges Ready + Packed for the same item so a single network
  // round-trip covers both — the patch shape from the queue is forwarded
  // verbatim.
  updateListItem: (itemId: string, patch: PendingPatch) => Promise<void>
  // Fires after a single item successfully syncs to the server. The
  // patch passed is the same one sent to the server, so the caller can
  // update cache for each field that synced. Caller typically updates
  // its TanStack cache here for immediate UI feedback during a partial-
  // failure scenario; subsequent invalidations refresh authoritative state.
  onItemSynced?: (itemId: string, patch: PendingPatch) => void
  // Fires after a sync run that made forward progress (at least one
  // entry synced or one entry dropped after hitting the retry cap).
  // Caller typically invalidates the list-items query. The queue may
  // still contain entries that are mid-retry; those re-attempt on the
  // next reconnect or Retry.
  onSyncComplete?: () => void
  // Fires when every attempted entry in this run threw without any
  // forward progress — the canonical "global outage" signal. Drives
  // the Retry banner. Caller typically surfaces a "couldn't sync,
  // retry" toast.
  onSyncError?: (error: unknown) => void
  // Fires after a sync run when one or more entries were dropped from
  // the queue because they crossed MAX_FAILED_ATTEMPTS. Count is the
  // number dropped in this run. Caller typically surfaces a low-drama
  // toast ("Couldn't sync N packing changes. Refresh to see the
  // latest state.") and recommends a refresh — the queue won't retry
  // those entries again so the cache may be stale until next refetch.
  onItemsDropped?: (count: number) => void
}

export type OfflinePackedSyncResult = {
  pendingCheckStates: PendingCheckState[]
  // Derived per-field views — useful so consumers don't have to know the
  // queue shape to apply state to the cache.
  pendingPackedStates: PendingCheckState[]
  pendingReadyStates: PendingCheckState[]
  packingSyncing: boolean
  packingSyncBlocked: boolean
  queueOfflinePackedState: (itemId: string, isPacked: boolean) => void
  queueOfflineReadyState: (itemId: string, isReady: boolean) => void
  retrySync: () => void
  // Caller invokes these from its Reset handlers before issuing the
  // server-side clear. Each bumps the sync generation so an in-flight
  // sync aborts before its next cache mutation, drops ONLY the relevant
  // field from the queue, and clears any prior blocked state.
  clearPackedForReset: () => void
  clearReadyForReset: () => void
}

export function useOfflinePackedSync({
  userId,
  listId,
  online,
  updateListItem,
  onItemSynced,
  onSyncComplete,
  onSyncError,
  onItemsDropped,
}: OfflinePackedSyncOptions): OfflinePackedSyncResult {
  const [pendingCheckStates, setPendingCheckStates] = useState<PendingCheckState[]>(() =>
    readPendingCheckStates(userId, listId),
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
  // Under-cap leftover gate. After a sync run that made progress but
  // left at least one entry with failedAttempts < MAX_FAILED_ATTEMPTS,
  // the queue still changes via setPendingCheckStates (the synced
  // entries are gone) — which would otherwise re-trigger the effect
  // and immediately auto-retry the failing leftovers in the same
  // reconnect. Bumping this ref bails the effect's guard so leftovers
  // wait for an explicit trigger (Retry click, fresh user toggle, or
  // an offline->online reconnect). Cleared by every such trigger.
  const packingSyncAutoRetryPausedRef = useRef(false)
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
  const onItemsDroppedRef = useRef(onItemsDropped)
  const updateListItemRef = useRef(updateListItem)
  useEffect(() => { onItemSyncedRef.current = onItemSynced })
  useEffect(() => { onSyncCompleteRef.current = onSyncComplete })
  useEffect(() => { onSyncErrorRef.current = onSyncError })
  useEffect(() => { onItemsDroppedRef.current = onItemsDropped })
  useEffect(() => { updateListItemRef.current = updateListItem })

  const markSyncBlocked = useCallback((blocked: boolean) => {
    packingSyncBlockedRef.current = blocked
    setPackingSyncBlocked(blocked)
    // Any caller clearing the block also implicitly resumes auto-retry.
    // Queue/retry/reset paths all funnel through this, so the pause ref
    // tracks `blocked` going false uniformly.
    if (!blocked) packingSyncAutoRetryPausedRef.current = false
  }, [])

  // Offline transition clears any prior sync-blocked state so the next
  // reconnect (or Retry click) attempts a fresh sync. The online-edge
  // also clears the under-cap pause: a reconnect is an explicit trigger
  // for leftovers from a prior partial run to re-attempt.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- offline transition is the natural trigger for clearing the blocker; alternative idioms (online-edge detection via a ref, or a route-level event handler) buy nothing here
    if (!online) markSyncBlocked(false)
    else packingSyncAutoRetryPausedRef.current = false
  }, [online, markSyncBlocked])

  useEffect(() => {
    if (!online) return
    if (
      packingSyncBlockedRef.current ||
      packingSyncAutoRetryPausedRef.current ||
      pendingCheckStates.length === 0 ||
      packingSyncInFlight.current
    ) return
    let cancelled = false

    async function syncPendingChecks() {
      packingSyncInFlight.current = true
      const generation = syncGeneration.current
      setPackingSyncing(true)
      const syncedIds: string[] = []
      const droppedIds: string[] = []
      let attempted = 0
      let lastErr: unknown = null
      function aborted() {
        return cancelled || syncGeneration.current !== generation
      }
      try {
        // Per-entry try/catch: a single failing entry must not block
        // entries behind it. Successes commit and dropped entries get
        // removed; entries still under the retry cap stay in the queue
        // for the next reconnect or Retry.
        for (const entry of pendingCheckStates) {
          if (aborted()) return
          attempted++
          try {
            // Forward the merged patch verbatim — one network call
            // covers both fields if both were toggled offline for this
            // item.
            await updateListItemRef.current(entry.itemId, entry.patch)
            if (aborted()) return
            onItemSyncedRef.current?.(entry.itemId, entry.patch)
            syncedIds.push(entry.itemId)
          } catch (err) {
            lastErr = err
            // incrementFailedAttempts returns the new count so we don't
            // re-read storage and race a concurrent fresh-toggle reset.
            const count = incrementFailedAttempts(userId, listId, entry.itemId)
            if (count >= MAX_FAILED_ATTEMPTS) droppedIds.push(entry.itemId)
            // else: leave in queue for the next attempt
          }
        }
        if (aborted()) return
        removePendingChecks(userId, listId, [...syncedIds, ...droppedIds])
        const remaining = readPendingCheckStates(userId, listId)
        setPendingCheckStates(remaining)
        const madeProgress = syncedIds.length > 0 || droppedIds.length > 0
        if (droppedIds.length > 0) {
          onItemsDroppedRef.current?.(droppedIds.length)
        }
        if (madeProgress) {
          onSyncCompleteRef.current?.()
          // Under-cap leftovers must NOT auto-retry on the
          // setPendingCheckStates-driven re-fire of this effect. They
          // wait for the next explicit trigger (Retry click, fresh
          // toggle, or reconnect edge). Without this gate, one
          // reconnect can burn multiple failedAttempts in a row for an
          // entry that just transiently failed alongside a successor.
          if (remaining.length > 0) packingSyncAutoRetryPausedRef.current = true
        } else if (attempted > 0) {
          // Every attempted entry is still in the queue waiting for the
          // next reconnect. Surface the global Retry banner so the user
          // can force another pass without queueing a new toggle.
          markSyncBlocked(true)
          onSyncErrorRef.current?.(lastErr)
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

    syncPendingChecks()
    return () => {
      cancelled = true
    }
  }, [online, pendingCheckStates, userId, listId, packingSyncRetryNonce, markSyncBlocked])

  // Cross-tab consistency. When another tab queues or syncs a pending
  // check, refresh local state so the UI matches what's on disk.
  useEffect(() => {
    return subscribeToPendingCheckStates(userId, listId, setPendingCheckStates)
  }, [userId, listId])

  const queueOfflinePackedState = useCallback(
    (itemId: string, isPacked: boolean) => {
      const entry = queuePendingPackedState(userId, listId, itemId, isPacked)
      // Clear any prior sync-blocked state so the next reconnect (or
      // a Retry click) attempts a fresh sync that includes this entry.
      markSyncBlocked(false)
      setPendingCheckStates((curr) => [
        ...curr.filter((pending) => pending.itemId !== itemId),
        entry,
      ])
    },
    [userId, listId, markSyncBlocked],
  )

  const queueOfflineReadyState = useCallback(
    (itemId: string, isReady: boolean) => {
      const entry = queuePendingReadyState(userId, listId, itemId, isReady)
      markSyncBlocked(false)
      setPendingCheckStates((curr) => [
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

  const clearFieldForReset = useCallback(
    (field: 'is_packed' | 'is_ready') => {
      // Invalidate any in-flight sync loop. Bumping syncGeneration before
      // we touch the queue means the loop's pre/post-await aborted()
      // checks trip — so the post-resolution per-item callback does NOT
      // fire for an item the user just reset.
      syncGeneration.current += 1
      dropFieldFromPendingChecks(userId, listId, field)
      setPendingCheckStates(readPendingCheckStates(userId, listId))
      markSyncBlocked(false)
    },
    [userId, listId, markSyncBlocked],
  )

  const clearPackedForReset = useCallback(() => clearFieldForReset('is_packed'), [clearFieldForReset])
  const clearReadyForReset = useCallback(() => clearFieldForReset('is_ready'), [clearFieldForReset])

  // Per-field views so consumers can apply state without inspecting the
  // queue's patch shape. Empty-pending shortcut keeps the reference
  // stable across no-op renders.
  const pendingPackedStates = useMemo(
    () => pendingCheckStates.filter((e) => e.patch.is_packed !== undefined),
    [pendingCheckStates],
  )
  const pendingReadyStates = useMemo(
    () => pendingCheckStates.filter((e) => e.patch.is_ready !== undefined),
    [pendingCheckStates],
  )

  return {
    pendingCheckStates,
    pendingPackedStates,
    pendingReadyStates,
    packingSyncing,
    packingSyncBlocked,
    queueOfflinePackedState,
    queueOfflineReadyState,
    retrySync,
    clearPackedForReset,
    clearReadyForReset,
  }
}
