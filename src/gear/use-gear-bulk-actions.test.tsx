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

// The bulk delete/move mutations were inline in GearLibraryPage (which has no
// component test), so this locks what the extraction exposed. Only the
// network functions are mocked; the bulk fan-out helpers, the cache and the
// toast store are real. Bulk gear writes render from the gear library AND
// every open list view, so both caches change and roll back together, and a
// failure toasts (a bulk rollback is otherwise easy to miss).
//
// Select-mode exit is NOT the hook's concern - the page owns selection state and
// exits it on success via the mutate call site's onSuccess. The last bulkDelete
// test locks that mechanism (a caller onSuccess fires on success), which is what
// the page uses to call exitSelectMode.

const h = vi.hoisted(() => ({
  bulkDeleteGearItems: vi.fn<(ids: string[]) => Promise<void>>(),
  bulkMoveToCategoryGearItems: vi.fn<(ids: string[], categoryId: string | null) => Promise<void>>(),
}))

vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  ...h,
}))

import { useGearBulkActions } from './use-gear-bulk-actions'

const NOW = '2026-01-01T00:00:00.000Z'
const LIST_KEY = ['list-items', 'list-1'] as const

function gear(id: string, categoryId: string | null = 'c1'): GearItem {
  return {
    id, categoryId, name: id, description: null,
    weightGrams: 100, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: NOW, updatedAt: NOW,
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

const GEAR = [gear('g1'), gear('g2'), gear('g3')]

// The gear library and one open list that embeds every gear item.
function setup() {
  const qc = testQueryClient()
  qc.setQueryData<GearItem[]>(['gear-items'], GEAR)
  qc.setQueryData<ListItemWithGear[]>(LIST_KEY, GEAR.map(listItem))
  const result = renderHookWithClient(qc, () => useGearBulkActions())
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

describe('useGearBulkActions', () => {
  describe('bulkDelete', () => {
    it('deletes the selected ids from the library and every list, and a failure restores both with an error toast', async () => {
      const remove = deferred()
      h.bulkDeleteGearItems.mockReturnValueOnce(remove.promise)
      const { qc, result } = setup()

      result.current.bulkDelete.mutate(['g1', 'g2'])

      await waitFor(() => expect(h.bulkDeleteGearItems).toHaveBeenCalledWith(['g1', 'g2']))
      await waitFor(() => expect(cachedGear(qc)).toEqual([gear('g3')]))
      expect(cachedList(qc)).toEqual([listItem(gear('g3'))])

      remove.reject(new Error('boom'))
      await waitFor(() => expect(result.current.bulkDelete.isError).toBe(true))
      expect(cachedGear(qc)).toEqual(GEAR)
      expect(cachedList(qc)).toEqual(GEAR.map(listItem))
      expect(shownToasts()).toEqual([
        {
          message:
            "Couldn't confirm the selected items were deleted. Refresh to check before trying again.",
          type: 'error',
        },
      ])
    })

    it('invokes the caller onSuccess (the page uses this to exit select mode)', async () => {
      h.bulkDeleteGearItems.mockResolvedValue(undefined)
      const { result } = setup()
      const onSuccess = vi.fn()

      result.current.bulkDelete.mutate(['g1'], { onSuccess })

      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    })
  })

  describe('bulkMove', () => {
    it('moves the selected ids to the target category in the library and every list, and a failure restores both with an error toast', async () => {
      const move = deferred()
      h.bulkMoveToCategoryGearItems.mockReturnValueOnce(move.promise)
      const { qc, result } = setup()

      result.current.bulkMove.mutate({ ids: ['g1', 'g2'], categoryId: 'c9' })

      await waitFor(() =>
        expect(h.bulkMoveToCategoryGearItems).toHaveBeenCalledWith(['g1', 'g2'], 'c9'),
      )
      const moved = [gear('g1', 'c9'), gear('g2', 'c9'), gear('g3')]
      await waitFor(() => expect(cachedGear(qc)).toEqual(moved))
      expect(cachedList(qc)).toEqual(moved.map(listItem))

      move.reject(new Error('boom'))
      await waitFor(() => expect(result.current.bulkMove.isError).toBe(true))
      expect(cachedGear(qc)).toEqual(GEAR)
      expect(cachedList(qc)).toEqual(GEAR.map(listItem))
      expect(shownToasts()).toEqual([
        {
          message:
            "Couldn't confirm the selected items were moved. Try again, or refresh to check.",
          type: 'error',
        },
      ])
    })

    it('passes a null category through (clearing the category)', async () => {
      const move = deferred()
      h.bulkMoveToCategoryGearItems.mockReturnValueOnce(move.promise)
      const { qc, result } = setup()

      result.current.bulkMove.mutate({ ids: ['g1'], categoryId: null })

      await waitFor(() =>
        expect(h.bulkMoveToCategoryGearItems).toHaveBeenCalledWith(['g1'], null),
      )
      await waitFor(() => expect(cachedGear(qc)?.[0]?.categoryId).toBeNull())
      move.resolve()
      await waitFor(() => expect(result.current.bulkMove.isSuccess).toBe(true))
    })
  })
})
