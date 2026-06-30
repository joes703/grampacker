// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Category } from '../lib/types'

// The add/rename/delete category mutations were inline in GearLibraryPage (which
// has no component test), so this locks the logic the extraction exposed: add
// goes through createCategory at the next sort slot with the right optimistic
// placeholder, rename goes through updateCategory with an optimistic name patch,
// and delete goes through deleteCategory while invalidating the gear-items and
// list-items caches (the cascade refresh). These compose the GENERIC optimistic
// helpers (makeOptimisticInsert/Update/Delete), whose cache lifecycle (rollback,
// invalidation) is owned and tested by optimistic.test.ts; here we mock those
// helpers and assert only that the hook wires the correct path + options.

type Lifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }
type InsertOpts = { qc: unknown; queryKey: unknown; optimistic: (name: string) => Category }
type RenameInput = { id: string; name: string }
type UpdateOpts = {
  qc: unknown
  queryKey: unknown
  id: (input: RenameInput) => string
  apply: (item: Category, input: RenameInput) => Category
}
type DeleteOpts = { qc: unknown; queryKey: unknown; invalidateKeys: unknown[]; id: (input: string) => string }

const h = vi.hoisted(() => ({
  queryKeys: {
    categories: () => ['categories'] as const,
    gearItems: () => ['gear-items'] as const,
    listItemsAll: () => ['list-items'] as const,
  },
  createCategory: vi.fn<(userId: string, name: string, sortOrder: number) => Promise<unknown>>(),
  updateCategory: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteCategory: vi.fn<(id: string) => Promise<void>>(),
  nextCategorySortOrder: vi.fn<(cats: unknown[]) => number>(),
  makeOptimisticInsert: vi.fn<(opts: InsertOpts) => Lifecycle>(),
  makeOptimisticUpdate: vi.fn<(opts: UpdateOpts) => Lifecycle>(),
  makeOptimisticDelete: vi.fn<(opts: DeleteOpts) => Lifecycle>(),
}))

vi.mock('../lib/queries', () => h)
// Deterministic temp id so the optimistic placeholder is exact-matchable.
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))

import { useGearCategoryActions } from './use-gear-category-actions'

const NOW = '2026-01-01T00:00:00.000Z'

function category(over: Partial<Category> = {}): Category {
  return {
    id: 'c1', user_id: 'u1', name: 'Shelter', sort_order: 0,
    is_default: false, created_at: NOW, ...over,
  }
}

function lifecycle(): Lifecycle {
  return { onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
}

function setup(categories: Category[] = []) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useGearCategoryActions('u1', categories), { wrapper })
  return { result }
}

beforeEach(() => {
  h.makeOptimisticInsert.mockReturnValue(lifecycle())
  h.makeOptimisticUpdate.mockReturnValue(lifecycle())
  h.makeOptimisticDelete.mockReturnValue(lifecycle())
  h.nextCategorySortOrder.mockReturnValue(5)
  h.createCategory.mockResolvedValue({ id: 'c-new' })
  h.updateCategory.mockResolvedValue(undefined)
  h.deleteCategory.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('useGearCategoryActions', () => {
  describe('addCategory', () => {
    it('creates a category at the next sort slot and targets the categories cache', async () => {
      const { result } = setup([category({ id: 'c0', sort_order: 2 })])

      result.current.addCategory.mutate('Cooking')

      await waitFor(() => expect(h.createCategory).toHaveBeenCalledWith('u1', 'Cooking', 5))
      // Optimistic insert wired to ['categories'] - the cache it settles/invalidates.
      expect(h.makeOptimisticInsert).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['categories'] }),
      )
    })

    it('builds an optimistic placeholder with a temp id, the owner, is_default false, and the next slot', () => {
      setup([])
      const opts = h.makeOptimisticInsert.mock.calls[0]![0]
      const placeholder = opts.optimistic('Cooking')
      expect(placeholder).toMatchObject({
        id: 'temp-tmp-id', user_id: 'u1', name: 'Cooking', sort_order: 5, is_default: false,
      })
    })
  })

  describe('renameCategory', () => {
    it('updates the name by id and preserves the optimistic rename', async () => {
      const { result } = setup()

      result.current.renameCategory.mutate({ id: 'c1', name: 'Shelter v2' })

      await waitFor(() => expect(h.updateCategory).toHaveBeenCalledWith('c1', { name: 'Shelter v2' }))
      const opts = h.makeOptimisticUpdate.mock.calls[0]![0]
      expect(opts.queryKey).toEqual(['categories'])
      // The optimistic config keys by id and applies only the name (id untouched).
      expect(opts.id({ id: 'c9', name: 'x' })).toBe('c9')
      expect(opts.apply(category({ id: 'c1', name: 'old' }), { id: 'c1', name: 'new' })).toMatchObject({
        id: 'c1', name: 'new',
      })
    })
  })

  describe('removeCategory', () => {
    it('deletes the category by id', async () => {
      const { result } = setup()

      result.current.removeCategory.mutate('c1')

      await waitFor(() => expect(h.deleteCategory).toHaveBeenCalledWith('c1'))
    })

    it('invalidates the gear-items and list-items caches so uncategorized items re-render after the SET NULL cascade', () => {
      setup()
      const opts = h.makeOptimisticDelete.mock.calls[0]![0]
      // The delete removes only the category row from ['categories']; the DB sets
      // gear_items.category_id to NULL (it does NOT delete gear). Invalidating the
      // gear and list caches is what refreshes the now-uncategorized items.
      expect(opts.queryKey).toEqual(['categories'])
      expect(opts.invalidateKeys).toEqual([['gear-items'], ['list-items']])
      expect(opts.id('c1')).toBe('c1')
    })
  })
})
