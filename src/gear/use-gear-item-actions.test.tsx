// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { GearItem } from '../lib/types'

// The add/edit/delete gear-item mutations were inline in GearLibraryPage (which
// has no component test), so this locks the logic the extraction exposed: add
// goes through createGearItem with the right optimistic placeholder (the SERVER
// assigns the real sort slot; the placeholder computes the same value), and
// edit/delete compose the GENERIC optimistic helpers on the gearItems cache.
// (The old repo routed edit/delete through the gear-list-items fan-out helpers;
// that boundary returns with the lists slice in phase 3.) The optimistic cache
// lifecycle itself (rollback, invalidation) is owned and tested by
// optimistic.test.ts; here we mock those helpers and assert only that the hook
// wires the correct path + options.

type GearItemInput = Pick<
  GearItem,
  'name' | 'description' | 'weightGrams' | 'categoryId' | 'cost' | 'purchaseDate' | 'status'
>
type GearItemPatch = Partial<GearItemInput>
type EditInput = { id: string; patch: GearItemPatch }
type OptimisticLifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }
type InsertOpts = { qc: unknown; queryKey: unknown; optimistic: (data: GearItemInput) => GearItem }
type UpdateOpts = {
  qc: unknown
  queryKey: unknown
  id: (input: EditInput) => string
  apply: (item: GearItem, input: EditInput) => GearItem
}
type DeleteOpts = { qc: unknown; queryKey: unknown; id: (input: string) => string }

const h = vi.hoisted(() => ({
  queryKeys: { gearItems: () => ['gear-items'] as const },
  createGearItem: vi.fn<(data: GearItemInput) => Promise<unknown>>(),
  updateGearItem: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteGearItem: vi.fn<(id: string) => Promise<void>>(),
  nextGearItemSortOrder: vi.fn<(items: unknown[]) => number>(),
  makeOptimisticInsert: vi.fn<(opts: InsertOpts) => OptimisticLifecycle>(),
  makeOptimisticUpdate: vi.fn<(opts: UpdateOpts) => OptimisticLifecycle>(),
  makeOptimisticDelete: vi.fn<(opts: DeleteOpts) => OptimisticLifecycle>(),
}))

vi.mock('../lib/queries', () => h)
// Deterministic temp id so the optimistic placeholder is exact-matchable.
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))

import { useGearItemActions } from './use-gear-item-actions'

const NOW = '2026-01-01T00:00:00.000Z'

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1', categoryId: 'c1', name: 'Tent', description: null,
    weightGrams: 1200, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: NOW, updatedAt: NOW, ...over,
  }
}

function lifecycle(): OptimisticLifecycle {
  return { onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
}

function setup(allItems: GearItem[] = []) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useGearItemActions(allItems), { wrapper })
  return { result }
}

beforeEach(() => {
  h.makeOptimisticInsert.mockReturnValue(lifecycle())
  h.makeOptimisticUpdate.mockReturnValue(lifecycle())
  h.makeOptimisticDelete.mockReturnValue(lifecycle())
  h.nextGearItemSortOrder.mockReturnValue(7)
  h.createGearItem.mockResolvedValue({ id: 'g-new' })
  h.updateGearItem.mockResolvedValue(undefined)
  h.deleteGearItem.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('useGearItemActions', () => {
  describe('addItem', () => {
    it('creates a gear item and targets the gear-items cache', async () => {
      const { result } = setup([gear({ id: 'g0', sortOrder: 3 })])
      const data: GearItemInput = {
        name: 'Stove', description: null, weightGrams: 90, categoryId: 'c1',
        cost: null, purchaseDate: null, status: 'active',
      }

      result.current.addItem.mutate(data)

      // The server assigns the real sortOrder (max+1); the client sends
      // only the item fields.
      await waitFor(() => expect(h.createGearItem).toHaveBeenCalledWith(data))
      // Optimistic insert wired to ['gear-items'] - the cache it settles/invalidates.
      expect(h.makeOptimisticInsert).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['gear-items'] }),
      )
    })

    it('builds an optimistic placeholder with a temp id and the next sort slot', () => {
      setup([])
      const opts = h.makeOptimisticInsert.mock.calls[0]![0]
      const placeholder = opts.optimistic({
        name: 'Stove', description: 'liquid fuel', weightGrams: 90, categoryId: 'c2',
        cost: 80, purchaseDate: '2026-01-01', status: 'active',
      })
      // The placeholder's sortOrder mirrors what the server will assign
      // (nextGearItemSortOrder over the cached rows) so the row lands in
      // place before the settled refetch reconciles it.
      expect(placeholder).toMatchObject({
        id: 'temp-tmp-id', name: 'Stove', description: 'liquid fuel',
        categoryId: 'c2', weightGrams: 90, cost: 80, purchaseDate: '2026-01-01',
        status: 'active', sortOrder: 7,
      })
    })
  })

  describe('editItem', () => {
    it('updates by id through the generic optimistic update on the gear-items cache', async () => {
      const { result } = setup()

      result.current.editItem.mutate({ id: 'g1', patch: { name: 'New name' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { name: 'New name' }))
      expect(h.makeOptimisticUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['gear-items'] }),
      )
    })

    it('applies the patch optimistically but never overwrites a field with undefined', () => {
      setup()
      const opts = h.makeOptimisticUpdate.mock.calls[0]![0]
      expect(opts.id({ id: 'g9', patch: {} })).toBe('g9')
      // PATCH semantics: undefined = unchanged. A patch that sets weight
      // and leaves name undefined must not blank the cached name.
      const next = opts.apply(gear({ name: 'Tent' }), {
        id: 'g1',
        patch: { weightGrams: 999, name: undefined },
      })
      expect(next).toMatchObject({ name: 'Tent', weightGrams: 999 })
    })

    it('forwards a status-only patch unchanged (the inline quick-status path)', async () => {
      const { result } = setup()

      result.current.editItem.mutate({ id: 'g1', patch: { status: 'loaned_out' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { status: 'loaned_out' }))
    })
  })

  describe('removeItem', () => {
    it('deletes by id through the generic optimistic delete on the gear-items cache', async () => {
      const { result } = setup()

      result.current.removeItem.mutate('g1')

      await waitFor(() => expect(h.deleteGearItem).toHaveBeenCalledWith('g1'))
      expect(h.makeOptimisticDelete).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['gear-items'] }),
      )
    })
  })
})
