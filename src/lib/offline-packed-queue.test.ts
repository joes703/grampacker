import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyPendingPackedStates,
  queuePendingPackedState,
  readPendingPackedStates,
  removePendingPackedStates,
  type PendingPackedState,
} from './offline-packed-queue'
import type { ListItemWithGear } from './types'

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
    },
  }
}

describe('offline packed queue', () => {
  beforeEach(() => {
    storage.clear()
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
})
