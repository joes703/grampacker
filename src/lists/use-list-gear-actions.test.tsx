// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { Category, GearItem, ListItemWithGear } from '../lib/types'
import {
  clearToasts,
  renderHookWithClient,
  testQueryClient,
  shownToasts,
} from '../test/mutation-hook-harness'
import { deferred } from '../test/deferred'

// The gear/category write mutations were inline in ListDetailPage (which has no
// component test), so this locks what the extraction exposed. Only the network
// functions are mocked; the optimistic helpers, the cache and the toast store
// are real.
// - A gear edit or delete from a list writes the shared inventory, so it must
//   reach the gear library cache AND every list cache that embeds the gear,
//   not only the list the user is looking at.
// - The delete's rollback toasts; the edit's does not.
// - addCategory shows a placeholder in the categories cache.

const h = vi.hoisted(() => ({
  createCategory: vi.fn<(name: string) => Promise<unknown>>(),
  updateGearItem: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteGearItem: vi.fn<(id: string) => Promise<void>>(),
}))

vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  ...h,
}))
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))

import { useListGearActions } from './use-list-gear-actions'

const NOW = '2026-01-01T00:00:00.000Z'

function cat(over: Partial<Category> = {}): Category {
  return {
    id: 'c1', name: 'Shelter', sortOrder: 0,
    createdAt: NOW, ...over,
  }
}

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1', categoryId: 'c1', name: 'Tarp', description: null,
    weightGrams: 300, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: NOW, updatedAt: NOW, ...over,
  }
}

function listItem(listId: string, g: GearItem): ListItemWithGear {
  return {
    id: `${listId}-${g.id}`, listId, gearItemId: g.id, gearItem: g,
    quantity: 1, isWorn: false, isConsumable: false, isPacked: false, isReady: false,
    packingLocationId: null,
    sortOrder: 0, packSortOrder: 0, createdAt: NOW, updatedAt: NOW,
  }
}

const OTHER = gear({ id: 'g2', name: 'Stove' })

// Two open lists embed g1: the one on screen and another the user opened
// earlier. The gear library holds g1 and g2.
function setup(categories: Category[] = []) {
  const qc = testQueryClient()
  qc.setQueryData<Category[]>(['categories'], categories)
  qc.setQueryData<GearItem[]>(['gear-items'], [gear(), OTHER])
  qc.setQueryData<ListItemWithGear[]>(['list-items', 'list-1'], [listItem('list-1', gear()), listItem('list-1', OTHER)])
  qc.setQueryData<ListItemWithGear[]>(['list-items', 'list-2'], [listItem('list-2', gear())])
  const result = renderHookWithClient(qc, () => useListGearActions(categories))
  return { qc, result }
}

beforeEach(() => {
  h.createCategory.mockResolvedValue({ id: 'cat-new' })
  h.updateGearItem.mockResolvedValue(undefined)
  h.deleteGearItem.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  clearToasts()
})

describe('useListGearActions', () => {
  describe('updateGearItem', () => {
    it('patches the gear item by id in the gear library and in every list that embeds it, and a failure restores them without a toast', async () => {
      const edit = deferred()
      h.updateGearItem.mockReturnValueOnce(edit.promise)
      const { qc, result } = setup()

      result.current.updateGearItem.mutate({ id: 'g1', patch: { name: 'Tent' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { name: 'Tent' }))
      const renamed = gear({ name: 'Tent' })
      await waitFor(() => expect(qc.getQueryData(['gear-items'])).toEqual([renamed, OTHER]))
      expect(qc.getQueryData(['list-items', 'list-1'])).toEqual([
        listItem('list-1', renamed),
        listItem('list-1', OTHER),
      ])
      expect(qc.getQueryData(['list-items', 'list-2'])).toEqual([listItem('list-2', renamed)])

      edit.reject(new Error('boom'))
      await waitFor(() => expect(result.current.updateGearItem.isError).toBe(true))
      expect(qc.getQueryData(['gear-items'])).toEqual([gear(), OTHER])
      expect(qc.getQueryData(['list-items', 'list-1'])).toEqual([
        listItem('list-1', gear()),
        listItem('list-1', OTHER),
      ])
      expect(qc.getQueryData(['list-items', 'list-2'])).toEqual([listItem('list-2', gear())])
      expect(shownToasts()).toEqual([])
    })
  })

  describe('deleteGearItem', () => {
    it('deletes the gear item by id', async () => {
      const { result } = setup()

      result.current.deleteGearItem.mutate('g9')

      await waitFor(() => expect(h.deleteGearItem).toHaveBeenCalledWith('g9'))
    })

    it('removes the gear from the library and every list, and a failure restores them all with the preserved error toast copy', async () => {
      const remove = deferred()
      h.deleteGearItem.mockReturnValueOnce(remove.promise)
      const { qc, result } = setup()

      result.current.deleteGearItem.mutate('g1')

      // The server cascades list_items on gear delete; the cache mirrors it.
      await waitFor(() => expect(qc.getQueryData(['gear-items'])).toEqual([OTHER]))
      expect(qc.getQueryData(['list-items', 'list-1'])).toEqual([listItem('list-1', OTHER)])
      expect(qc.getQueryData(['list-items', 'list-2'])).toEqual([])

      remove.reject(new Error('boom'))
      await waitFor(() => expect(result.current.deleteGearItem.isError).toBe(true))
      expect(qc.getQueryData(['gear-items'])).toEqual([gear(), OTHER])
      expect(qc.getQueryData(['list-items', 'list-1'])).toEqual([
        listItem('list-1', gear()),
        listItem('list-1', OTHER),
      ])
      expect(qc.getQueryData(['list-items', 'list-2'])).toEqual([listItem('list-2', gear())])
      expect(shownToasts()).toEqual([
        {
          message:
            "Couldn't confirm that item was deleted. Refresh to check before trying again.",
          type: 'error',
        },
      ])
    })
  })

  describe('addCategory', () => {
    it('creates a category by name (the server assigns the persisted slot)', async () => {
      const categories = [cat({ id: 'c1' }), cat({ id: 'c2' })]
      const { result } = setup(categories)

      result.current.addCategory.mutate('Cookware')

      await waitFor(() => expect(h.createCategory).toHaveBeenCalledWith('Cookware'))
    })

    it('shows a placeholder with temp id, name, sort slot, and a timestamp in the categories cache', async () => {
      const create = deferred<unknown>()
      h.createCategory.mockReturnValueOnce(create.promise)
      const categories = [cat({ id: 'c1', sortOrder: 2 }), cat({ id: 'c2', sortOrder: 6 })]
      const { qc, result } = setup(categories)

      result.current.addCategory.mutate('Cookware')

      // The slot is the next one after the passed cache rows (only the
      // placeholder uses it; the server assigns the real one).
      await waitFor(() => expect(qc.getQueryData<Category[]>(['categories'])).toHaveLength(3))
      const placeholder = qc.getQueryData<Category[]>(['categories'])?.[2]
      expect(placeholder).toMatchObject({
        id: 'temp-tmp-id',
        name: 'Cookware',
        sortOrder: 7,
      })
      expect(typeof placeholder?.createdAt).toBe('string')
      expect(placeholder?.createdAt).toMatch(/\dT\d/)

      create.resolve({ id: 'cat-new' })
      await waitFor(() => expect(result.current.addCategory.isSuccess).toBe(true))
    })
  })

  it('returns raw mutations usable with mutate-time callbacks (the page uses call-site onSuccess)', async () => {
    const { result } = setup()
    const onSuccess = vi.fn()

    result.current.addCategory.mutate('Cookware', { onSuccess })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })
})
