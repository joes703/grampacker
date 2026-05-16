// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOfflinePackedSync } from './use-offline-packed-sync'

const USER_ID = 'user-1'
const LIST_ID = 'list-1'
const STORAGE_KEY = 'grampacker:pending-checks:v2'
const storage = new Map<string, string>()

// Match the helper's mock localStorage so module-internal reads land in
// a Map we control, and dispatch matches a real browser's storage event
// (key === storage key, newValue === post-change payload).
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value)
  },
  removeItem: (key: string) => {
    storage.delete(key)
  },
  clear: () => {
    storage.clear()
  },
})

// Helper that returns a Promise alongside its resolve/reject so tests can
// drive `updateListItem` deterministically across `await` boundaries.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Default options used by most tests. Tests override what they care about.
function defaultOptions(overrides: Partial<Parameters<typeof useOfflinePackedSync>[0]> = {}) {
  return {
    userId: USER_ID,
    listId: LIST_ID,
    online: false,
    updateListItem: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('useOfflinePackedSync', () => {
  beforeEach(() => {
    storage.clear()
  })

  afterEach(() => {
    // Without globals:true in vitest config, RTL's auto-cleanup doesn't
    // fire between tests. Explicit cleanup unmounts hooks so prior
    // subscribers (window 'storage' listeners) don't leak across tests.
    cleanup()
    vi.useRealTimers()
  })

  it('starts with an empty queue and no syncing/blocked state', () => {
    const { result } = renderHook(() => useOfflinePackedSync(defaultOptions()))
    expect(result.current.pendingPackedStates).toEqual([])
    expect(result.current.pendingReadyStates).toEqual([])
    expect(result.current.packingSyncing).toBe(false)
    expect(result.current.packingSyncBlocked).toBe(false)
  })

  it('queues an offline tick into state and storage', () => {
    const { result } = renderHook(() => useOfflinePackedSync(defaultOptions()))
    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
    })
    expect(result.current.pendingPackedStates.map((p) => p.itemId)).toEqual(['item-1'])
    expect(storage.size).toBeGreaterThan(0)
  })

  it('flushes the queue when online and fires per-item and complete callbacks', async () => {
    const onItemSynced = vi.fn()
    const onSyncComplete = vi.fn()
    const updateListItem = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ online }: { online: boolean }) =>
        useOfflinePackedSync(defaultOptions({ online, updateListItem, onItemSynced, onSyncComplete })),
      { initialProps: { online: false } },
    )

    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
      result.current.queueOfflinePackedState('item-2', true)
    })

    rerender({ online: true })

    await waitFor(() => expect(onSyncComplete).toHaveBeenCalledTimes(1))
    expect(updateListItem).toHaveBeenCalledTimes(2)
    expect(onItemSynced).toHaveBeenCalledWith('item-1', { is_packed: true })
    expect(onItemSynced).toHaveBeenCalledWith('item-2', { is_packed: true })
    expect(result.current.pendingPackedStates).toEqual([])
    expect(result.current.packingSyncing).toBe(false)
    expect(result.current.packingSyncBlocked).toBe(false)
  })

  it('blocks and surfaces onSyncError when updateListItem rejects', async () => {
    const onSyncError = vi.fn()
    const updateListItem = vi.fn(async () => {
      throw new Error('server fail')
    })
    const { result, rerender } = renderHook(
      ({ online }: { online: boolean }) =>
        useOfflinePackedSync(defaultOptions({ online, updateListItem, onSyncError })),
      { initialProps: { online: false } },
    )

    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
    })
    rerender({ online: true })

    await waitFor(() => expect(result.current.packingSyncBlocked).toBe(true))
    expect(onSyncError).toHaveBeenCalledTimes(1)
    expect(result.current.pendingPackedStates.map((p) => p.itemId)).toEqual(['item-1'])
    expect(result.current.packingSyncing).toBe(false)
  })

  it('retrySync clears the blocker and re-attempts the sync', async () => {
    let attempt = 0
    const updateListItem = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('boom')
    })
    const onSyncComplete = vi.fn()
    const { result, rerender } = renderHook(
      ({ online }: { online: boolean }) =>
        useOfflinePackedSync(defaultOptions({ online, updateListItem, onSyncComplete })),
      { initialProps: { online: false } },
    )

    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
    })
    rerender({ online: true })

    await waitFor(() => expect(result.current.packingSyncBlocked).toBe(true))

    act(() => {
      result.current.retrySync()
    })

    await waitFor(() => expect(onSyncComplete).toHaveBeenCalledTimes(1))
    expect(result.current.packingSyncBlocked).toBe(false)
    expect(result.current.pendingPackedStates).toEqual([])
  })

  it('clears the blocker on an offline transition', async () => {
    const updateListItem = vi.fn(async () => {
      throw new Error('boom')
    })
    const { result, rerender } = renderHook(
      ({ online }: { online: boolean }) =>
        useOfflinePackedSync(defaultOptions({ online, updateListItem })),
      { initialProps: { online: false } },
    )

    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
    })
    rerender({ online: true })
    await waitFor(() => expect(result.current.packingSyncBlocked).toBe(true))

    rerender({ online: false })
    await waitFor(() => expect(result.current.packingSyncBlocked).toBe(false))
  })

  it('clearPackedForReset aborts an in-flight sync before its post-await callbacks fire', async () => {
    // Regression test for the reset/sync race fixed in 20260515: a Reset
    // Packed click while item-1's update is in flight must NOT let
    // onItemSynced fire for item-1, and must NOT attempt item-2.
    const onItemSynced = vi.fn()
    const onSyncComplete = vi.fn()
    const item1 = deferred<void>()
    const calls: string[] = []
    const updateListItem = vi.fn(async (itemId: string) => {
      calls.push(itemId)
      if (itemId === 'item-1') return item1.promise
    })

    const { result, rerender } = renderHook(
      ({ online }: { online: boolean }) =>
        useOfflinePackedSync(defaultOptions({ online, updateListItem, onItemSynced, onSyncComplete })),
      { initialProps: { online: false } },
    )

    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
      result.current.queueOfflinePackedState('item-2', true)
    })
    rerender({ online: true })

    // updateListItem for item-1 fires immediately; await its registration.
    await waitFor(() => expect(updateListItem).toHaveBeenCalledWith('item-1', { is_packed: true }))

    // User clicks Reset before item-1's promise resolves.
    act(() => {
      result.current.clearPackedForReset()
    })

    // Now resolve item-1's pending updateListItem promise. The loop's
    // post-await aborted() check should trip, so onItemSynced must NOT
    // fire for item-1 and item-2 must never be attempted.
    await act(async () => {
      item1.resolve()
      // Yield to microtasks so the post-await check runs.
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.packingSyncing).toBe(false))

    expect(onItemSynced).not.toHaveBeenCalled()
    expect(onSyncComplete).not.toHaveBeenCalled()
    expect(calls).toEqual(['item-1'])
    expect(result.current.pendingPackedStates).toEqual([])
  })

  it('clearPackedForReset drops the queue from storage as well as state', () => {
    const { result } = renderHook(() => useOfflinePackedSync(defaultOptions()))
    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
      result.current.queueOfflinePackedState('item-2', true)
    })
    expect(storage.size).toBeGreaterThan(0)

    act(() => {
      result.current.clearPackedForReset()
    })

    expect(result.current.pendingPackedStates).toEqual([])
    expect(storage.size).toBe(0)
  })

  it('refreshes state from a cross-tab storage event', async () => {
    const { result } = renderHook(() => useOfflinePackedSync(defaultOptions()))
    expect(result.current.pendingPackedStates).toEqual([])

    // Simulate another tab writing the queue, then firing the storage
    // event. The hook's subscription should read storage and update state.
    const entry = {
      userId: USER_ID,
      listId: LIST_ID,
      itemId: 'from-other-tab',
      patch: { is_packed: true },
      updated_at: Date.now(),
    }
    storage.set(STORAGE_KEY, JSON.stringify({ 'key': entry }))

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })

    await waitFor(() =>
      expect(result.current.pendingPackedStates.map((p) => p.itemId)).toEqual(['from-other-tab']),
    )
  })

  it('queues a ready tick and surfaces it on pendingReadyStates only', () => {
    const { result } = renderHook(() => useOfflinePackedSync(defaultOptions()))
    act(() => {
      result.current.queueOfflineReadyState('item-1', true)
    })
    expect(result.current.pendingReadyStates.map((p) => p.itemId)).toEqual(['item-1'])
    expect(result.current.pendingPackedStates).toEqual([])
  })

  it('clearReadyForReset clears only ready; pending packed survives', () => {
    const { result } = renderHook(() => useOfflinePackedSync(defaultOptions()))
    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
      result.current.queueOfflineReadyState('item-1', true)
    })
    // One merged entry carrying both fields.
    expect(result.current.pendingPackedStates).toHaveLength(1)
    expect(result.current.pendingReadyStates).toHaveLength(1)

    act(() => {
      result.current.clearReadyForReset()
    })

    expect(result.current.pendingReadyStates).toEqual([])
    expect(result.current.pendingPackedStates.map((p) => p.itemId)).toEqual(['item-1'])
  })

  it('clearPackedForReset clears only packed; pending ready survives', () => {
    const { result } = renderHook(() => useOfflinePackedSync(defaultOptions()))
    act(() => {
      result.current.queueOfflinePackedState('item-1', true)
      result.current.queueOfflineReadyState('item-2', true)
    })

    act(() => {
      result.current.clearPackedForReset()
    })

    expect(result.current.pendingPackedStates).toEqual([])
    expect(result.current.pendingReadyStates.map((p) => p.itemId)).toEqual(['item-2'])
  })

  it('flushes ready + packed for the same item in one PATCH', async () => {
    const onItemSynced = vi.fn()
    const updateListItem = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ online }: { online: boolean }) =>
        useOfflinePackedSync(defaultOptions({ online, updateListItem, onItemSynced })),
      { initialProps: { online: false } },
    )

    act(() => {
      result.current.queueOfflineReadyState('item-1', true)
      result.current.queueOfflinePackedState('item-1', true)
    })
    rerender({ online: true })

    await waitFor(() => expect(updateListItem).toHaveBeenCalledTimes(1))
    expect(updateListItem).toHaveBeenCalledWith('item-1', { is_ready: true, is_packed: true })
    expect(onItemSynced).toHaveBeenCalledWith('item-1', { is_ready: true, is_packed: true })
  })
})
