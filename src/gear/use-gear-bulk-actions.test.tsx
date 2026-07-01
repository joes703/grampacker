// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// The bulk delete/move mutations were inline in GearLibraryPage (which has no
// component test), so this locks the logic the extraction exposed: delete/move
// call the correct query helpers with the selected ids (and target category),
// they compose the GEAR-SPECIFIC BULK fan-out helpers (not the generic ones),
// and on failure they both roll back through the helper AND raise an error toast.
// The fan-out cache lifecycle itself (cancel/snapshot/write/rollback/invalidate
// across the gear + list caches) is owned and tested by
// gear-list-items-fan-out.test.ts; here we mock those helpers and assert only
// that the hook wires the correct path and feedback, not their internals.
//
// Select-mode exit is NOT the hook's concern - the page owns selection state and
// exits it on success via the mutate call site's onSuccess. The last test locks
// that mechanism (a caller onSuccess fires on success), which is what the page
// uses to call exitSelectMode.

type Lifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }

const h = vi.hoisted(() => ({
  bulkDeleteGearItems: vi.fn<(ids: string[]) => Promise<void>>(),
  bulkMoveToCategoryGearItems: vi.fn<(ids: string[], categoryId: string | null) => Promise<void>>(),
}))
const fanout = vi.hoisted(() => ({
  makeOptimisticGearItemsBulkDelete: vi.fn<(qc: unknown) => Lifecycle>(),
  makeOptimisticGearItemsBulkCategoryMove: vi.fn<(qc: unknown) => Lifecycle>(),
}))
const toast = vi.hoisted(() => ({ showToast: vi.fn<(message: string, options?: unknown) => number>() }))

vi.mock('../lib/queries', () => h)
vi.mock('../lib/queries/gear-list-items-fan-out', () => fanout)
vi.mock('../lib/toast', () => toast)

import { useGearBulkActions } from './use-gear-bulk-actions'

function lifecycle(): Lifecycle {
  return { onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
}

// The same lifecycle object the hook receives each render, so tests can assert
// the helper's own onError (the rollback) fired.
let deleteLifecycle: Lifecycle
let moveLifecycle: Lifecycle

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useGearBulkActions(), { wrapper })
  return { result }
}

beforeEach(() => {
  deleteLifecycle = lifecycle()
  moveLifecycle = lifecycle()
  fanout.makeOptimisticGearItemsBulkDelete.mockReturnValue(deleteLifecycle)
  fanout.makeOptimisticGearItemsBulkCategoryMove.mockReturnValue(moveLifecycle)
  h.bulkDeleteGearItems.mockResolvedValue(undefined)
  h.bulkMoveToCategoryGearItems.mockResolvedValue(undefined)
  toast.showToast.mockReturnValue(0)
})

afterEach(() => vi.clearAllMocks())

describe('useGearBulkActions', () => {
  describe('bulkDelete', () => {
    it('deletes the selected ids through the gear bulk-delete fan-out path', async () => {
      const { result } = setup()

      result.current.bulkDelete.mutate(['g1', 'g2'])

      await waitFor(() => expect(h.bulkDeleteGearItems).toHaveBeenCalledWith(['g1', 'g2']))
      // The gear-specific bulk fan-out helper (dual-cache lifecycle), NOT a generic
      // optimistic helper - the F1 fan-out boundary is preserved.
      expect(fanout.makeOptimisticGearItemsBulkDelete).toHaveBeenCalled()
    })

    it('rolls back through the fan-out helper and shows an error toast on failure', async () => {
      h.bulkDeleteGearItems.mockRejectedValueOnce(new Error('boom'))
      const { result } = setup()

      result.current.bulkDelete.mutate(['g1'])

      await waitFor(() =>
        expect(toast.showToast).toHaveBeenCalledWith(
          "Couldn't delete the selected items. Please try again.",
          { type: 'error' },
        ),
      )
      // The helper's own onError (the optimistic rollback) still fires.
      expect(deleteLifecycle.onError).toHaveBeenCalled()
    })

    it('invokes the caller onSuccess (the page uses this to exit select mode)', async () => {
      const { result } = setup()
      const onSuccess = vi.fn()

      result.current.bulkDelete.mutate(['g1'], { onSuccess })

      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    })
  })

  describe('bulkMove', () => {
    it('moves the selected ids to the target category through the bulk-category-move fan-out path', async () => {
      const { result } = setup()

      result.current.bulkMove.mutate({ ids: ['g1', 'g2'], categoryId: 'c9' })

      await waitFor(() =>
        expect(h.bulkMoveToCategoryGearItems).toHaveBeenCalledWith(['g1', 'g2'], 'c9'),
      )
      expect(fanout.makeOptimisticGearItemsBulkCategoryMove).toHaveBeenCalled()
    })

    it('passes a null category through (clearing the category)', async () => {
      const { result } = setup()

      result.current.bulkMove.mutate({ ids: ['g1'], categoryId: null })

      await waitFor(() =>
        expect(h.bulkMoveToCategoryGearItems).toHaveBeenCalledWith(['g1'], null),
      )
    })

    it('rolls back through the fan-out helper and shows an error toast on failure', async () => {
      h.bulkMoveToCategoryGearItems.mockRejectedValueOnce(new Error('boom'))
      const { result } = setup()

      result.current.bulkMove.mutate({ ids: ['g1'], categoryId: 'c9' })

      await waitFor(() =>
        expect(toast.showToast).toHaveBeenCalledWith(
          "Couldn't move the selected items. Please try again.",
          { type: 'error' },
        ),
      )
      expect(moveLifecycle.onError).toHaveBeenCalled()
    })
  })
})
