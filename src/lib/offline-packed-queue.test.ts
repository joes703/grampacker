import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPendingPackedStates,
  applyPendingReadyStates,
  dropFieldFromPendingChecks,
  queuePendingPackedState,
  queuePendingReadyState,
  readPendingCheckStates,
  removePendingChecks,
  type PendingCheckState,
} from './offline-packed-queue'
import type { ListItemWithGear } from './types'

const STORAGE_KEY = 'grampacker:pending-checks:v2'
const STORAGE_KEY_V1 = 'grampacker:pending-packed:v1'
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

function item(id: string, overrides: Partial<ListItemWithGear> = {}): ListItemWithGear {
  return {
    id,
    user_id: USER_ID,
    list_id: LIST_ID,
    gear_item_id: `gear-${id}`,
    quantity: 1,
    is_worn: false,
    is_consumable: false,
    is_packed: false,
    is_ready: false,
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
    ...overrides,
  }
}

describe('offline check queue (packed)', () => {
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

    expect(readPendingCheckStates(USER_ID, LIST_ID)).toEqual([
      {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        patch: { is_packed: false },
        updated_at: new Date('2026-01-01T00:00:01.000Z').getTime(),
        failedAttempts: 0,
      },
    ])
  })

  it('filters pending states by user and list', () => {
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    queuePendingPackedState(USER_ID, 'other-list', 'item-2', true)
    queuePendingPackedState('other-user', LIST_ID, 'item-3', true)

    expect(readPendingCheckStates(USER_ID, LIST_ID).map((entry) => entry.itemId)).toEqual(['item-1'])
  })

  it('removes synced pending states', () => {
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    queuePendingPackedState(USER_ID, LIST_ID, 'item-2', true)

    removePendingChecks(USER_ID, LIST_ID, ['item-1'])

    expect(readPendingCheckStates(USER_ID, LIST_ID).map((entry) => entry.itemId)).toEqual(['item-2'])
  })

  it('overlays pending packed states onto list items', () => {
    const items = [item('item-1', { is_packed: false }), item('item-2', { is_packed: true })]
    const pending: PendingCheckState[] = [
      {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        patch: { is_packed: true },
        updated_at: 1,
        failedAttempts: 0,
      },
    ]

    const next = applyPendingPackedStates(items, pending)

    expect(next[0]?.is_packed).toBe(true)
    expect(next[1]).toBe(items[1])
  })

  it('returns the same items reference when the pending list is empty', () => {
    const items = [item('item-1'), item('item-2', { is_packed: true })]
    expect(applyPendingPackedStates(items, [])).toBe(items)
  })

  it('returns the same items reference when pending values match existing state', () => {
    const items = [item('item-1', { is_packed: false }), item('item-2', { is_packed: true })]
    const pending: PendingCheckState[] = [
      { userId: USER_ID, listId: LIST_ID, itemId: 'item-1', patch: { is_packed: false }, updated_at: 1, failedAttempts: 0 },
      { userId: USER_ID, listId: LIST_ID, itemId: 'item-2', patch: { is_packed: true }, updated_at: 2, failedAttempts: 0 },
    ]
    expect(applyPendingPackedStates(items, pending)).toBe(items)
  })

  it('returns [] when localStorage contains malformed JSON', () => {
    storage.set(STORAGE_KEY, '{not valid json')
    expect(readPendingCheckStates(USER_ID, LIST_ID)).toEqual([])
  })

  it('returns [] when localStorage contains a non-object root', () => {
    storage.set(STORAGE_KEY, JSON.stringify([1, 2, 3]))
    expect(readPendingCheckStates(USER_ID, LIST_ID)).toEqual([])
  })

  it('skips malformed entries within a valid object root', () => {
    const stored = {
      'user-1:list-1:item-1': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        patch: { is_packed: true },
        updated_at: Date.now(),
      },
      'broken': { userId: USER_ID }, // missing fields
    }
    storage.set(STORAGE_KEY, JSON.stringify(stored))
    const result = readPendingCheckStates(USER_ID, LIST_ID)
    expect(result.map((entry) => entry.itemId)).toEqual(['item-1'])
  })

  it('prunes entries older than the TTL on read', () => {
    const now = Date.now()
    const stored = {
      'user-1:list-1:fresh': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'fresh',
        patch: { is_packed: true },
        updated_at: now - ONE_DAY_MS,
      },
      'user-1:list-1:stale': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'stale',
        patch: { is_packed: true },
        updated_at: now - 365 * ONE_DAY_MS,
      },
    }
    storage.set(STORAGE_KEY, JSON.stringify(stored))

    const result = readPendingCheckStates(USER_ID, LIST_ID)
    expect(result.map((entry) => entry.itemId)).toEqual(['fresh'])

    const persisted = JSON.parse(storage.get(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(Object.keys(persisted)).toEqual(['user-1:list-1:fresh'])
  })

  it('does not write back when nothing was pruned', () => {
    const now = Date.now()
    const stored = {
      'user-1:list-1:item-1': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        patch: { is_packed: true },
        updated_at: now,
      },
    }
    const raw = JSON.stringify(stored)
    storage.set(STORAGE_KEY, raw)
    readPendingCheckStates(USER_ID, LIST_ID)
    expect(storage.get(STORAGE_KEY)).toBe(raw)
  })

  it('clears the storage key when removing the last entry', () => {
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    expect(storage.get(STORAGE_KEY)).toBeDefined()
    removePendingChecks(USER_ID, LIST_ID, ['item-1'])
    expect(storage.get(STORAGE_KEY)).toBeUndefined()
  })
})

describe('offline check queue (ready)', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('stores a pending ready state independently of packed', () => {
    queuePendingReadyState(USER_ID, LIST_ID, 'item-1', true)
    const pending = readPendingCheckStates(USER_ID, LIST_ID)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.patch).toEqual({ is_ready: true })
  })

  it('merges ready and packed into a single entry per item', () => {
    queuePendingReadyState(USER_ID, LIST_ID, 'item-1', true)
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    const pending = readPendingCheckStates(USER_ID, LIST_ID)
    // Quote both fields so a single PATCH at flush time syncs both together.
    expect(pending).toHaveLength(1)
    expect(pending[0]?.patch).toEqual({ is_ready: true, is_packed: true })
  })

  it('overlays pending ready states onto list items', () => {
    const items = [item('item-1', { is_ready: false }), item('item-2', { is_ready: true })]
    const pending: PendingCheckState[] = [
      {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        patch: { is_ready: true },
        updated_at: 1,
        failedAttempts: 0,
      },
    ]
    const next = applyPendingReadyStates(items, pending)
    expect(next[0]?.is_ready).toBe(true)
    expect(next[1]).toBe(items[1])
  })

  it('applyPendingReadyStates ignores entries that only carry is_packed', () => {
    // Mixed queue: one ready, one packed-only. The packed-only entry must
    // not flip is_ready on its item.
    const items = [item('item-1', { is_ready: false }), item('item-2', { is_ready: false })]
    const pending: PendingCheckState[] = [
      { userId: USER_ID, listId: LIST_ID, itemId: 'item-1', patch: { is_ready: true }, updated_at: 1, failedAttempts: 0 },
      { userId: USER_ID, listId: LIST_ID, itemId: 'item-2', patch: { is_packed: true }, updated_at: 2, failedAttempts: 0 },
    ]
    const next = applyPendingReadyStates(items, pending)
    expect(next[0]?.is_ready).toBe(true)
    expect(next[1]?.is_ready).toBe(false)
  })
})

describe('dropFieldFromPendingChecks (reset/sync race contract)', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('drops only the targeted field on entries that carry both', () => {
    queuePendingReadyState(USER_ID, LIST_ID, 'item-1', true)
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    dropFieldFromPendingChecks(USER_ID, LIST_ID, 'is_packed')
    const pending = readPendingCheckStates(USER_ID, LIST_ID)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.patch).toEqual({ is_ready: true })
  })

  it('removes the entry entirely when the dropped field was the only one', () => {
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    dropFieldFromPendingChecks(USER_ID, LIST_ID, 'is_packed')
    expect(readPendingCheckStates(USER_ID, LIST_ID)).toEqual([])
  })

  it('leaves pending entries for other users/lists alone', () => {
    queuePendingPackedState(USER_ID, LIST_ID, 'item-1', true)
    queuePendingPackedState('other-user', LIST_ID, 'item-1', true)
    queuePendingPackedState(USER_ID, 'other-list', 'item-1', true)
    dropFieldFromPendingChecks(USER_ID, LIST_ID, 'is_packed')
    expect(readPendingCheckStates(USER_ID, LIST_ID)).toEqual([])
    expect(readPendingCheckStates('other-user', LIST_ID).map((e) => e.itemId)).toEqual(['item-1'])
    expect(readPendingCheckStates(USER_ID, 'other-list').map((e) => e.itemId)).toEqual(['item-1'])
  })
})

describe('v1 -> v2 migration', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('reads a v1 payload, converts to v2 patch shape, and removes the v1 key', () => {
    const now = Date.now()
    const v1 = {
      'user-1:list-1:item-1': {
        userId: USER_ID,
        listId: LIST_ID,
        itemId: 'item-1',
        is_packed: true,
        updated_at: now,
      },
    }
    storage.set(STORAGE_KEY_V1, JSON.stringify(v1))

    const pending = readPendingCheckStates(USER_ID, LIST_ID)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.patch).toEqual({ is_packed: true })

    // v1 key removed, v2 key populated.
    expect(storage.get(STORAGE_KEY_V1)).toBeUndefined()
    expect(storage.get(STORAGE_KEY)).toBeDefined()
  })
})
