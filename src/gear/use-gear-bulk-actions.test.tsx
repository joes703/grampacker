// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// The bulk delete/move mutations were inline in GearLibraryPage (which has no
// component test), so this locks the logic the extraction exposed: delete/move
// call the correct query helpers with the selected ids (and target category),
// and they compose the gear-list-items BULK fan-out helpers (bulk gear writes
// render from the gear library AND any open list view) with an errorToast (a
// bulk failure's rollback is otherwise easy to miss). The fan-out cache
// lifecycle itself (cross-cache snapshot/rollback/toast/invalidate and the
// category-move transform) is owned and tested by
// gear-list-items-fan-out.test.ts; here we mock the helpers and assert only
// that the hook wires the correct path + options.
//
// Select-mode exit is NOT the hook's concern - the page owns selection state and
// exits it on success via the mutate call site's onSuccess. The last bulkDelete
// test locks that mechanism (a caller onSuccess fires on success), which is what
// the page uses to call exitSelectMode.

type Lifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }
type FanOutOpts = { qc: unknown; errorToast?: string }

const h = vi.hoisted(() => ({
  bulkDeleteGearItems: vi.fn<(ids: string[]) => Promise<void>>(),
  bulkMoveToCategoryGearItems: vi.fn<(ids: string[], categoryId: string | null) => Promise<void>>(),
  makeOptimisticGearItemsBulkDelete: vi.fn<(opts: FanOutOpts) => Lifecycle>(),
  makeOptimisticGearItemsBulkCategoryMove: vi.fn<(opts: FanOutOpts) => Lifecycle>(),
}))

vi.mock('../lib/queries', () => h)

import { useGearBulkActions } from './use-gear-bulk-actions'

function lifecycle(): Lifecycle {
  return { onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useGearBulkActions(), { wrapper })
  return { result, qc }
}

beforeEach(() => {
  h.makeOptimisticGearItemsBulkDelete.mockReturnValue(lifecycle())
  h.makeOptimisticGearItemsBulkCategoryMove.mockReturnValue(lifecycle())
  h.bulkDeleteGearItems.mockResolvedValue(undefined)
  h.bulkMoveToCategoryGearItems.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('useGearBulkActions', () => {
  describe('bulkDelete', () => {
    it('deletes the selected ids through the bulk fan-out with an error toast', async () => {
      const { result, qc } = setup()

      result.current.bulkDelete.mutate(['g1', 'g2'])

      await waitFor(() => expect(h.bulkDeleteGearItems).toHaveBeenCalledWith(['g1', 'g2']))
      expect(h.makeOptimisticGearItemsBulkDelete).toHaveBeenCalledWith({
        qc,
        errorToast: "Couldn't delete the selected items. Please try again.",
      })
    })

    it('invokes the caller onSuccess (the page uses this to exit select mode)', async () => {
      const { result } = setup()
      const onSuccess = vi.fn()

      result.current.bulkDelete.mutate(['g1'], { onSuccess })

      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    })
  })

  describe('bulkMove', () => {
    it('moves the selected ids to the target category through the bulk fan-out', async () => {
      const { result, qc } = setup()

      result.current.bulkMove.mutate({ ids: ['g1', 'g2'], categoryId: 'c9' })

      await waitFor(() =>
        expect(h.bulkMoveToCategoryGearItems).toHaveBeenCalledWith(['g1', 'g2'], 'c9'),
      )
      expect(h.makeOptimisticGearItemsBulkCategoryMove).toHaveBeenCalledWith({
        qc,
        errorToast: "Couldn't move the selected items. Please try again.",
      })
    })

    it('passes a null category through (clearing the category)', async () => {
      const { result } = setup()

      result.current.bulkMove.mutate({ ids: ['g1'], categoryId: null })

      await waitFor(() =>
        expect(h.bulkMoveToCategoryGearItems).toHaveBeenCalledWith(['g1'], null),
      )
    })
  })
})
