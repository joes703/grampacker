// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { GearItem, ListItemWithGear } from '../lib/types'
import {
  clearToasts,
  deferred,
  renderHookWithClient,
  testQueryClient,
  shownToasts,
} from '../test/mutation-hook-harness'

// The add/edit/delete gear-item mutations were inline in GearLibraryPage
// (which has no component test), so this locks what the extraction exposed.
// Only the network functions are mocked; the optimistic helpers, the cache
// and the toast store are real.
// - add: a placeholder in the gear-items cache, in the sort slot the server
//   will assign. A brand-new gear item cannot be in any list yet, so add
//   writes only the gear library cache.
// - edit and delete: gear renders from the gear library AND every open list
//   view (list_items.gearItem), so both caches change together and roll
//   back together.

type GearItemInput = Pick<
  GearItem,
  'name' | 'description' | 'weightGrams' | 'categoryId' | 'cost' | 'purchaseDate' | 'status'
>

const h = vi.hoisted(() => ({
  createGearItem: vi.fn<(data: GearItemInput) => Promise<unknown>>(),
  updateGearItem: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteGearItem: vi.fn<(id: string) => Promise<void>>(),
}))

vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  ...h,
}))
// Deterministic temp id so the optimistic placeholder is exact-matchable.
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))

import { useGearItemActions } from './use-gear-item-actions'

const NOW = '2026-01-01T00:00:00.000Z'
const LIST_KEY = ['list-items', 'list-1'] as const
const DELETE_TOAST =
  "Couldn't confirm that item was deleted. Refresh to check before trying again."

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1', categoryId: 'c1', name: 'Tent', description: null,
    weightGrams: 1200, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: NOW, updatedAt: NOW, ...over,
  }
}

function listItem(g: GearItem): ListItemWithGear {
  return {
    id: `li-${g.id}`, listId: 'list-1', gearItemId: g.id, gearItem: g,
    quantity: 1, isWorn: false, isConsumable: false, isPacked: false, isReady: false,
    packingLocationId: null,
    sortOrder: 0, packSortOrder: 0, createdAt: NOW, updatedAt: NOW,
  }
}

// Seeds the gear library cache with the rows the page passes to the hook,
// and one open list that embeds every one of them.
function setup(allItems: GearItem[] = [gear()]) {
  const qc = testQueryClient()
  qc.setQueryData<GearItem[]>(['gear-items'], allItems)
  qc.setQueryData<ListItemWithGear[]>(LIST_KEY, allItems.map(listItem))
  const result = renderHookWithClient(qc, () => useGearItemActions(allItems))
  return { qc, result }
}

const cachedGear = (qc: ReturnType<typeof testQueryClient>) =>
  qc.getQueryData<GearItem[]>(['gear-items'])
const cachedList = (qc: ReturnType<typeof testQueryClient>) =>
  qc.getQueryData<ListItemWithGear[]>(LIST_KEY)

afterEach(() => {
  vi.clearAllMocks()
  clearToasts()
})

describe('useGearItemActions', () => {
  describe('addItem', () => {
    it('creates a gear item and shows a placeholder in the gear-items cache while it is pending', async () => {
      const create = deferred<unknown>()
      h.createGearItem.mockReturnValueOnce(create.promise)
      const existing = gear({ id: 'g0', sortOrder: 3 })
      const { qc, result } = setup([existing])
      const data: GearItemInput = {
        name: 'Stove', description: null, weightGrams: 90, categoryId: 'c1',
        cost: null, purchaseDate: null, status: 'active',
      }

      result.current.addItem.mutate(data)

      // The server assigns the real sortOrder (max+1); the client sends
      // only the item fields.
      await waitFor(() => expect(h.createGearItem).toHaveBeenCalledWith(data))
      await waitFor(() => expect(cachedGear(qc)).toHaveLength(2))
      expect(cachedGear(qc)?.[1]).toMatchObject({ id: 'temp-tmp-id', name: 'Stove' })
      // No list can hold a gear item that does not exist yet.
      expect(cachedList(qc)).toEqual([listItem(existing)])

      create.resolve({ id: 'g-new' })
      await waitFor(() => expect(result.current.addItem.isSuccess).toBe(true))
    })

    it('builds an optimistic placeholder with a temp id and the next sort slot', async () => {
      const create = deferred<unknown>()
      h.createGearItem.mockReturnValueOnce(create.promise)
      const { qc, result } = setup([gear({ id: 'g0', sortOrder: 6 })])

      result.current.addItem.mutate({
        name: 'Stove', description: 'liquid fuel', weightGrams: 90, categoryId: 'c2',
        cost: 80, purchaseDate: '2026-01-01', status: 'active',
      })

      // The placeholder's sortOrder mirrors what the server will assign
      // (nextGearItemSortOrder over the cached rows) so the row lands in
      // place before the settled refetch reconciles it.
      await waitFor(() => expect(cachedGear(qc)).toHaveLength(2))
      expect(cachedGear(qc)?.[1]).toMatchObject({
        id: 'temp-tmp-id', name: 'Stove', description: 'liquid fuel',
        categoryId: 'c2', weightGrams: 90, cost: 80, purchaseDate: '2026-01-01',
        status: 'active', sortOrder: 7,
      })

      create.resolve({ id: 'g-new' })
      await waitFor(() => expect(result.current.addItem.isSuccess).toBe(true))
    })
  })

  describe('editItem', () => {
    it('updates by id in the gear library and in every list that embeds the gear, and a failure restores both without a toast', async () => {
      // No toast: an edit's rollback happens in place, under the cursor (the rule
      // in src/lib/mutation-error-handler.ts).
      const edit = deferred()
      h.updateGearItem.mockReturnValueOnce(edit.promise)
      const other = gear({ id: 'g2', name: 'Stove' })
      const before = [gear(), other]
      const { qc, result } = setup(before)

      result.current.editItem.mutate({ id: 'g1', patch: { name: 'New name' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { name: 'New name' }))
      const renamed = gear({ name: 'New name' })
      await waitFor(() => expect(cachedGear(qc)).toEqual([renamed, other]))
      expect(cachedList(qc)).toEqual([
        { ...listItem(gear()), gearItem: renamed },
        listItem(other),
      ])

      edit.reject(new Error('boom'))
      await waitFor(() => expect(result.current.editItem.isError).toBe(true))
      expect(cachedGear(qc)).toEqual(before)
      expect(cachedList(qc)).toEqual(before.map(listItem))
      expect(shownToasts()).toEqual([])
    })

    it('forwards a status-only patch unchanged (the inline quick-status path)', async () => {
      const { result } = setup()

      result.current.editItem.mutate({ id: 'g1', patch: { status: 'loaned_out' } })

      await waitFor(() => expect(result.current.editItem.isSuccess).toBe(true))
      expect(h.updateGearItem).toHaveBeenCalledTimes(1)
      expect(h.updateGearItem).toHaveBeenCalledWith('g1', { status: 'loaned_out' })
    })
  })

  describe('removeItem', () => {
    it('deletes by id from the library and every list, and a failure restores both with the same toast as the list-side delete', async () => {
      // A delete's rollback is a row REAPPEARING after the confirm has closed,
      // the case the rule in src/lib/mutation-error-handler.ts toasts for. The
      // copy matches src/lists/use-list-gear-actions.ts: it is the same event.
      const remove = deferred()
      h.deleteGearItem.mockReturnValueOnce(remove.promise)
      const other = gear({ id: 'g2', name: 'Stove' })
      const before = [gear(), other]
      const { qc, result } = setup(before)

      result.current.removeItem.mutate('g1')

      await waitFor(() => expect(h.deleteGearItem).toHaveBeenCalledWith('g1'))
      // The server cascades list_items on gear delete; the cache mirrors it.
      await waitFor(() => expect(cachedGear(qc)).toEqual([other]))
      expect(cachedList(qc)).toEqual([listItem(other)])

      remove.reject(new Error('boom'))
      await waitFor(() => expect(result.current.removeItem.isError).toBe(true))
      expect(cachedGear(qc)).toEqual(before)
      expect(cachedList(qc)).toEqual(before.map(listItem))
      expect(shownToasts()).toEqual([{ message: DELETE_TOAST, type: 'error' }])
    })
  })
})
