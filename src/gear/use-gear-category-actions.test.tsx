// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { Category, GearItem, ListItemWithGear } from '../lib/types'
import {
  clearToasts,
  deferred,
  renderHookWithClient,
  testQueryClient,
  toastMessages,
} from '../test/mutation-hook-harness'

// The add/rename/delete category mutations were inline in GearLibraryPage
// (which has no component test), so this locks what the extraction exposed.
// Only the network functions are mocked; the optimistic helpers, the cache
// and the toast store are real. So each test checks what the user sees:
// - add: a placeholder row in the categories cache while the create is
//   pending, in the sort slot the server will assign.
// - rename: only the name changes.
// - delete: the row goes, and the gear caches are refreshed, because the
//   server uncategorizes the category's gear in the same transaction.
// - which failures toast.

const h = vi.hoisted(() => ({
  createCategory: vi.fn<(name: string) => Promise<unknown>>(),
  renameCategory: vi.fn<(id: string, name: string) => Promise<void>>(),
  deleteCategory: vi.fn<(id: string) => Promise<void>>(),
}))

vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  ...h,
}))
// Deterministic temp id so the optimistic placeholder is exact-matchable.
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))

import { useGearCategoryActions } from './use-gear-category-actions'

const NOW = '2026-01-01T00:00:00.000Z'
const DELETE_TOAST =
  "Couldn't confirm that category was deleted. Refresh to check before trying again."

function category(over: Partial<Category> = {}): Category {
  return {
    id: 'c1', name: 'Shelter', sortOrder: 0, createdAt: NOW, ...over,
  }
}

// Seeds the categories cache with the same rows the page passes to the hook.
function setup(categories: Category[] = [category()]) {
  const qc = testQueryClient()
  qc.setQueryData<Category[]>(['categories'], categories)
  const result = renderHookWithClient(qc, () => useGearCategoryActions(categories))
  return { qc, result }
}

const cachedCategories = (qc: ReturnType<typeof testQueryClient>) =>
  qc.getQueryData<Category[]>(['categories'])

afterEach(() => {
  vi.clearAllMocks()
  clearToasts()
})

describe('useGearCategoryActions', () => {
  describe('addCategory', () => {
    it('creates a category by name and shows a placeholder in the next sort slot while it is pending', async () => {
      const create = deferred<unknown>()
      h.createCategory.mockReturnValueOnce(create.promise)
      const existing = category({ id: 'c0', sortOrder: 2 })
      const { qc, result } = setup([existing])

      result.current.addCategory.mutate('Cooking')

      // The server assigns the real sortOrder (max+1); the client sends
      // only the name.
      await waitFor(() => expect(h.createCategory).toHaveBeenCalledWith('Cooking'))
      // The placeholder's sortOrder is what the server will assign, so the
      // row lands in place before the settled refetch replaces it.
      await waitFor(() => expect(cachedCategories(qc)).toHaveLength(2))
      expect(cachedCategories(qc)).toEqual([
        existing,
        expect.objectContaining({ id: 'temp-tmp-id', name: 'Cooking', sortOrder: 3 }),
      ])

      create.resolve({ id: 'c-new' })
      await waitFor(() => expect(result.current.addCategory.isSuccess).toBe(true))
    })

    it('carries no rollback toast, because both its call sites surface failures inline', async () => {
      // Load-bearing absence. `addCategory` is fired from two places: the gear
      // library's inline toolbar editor, which keeps its own error, and
      // GearItemDialog's "create category" affordance, which keeps `categoryError`.
      // A toast as well would say the same thing twice. See the modal rule in
      // src/lib/mutation-error-handler.ts.
      h.createCategory.mockRejectedValueOnce(new Error('boom'))
      const existing = category()
      const { qc, result } = setup([existing])

      result.current.addCategory.mutate('Cooking')

      await waitFor(() => expect(result.current.addCategory.isError).toBe(true))
      expect(cachedCategories(qc)).toEqual([existing])
      expect(toastMessages()).toEqual([])
    })
  })

  describe('renameCategory', () => {
    it('sends the new name by id and changes only that name in the cache', async () => {
      const rename = deferred()
      h.renameCategory.mockReturnValueOnce(rename.promise)
      const target = category({ id: 'c1', name: 'Shelter', sortOrder: 4 })
      const other = category({ id: 'c2', name: 'Kitchen', sortOrder: 5 })
      const { qc, result } = setup([target, other])

      result.current.renameCategory.mutate({ id: 'c1', name: 'Shelter v2' })

      await waitFor(() => expect(h.renameCategory).toHaveBeenCalledWith('c1', 'Shelter v2'))
      await waitFor(() =>
        expect(cachedCategories(qc)).toEqual([{ ...target, name: 'Shelter v2' }, other]),
      )
      rename.resolve()
      await waitFor(() => expect(result.current.renameCategory.isSuccess).toBe(true))
    })
  })

  describe('removeCategory', () => {
    it('deletes by id and refreshes the gear-items and list-items caches so uncategorized items re-render after the server-side uncategorize', async () => {
      const remove = deferred()
      h.deleteCategory.mockReturnValueOnce(remove.promise)
      const keep = category({ id: 'c2', sortOrder: 1 })
      const { qc, result } = setup([category({ id: 'c1' }), keep])
      // The server sets gear_items.categoryId to NULL in the same transaction
      // (it does NOT delete gear). Refreshing the gear cache shows the
      // now-uncategorized items, and the ['list-items'] prefix covers every
      // per-list cache embedding the same gear DTO through list_items.gearItem.
      qc.setQueryData<GearItem[]>(['gear-items'], [])
      qc.setQueryData<ListItemWithGear[]>(['list-items', 'list-1'], [])

      result.current.removeCategory.mutate('c1')

      await waitFor(() => expect(h.deleteCategory).toHaveBeenCalledWith('c1'))
      await waitFor(() => expect(cachedCategories(qc)).toEqual([keep]))
      expect(qc.getQueryState(['gear-items'])?.isInvalidated).toBe(false)

      remove.resolve()
      await waitFor(() => expect(result.current.removeCategory.isSuccess).toBe(true))
      expect(qc.getQueryState(['gear-items'])?.isInvalidated).toBe(true)
      expect(qc.getQueryState(['list-items', 'list-1'])?.isInvalidated).toBe(true)
    })

    it('asks for a rollback toast, unlike the in-place rename', async () => {
      // The rule in src/lib/mutation-error-handler.ts, pinned at both call sites
      // in one test so the contrast is the assertion: a category SECTION
      // disappearing and returning after the confirm has closed needs saying out
      // loud, a rename reverting in the field under the cursor does not.
      h.renameCategory.mockRejectedValueOnce(new Error('boom'))
      h.deleteCategory.mockRejectedValueOnce(new Error('boom'))
      const existing = category({ id: 'c1', name: 'Shelter' })
      const { qc, result } = setup([existing])

      result.current.renameCategory.mutate({ id: 'c1', name: 'Shelter v2' })
      await waitFor(() => expect(result.current.renameCategory.isError).toBe(true))
      expect(cachedCategories(qc)).toEqual([existing])
      expect(toastMessages()).toEqual([])

      result.current.removeCategory.mutate('c1')
      await waitFor(() => expect(result.current.removeCategory.isError).toBe(true))
      expect(cachedCategories(qc)).toEqual([existing])
      expect(toastMessages()).toEqual([DELETE_TOAST])
    })
  })
})
