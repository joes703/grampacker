import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPendingPackedStates,
  queuePendingPackedState,
  readPendingPackedStates,
  removePendingPackedStates,
  type PendingPackedState,
} from './offline-packed-queue'
import type { ListItemWithGear } from './types'

const STORAGE_KEY = 'grampacker:pending-packed:v1'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

const USER_ID = 'user-1'
const LIST_ID = 'list-1'
const storage = new Map<string, string>()

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

function item(id: string, isPacked: boolean): ListItemWithGear {
  return {
    id,
    user_id: USER_ID,
    list_id: LIST_ID,
    gear_item_id: `gear-${id}`,
    quantity: 1,
    is_worn: false,
    is_consumable: false,
    is_packed: isPacked,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    gear_item: {
      id: `gear-${id}`,
      name: `Item ${id}`,
      description: null,
      weight_grams: 10,
      category_id: null,
      status: 'active',
    },
  }
}

describe('offline packed queue', () => {
  beforeEach(() => {
    storage.clear()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores only the latest packed state per list item', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', false)

    expect(readPendingPackedStates(USER_ID, LIST_ID)).toEqual([
      {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        is_packed: false,
        updated_at: new Date('2026-01-01T00:00:01.000Z').getTime(),
      },
    ])
  })

  it('filters pending states by user and list', () => {
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    queuePendingPackedState(USER_ID, 'other-list', 'item-2', true)
    queuePendingPackedState('other-user', LIST_ID, 'item-3', true)

    expect(readPendingPackedStates(USER_ID, LIST_ID).map((entry) => entry.itemId)).toEqual(['item-1'])
  })

  it('removes synced pending states', () => {
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    queuePendingPackedState(USER_ID, LIST_ID, 'item-2', true)

    removePendingPackedStates(USER_ID, LIST_ID, ['item-1'])

    expect(readPendingPackedStates(USER_ID, LIST_ID).map((entry) => entry.itemId)).toEqual(['item-2'])
  })

  it('overlays pending packed states onto list items', () => {
    const items = [item('item-1', false), item('item-2', true)]
    const pending: PendingPackedState[] = [
      {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        is_packed: true,
        updated_at: 1,
      },
    ]

    const next = applyPendingPackedStates(items, pending)

    expect(next[0]?.is_packed).toBe(true)
    expect(next[1]).toBe(items[1])
  })

  it('returns the same items reference when the pending list is empty', () => {
    // Memoization downstream (useGroupedListItems, sharedGroupProps memo)
    // depends on this invariant.
    const items = [item('item-1', false), item('item-2', true)]
    expect(applyPendingPackedStates(items, [])).toBe(items)
  })

  it('returns the same items reference when pending values match existing state', () => {
    const items = [item('item-1', false), item('item-2', true)]
    const pending: PendingPackedState[] = [
      { userId: USER_ID, listId: LIST_ID, itemId: 'item-1', is_packed: false, updated_at: 1 },
      { userId: USER_ID, listId: LIST_ID, itemId: 'item-2', is_packed: true, updated_at: 2 },
    ]
    expect(applyPendingPackedStates(items, pending)).toBe(items)
  })

  it('returns [] when localStorage contains malformed JSON', () => {
    storage.set(STORAGE_KEY, '{not valid json')
    expect(readPendingPackedStates(USER_ID, LIST_ID)).toEqual([])
  })

  it('returns [] when localStorage contains a non-object root', () => {
    storage.set(STORAGE_KEY, JSON.stringify([1, 2, 3]))
    expect(readPendingPackedStates(USER_ID, LIST_ID)).toEqual([])
  })

  it('skips malformed entries within a valid object root', () => {
    // The object root is structurally fine, but one entry is missing
    // required fields. The valid sibling should still come through.
    const stored = {
      'user-1:list-1:item-1': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        is_packed: true,
        updated_at: Date.now(),
      },
      'broken': { userId: USER_ID }, // missing fields
    }
    storage.set(STORAGE_KEY, JSON.stringify(stored))
    const result = readPendingPackedStates(USER_ID, LIST_ID)
    expect(result.map((entry) => entry.itemId)).toEqual(['item-1'])
  })

  it('prunes entries older than the TTL on read', () => {
    // Seed storage directly with one fresh and one stale entry. After a
    // read, the stale entry should be dropped and the write-back should
    // remove it from the underlying storage as well.
    const now = Date.now()
    const stored = {
      'user-1:list-1:fresh': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'fresh',
        is_packed: true,
        updated_at: now - ONE_DAY_MS,
      },
      'user-1:list-1:stale': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'stale',
        is_packed: true,
        updated_at: now - 365 * ONE_DAY_MS,
      },
    }
    storage.set(STORAGE_KEY, JSON.stringify(stored))

    const result = readPendingPackedStates(USER_ID, LIST_ID)
    expect(result.map((entry) => entry.itemId)).toEqual(['fresh'])

    // Storage was rewritten without the stale entry.
    const persisted = JSON.parse(storage.get(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(Object.keys(persisted)).toEqual(['user-1:list-1:fresh'])
  })

  it('does not write back when nothing was pruned', () => {
    // A clean read should be a pure read. Confirm by snapshotting the
    // raw payload before and after.
    const now = Date.now()
    const stored = {
      'user-1:list-1:item-1': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        is_packed: true,
        updated_at: now,
      },
    }
    const raw = JSON.stringify(stored)
    storage.set(STORAGE_KEY, raw)
    readPendingPackedStates(USER_ID, LIST_ID)
    expect(storage.get(STORAGE_KEY)).toBe(raw)
  })

  it('clears the storage key when removing the last entry', () => {
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    expect(storage.get(STORAGE_KEY)).toBeDefined()
    removePendingPackedStates(USER_ID, LIST_ID, ['item-1'])
    expect(storage.get(STORAGE_KEY)).toBeUndefined()
  })
})
