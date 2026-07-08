// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { GearItem } from '../lib/types'

// The bulk delete/move mutations were inline in GearLibraryPage (which has no
// component test), so this locks the logic the extraction exposed: delete/move
// call the correct query helpers with the selected ids (and target category),
// they compose the GENERIC BULK optimistic helpers on the gearItems cache with
// an errorToast (a bulk failure's rollback is otherwise easy to miss), and the
// move transform applies the target category. (The old repo composed the
// gear-list-items BULK fan-out helpers here; that boundary returns with the
// lists slice in phase 3.) The optimistic cache lifecycle itself
// (cancel/snapshot/write/rollback/toast/invalidate) is owned and tested by
// optimistic.test.ts; here we mock those helpers and assert only that the hook
// wires the correct path + options.
//
// Select-mode exit is NOT the hook's concern - the page owns selection state and
// exits it on success via the mutate call site's onSuccess. The last bulkDelete
// test locks that mechanism (a caller onSuccess fires on success), which is what
// the page uses to call exitSelectMode.

type Lifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }
type MoveInput = { ids: string[]; categoryId: string | null }
type BulkDeleteOpts = {
  qc: unknown
  queryKey: unknown
  errorToast?: string
  ids: (input: string[]) => string[]
}
type BulkUpdateOpts = {
  qc: unknown
  queryKey: unknown
  errorToast?: string
  ids: (input: MoveInput) => string[]
  apply: (item: GearItem, input: MoveInput) => GearItem
}

const h = vi.hoisted(() => ({
  queryKeys: { gearItems: () => ['gear-items'] as const },
  bulkDeleteGearItems: vi.fn<(ids: string[]) => Promise<void>>(),
  bulkMoveToCategoryGearItems: vi.fn<(ids: string[], categoryId: string | null) => Promise<void>>(),
  makeOptimisticBulkDelete: vi.fn<(opts: BulkDeleteOpts) => Lifecycle>(),
  makeOptimisticBulkUpdate: vi.fn<(opts: BulkUpdateOpts) => Lifecycle>(),
}))

vi.mock('../lib/queries', () => h)

import { useGearBulkActions } from './use-gear-bulk-actions'

function lifecycle(): Lifecycle {
  return { onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
}

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1', categoryId: 'c1', name: 'Tent', description: null,
    weightGrams: 1200, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useGearBulkActions(), { wrapper })
  return { result }
}

beforeEach(() => {
  h.makeOptimisticBulkDelete.mockReturnValue(lifecycle())
  h.makeOptimisticBulkUpdate.mockReturnValue(lifecycle())
  h.bulkDeleteGearItems.mockResolvedValue(undefined)
  h.bulkMoveToCategoryGearItems.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('useGearBulkActions', () => {
  describe('bulkDelete', () => {
    it('deletes the selected ids through the bulk optimistic delete on the gear-items cache', async () => {
      const { result } = setup()

      result.current.bulkDelete.mutate(['g1', 'g2'])

      await waitFor(() => expect(h.bulkDeleteGearItems).toHaveBeenCalledWith(['g1', 'g2']))
      const opts = h.makeOptimisticBulkDelete.mock.calls[0]![0]
      expect(opts.queryKey).toEqual(['gear-items'])
      // The mutation input (the selected ids) IS the id set.
      expect(opts.ids(['a', 'b'])).toEqual(['a', 'b'])
    })

    it('opts into an error toast (a bulk rollback is otherwise easy to miss)', () => {
      setup()
      const opts = h.makeOptimisticBulkDelete.mock.calls[0]![0]
      expect(opts.errorToast).toBe("Couldn't delete the selected items. Please try again.")
    })

    it('invokes the caller onSuccess (the page uses this to exit select mode)', async () => {
      const { result } = setup()
      const onSuccess = vi.fn()

      result.current.bulkDelete.mutate(['g1'], { onSuccess })

      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    })
  })

  describe('bulkMove', () => {
    it('moves the selected ids to the target category through the bulk optimistic update', async () => {
      const { result } = setup()

      result.current.bulkMove.mutate({ ids: ['g1', 'g2'], categoryId: 'c9' })

      await waitFor(() =>
        expect(h.bulkMoveToCategoryGearItems).toHaveBeenCalledWith(['g1', 'g2'], 'c9'),
      )
      const opts = h.makeOptimisticBulkUpdate.mock.calls[0]![0]
      expect(opts.queryKey).toEqual(['gear-items'])
      expect(opts.ids({ ids: ['a'], categoryId: 'c9' })).toEqual(['a'])
      // The optimistic transform sets the target category and nothing else.
      expect(opts.apply(gear({ categoryId: 'c1' }), { ids: ['g1'], categoryId: 'c9' })).toMatchObject({
        id: 'g1', name: 'Tent', categoryId: 'c9',
      })
    })

    it('passes a null category through (clearing the category)', async () => {
      const { result } = setup()

      result.current.bulkMove.mutate({ ids: ['g1'], categoryId: null })

      await waitFor(() =>
        expect(h.bulkMoveToCategoryGearItems).toHaveBeenCalledWith(['g1'], null),
      )
      const opts = h.makeOptimisticBulkUpdate.mock.calls[0]![0]
      expect(opts.apply(gear({ categoryId: 'c1' }), { ids: ['g1'], categoryId: null })).toMatchObject({
        categoryId: null,
      })
    })

    it('opts into an error toast (a bulk rollback is otherwise easy to miss)', () => {
      setup()
      const opts = h.makeOptimisticBulkUpdate.mock.calls[0]![0]
      expect(opts.errorToast).toBe("Couldn't move the selected items. Please try again.")
    })
  })
})
