// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Category } from '../lib/types'

// The add/rename/delete category mutations were inline in GearLibraryPage (which
// has no component test), so this locks the logic the extraction exposed: add
// goes through createCategory with the right optimistic placeholder (the SERVER
// assigns the real sort slot; the placeholder computes the same value), rename
// goes through renameCategory with an optimistic name patch, and delete goes
// through deleteCategory while invalidating the gear-items cache (the server
// uncategorizes the category's gear in the same transaction). These compose the
// GENERIC optimistic helpers (makeOptimisticInsert/Update/Delete), whose cache
// lifecycle (rollback, invalidation) is owned and tested by optimistic.test.ts;
// here we mock those helpers and assert only that the hook wires the correct
// path + options.

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
  },
  createCategory: vi.fn<(name: string) => Promise<unknown>>(),
  renameCategory: vi.fn<(id: string, name: string) => Promise<void>>(),
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
    id: 'c1', name: 'Shelter', sortOrder: 0, createdAt: NOW, ...over,
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
  const { result } = renderHook(() => useGearCategoryActions(categories), { wrapper })
  return { result }
}

beforeEach(() => {
  h.makeOptimisticInsert.mockReturnValue(lifecycle())
  h.makeOptimisticUpdate.mockReturnValue(lifecycle())
  h.makeOptimisticDelete.mockReturnValue(lifecycle())
  h.nextCategorySortOrder.mockReturnValue(5)
  h.createCategory.mockResolvedValue({ id: 'c-new' })
  h.renameCategory.mockResolvedValue(undefined)
  h.deleteCategory.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('useGearCategoryActions', () => {
  describe('addCategory', () => {
    it('creates a category by name and targets the categories cache', async () => {
      const { result } = setup([category({ id: 'c0', sortOrder: 2 })])

      result.current.addCategory.mutate('Cooking')

      // The server assigns the real sortOrder (max+1); the client sends
      // only the name.
      await waitFor(() => expect(h.createCategory).toHaveBeenCalledWith('Cooking'))
      // Optimistic insert wired to ['categories'] - the cache it settles/invalidates.
      expect(h.makeOptimisticInsert).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['categories'] }),
      )
    })

    it('builds an optimistic placeholder with a temp id and the next sort slot', () => {
      setup([])
      const opts = h.makeOptimisticInsert.mock.calls[0]![0]
      const placeholder = opts.optimistic('Cooking')
      // The placeholder's sortOrder mirrors what the server will assign
      // (nextCategorySortOrder over the cached rows) so the row lands in
      // place before the settled refetch reconciles it.
      expect(placeholder).toMatchObject({
        id: 'temp-tmp-id', name: 'Cooking', sortOrder: 5,
      })
    })
  })

  describe('renameCategory', () => {
    it('updates the name by id and preserves the optimistic rename', async () => {
      const { result } = setup()

      result.current.renameCategory.mutate({ id: 'c1', name: 'Shelter v2' })

      await waitFor(() => expect(h.renameCategory).toHaveBeenCalledWith('c1', 'Shelter v2'))
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

    it('invalidates the gear-items cache so uncategorized items re-render after the server-side uncategorize', () => {
      setup()
      const opts = h.makeOptimisticDelete.mock.calls[0]![0]
      // The delete removes only the category row from ['categories']; the
      // server sets gear_items.categoryId to NULL in the same transaction
      // (it does NOT delete gear). Invalidating the gear cache is what
      // refreshes the now-uncategorized items. (The old repo also
      // invalidated ['list-items'] here; that returns with the lists slice
      // in phase 3.)
      expect(opts.queryKey).toEqual(['categories'])
      expect(opts.invalidateKeys).toEqual([['gear-items']])
      expect(opts.id('c1')).toBe('c1')
    })
  })
})
