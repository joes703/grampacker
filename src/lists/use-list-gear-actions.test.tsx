// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Category } from '../lib/types'
import { mutationErrorHandler } from '../lib/mutation-error-handler'

// The gear/category write mutations were inline in ListDetailPage (which has no
// component test), so this locks the logic the extraction exposed: the gear
// writes call the right query helpers, they wire the F1 gear-specific fan-out
// helpers (NOT the generic optimistic helpers), the delete-gear error toast
// fires alongside the fan-out rollback, and addCategory maps to createCategory
// at the next sort slot with the right optimistic placeholder. The fan-out cache
// internals are owned/tested by gear-list-items-fan-out.test.ts; here we mock
// those helpers and assert wiring, not internals.

const USER_ID = 'u1'

type Lifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }
type InsertOpts = { queryKey: unknown; optimistic: (name: string) => unknown }

const h = vi.hoisted(() => ({
  queryKeys: {
    categories: () => ['categories'] as const,
    gearItems: () => ['gear-items'] as const,
  },
  createCategory: vi.fn<(userId: string, name: string, sortOrder: number) => Promise<unknown>>(),
  nextCategorySortOrder: vi.fn<(cats: unknown[]) => number>(),
  updateGearItem: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteGearItem: vi.fn<(id: string) => Promise<void>>(),
  makeOptimisticInsert: vi.fn<(opts: InsertOpts) => Lifecycle>(),
  // Generic optimistic helpers exist on the barrel; the gear paths must NOT use
  // them (they'd skip the cross-cache fan-out). Present here only so the tests
  // can assert they stay untouched.
  makeOptimisticUpdate: vi.fn(),
  makeOptimisticDelete: vi.fn(),
}))

// Gear fan-out helpers live in their own submodule (imported directly, not via
// the barrel) - mock it separately and hand back stable lifecycle objects so
// the wiring (and the delete rollback) is observable.
const fanout = vi.hoisted(() => {
  const updateLifecycle = { onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
  const deleteLifecycle = { onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
  return {
    updateLifecycle,
    deleteLifecycle,
    makeOptimisticGearItemUpdate: vi.fn(() => updateLifecycle),
    makeOptimisticGearItemDelete: vi.fn(() => deleteLifecycle),
  }
})

const toast = vi.hoisted(() => ({ showToast: vi.fn<(message: string, options?: unknown) => number>() }))

vi.mock('../lib/queries', () => h)
vi.mock('../lib/queries/gear-list-items-fan-out', () => ({
  makeOptimisticGearItemUpdate: fanout.makeOptimisticGearItemUpdate,
  makeOptimisticGearItemDelete: fanout.makeOptimisticGearItemDelete,
}))
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))
vi.mock('../lib/toast', () => toast)

import { useListGearActions } from './use-list-gear-actions'

const lifecycle = (): Lifecycle => ({ onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() })

function cat(over: Partial<Category> = {}): Category {
  return {
    id: 'c1', user_id: USER_ID, name: 'Shelter', sort_order: 0,
    is_default: false, created_at: '2026-01-01T00:00:00.000Z', ...over,
  }
}

function setup(categories: Category[] = []) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useListGearActions(USER_ID, categories), { wrapper })
  return { qc, result }
}

beforeEach(() => {
  h.makeOptimisticInsert.mockReturnValue(lifecycle())
  h.nextCategorySortOrder.mockReturnValue(7)
  h.createCategory.mockResolvedValue({ id: 'cat-new' })
  h.updateGearItem.mockResolvedValue(undefined)
  h.deleteGearItem.mockResolvedValue(undefined)
  toast.showToast.mockReturnValue(0)
})

afterEach(() => vi.clearAllMocks())

describe('useListGearActions', () => {
  describe('updateGearItem', () => {
    it('patches the gear item by id', async () => {
      const { result } = setup()

      result.current.updateGearItem.mutate({ id: 'g1', patch: { name: 'Tent' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { name: 'Tent' }))
    })

    it('wires the gear-specific fan-out update helper, not the generic optimistic helpers', () => {
      const { qc } = setup()

      expect(fanout.makeOptimisticGearItemUpdate).toHaveBeenCalledWith(qc)
      expect(h.makeOptimisticUpdate).not.toHaveBeenCalled()
      expect(h.makeOptimisticDelete).not.toHaveBeenCalled()
    })
  })

  describe('deleteGearItem', () => {
    it('deletes the gear item by id', async () => {
      const { result } = setup()

      result.current.deleteGearItem.mutate('g9')

      await waitFor(() => expect(h.deleteGearItem).toHaveBeenCalledWith('g9'))
    })

    it('wires the gear-specific fan-out delete helper, not the generic optimistic helpers', () => {
      const { qc } = setup()

      expect(fanout.makeOptimisticGearItemDelete).toHaveBeenCalledWith(qc)
      expect(h.makeOptimisticDelete).not.toHaveBeenCalled()
    })

    it('on failure runs the fan-out rollback and shows the existing error toast', async () => {
      h.deleteGearItem.mockRejectedValueOnce(new Error('boom'))
      const { result } = setup()

      result.current.deleteGearItem.mutate('g9')

      await waitFor(() => expect(fanout.deleteLifecycle.onError).toHaveBeenCalled())
      expect(toast.showToast).toHaveBeenCalledWith(
        "Couldn't delete that item. Please try again.",
        { type: 'error' },
      )
    })
  })

  describe('addCategory', () => {
    it('creates a category for the owner at the next sort slot', async () => {
      const categories = [cat({ id: 'c1' }), cat({ id: 'c2' })]
      const { result } = setup(categories)

      result.current.addCategory.mutate('Cookware')

      await waitFor(() => expect(h.createCategory).toHaveBeenCalledWith(USER_ID, 'Cookware', 7))
      expect(h.nextCategorySortOrder).toHaveBeenCalledWith(categories)
    })

    it('builds an optimistic placeholder with temp id, owner, name, sort order, is_default false, and a timestamp', () => {
      setup()
      const opts = h.makeOptimisticInsert.mock.calls[0]![0]
      expect(opts.queryKey).toEqual(['categories'])

      const placeholder = opts.optimistic('Cookware') as Category
      expect(placeholder).toMatchObject({
        id: 'temp-tmp-id',
        user_id: USER_ID,
        name: 'Cookware',
        sort_order: 7,
        is_default: false,
      })
      expect(typeof placeholder.created_at).toBe('string')
      expect(placeholder.created_at).toMatch(/\dT\d/)
    })
  })

  it('returns raw mutations usable with mutate-time callbacks (the page uses call-site onSuccess)', async () => {
    const { result } = setup()
    const onSuccess = vi.fn()

    result.current.addCategory.mutate('Cookware', { onSuccess })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })
})
