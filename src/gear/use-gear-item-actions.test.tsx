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
// edit/delete compose the gear-list-items FAN-OUT helpers (gear writes render
// from the gear library AND any open list view). The fan-out cache lifecycle
// itself (cross-cache snapshot, rollback, invalidation, PATCH merge) is owned
// and tested by gear-list-items-fan-out.test.ts; here we mock the helpers and
// assert only that the hook wires the correct path.

type GearItemInput = Pick<
  GearItem,
  'name' | 'description' | 'weightGrams' | 'categoryId' | 'cost' | 'purchaseDate' | 'status'
>
type OptimisticLifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }
type InsertOpts = { qc: unknown; queryKey: unknown; optimistic: (data: GearItemInput) => GearItem }
type FanOutOpts = { qc: unknown; errorToast?: string }

const h = vi.hoisted(() => ({
  queryKeys: { gearItems: () => ['gear-items'] as const },
  createGearItem: vi.fn<(data: GearItemInput) => Promise<unknown>>(),
  updateGearItem: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteGearItem: vi.fn<(id: string) => Promise<void>>(),
  nextGearItemSortOrder: vi.fn<(items: unknown[]) => number>(),
  makeOptimisticInsert: vi.fn<(opts: InsertOpts) => OptimisticLifecycle>(),
  makeOptimisticGearItemUpdate: vi.fn<(opts: FanOutOpts) => OptimisticLifecycle>(),
  makeOptimisticGearItemDelete: vi.fn<(opts: FanOutOpts) => OptimisticLifecycle>(),
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
  return { result, qc }
}

beforeEach(() => {
  h.makeOptimisticInsert.mockReturnValue(lifecycle())
  h.makeOptimisticGearItemUpdate.mockReturnValue(lifecycle())
  h.makeOptimisticGearItemDelete.mockReturnValue(lifecycle())
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
      // A brand-new gear item cannot be in any list yet, so insert stays
      // on the single-cache helper (no fan-out).
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
    it('updates by id through the gear fan-out (library + list caches)', async () => {
      const { result, qc } = setup()

      result.current.editItem.mutate({ id: 'g1', patch: { name: 'New name' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { name: 'New name' }))
      // The fan-out helper receives the hook's QueryClient; no errorToast -
      // single-item mutations rely on the global mutation error handler.
      expect(h.makeOptimisticGearItemUpdate).toHaveBeenCalledWith({ qc })
    })

    it('forwards a status-only patch unchanged (the inline quick-status path)', async () => {
      const { result } = setup()

      result.current.editItem.mutate({ id: 'g1', patch: { status: 'loaned_out' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { status: 'loaned_out' }))
    })
  })

  describe('removeItem', () => {
    it('deletes by id through the gear fan-out (cascade mirrors the server)', async () => {
      const { result, qc } = setup()

      result.current.removeItem.mutate('g1')

      await waitFor(() => expect(h.deleteGearItem).toHaveBeenCalledWith('g1'))
      expect(h.makeOptimisticGearItemDelete).toHaveBeenCalledWith(
        expect.objectContaining({ qc }),
      )
    })

    it('asks the fan-out to toast the rollback, with the same copy as the list-side delete', async () => {
      // Wiring only - that the option actually produces a toast is the helper's
      // own test (gear-list-items-fan-out.test.ts). What is asserted here is the
      // rule from src/lib/mutation-error-handler.ts holding at this call site: a
      // delete's rollback is a row REAPPEARING after the confirm has closed, which
      // is the case the toast exists for. The edit above deliberately has none.
      const { result, qc } = setup()

      result.current.removeItem.mutate('g1')

      await waitFor(() => expect(h.deleteGearItem).toHaveBeenCalledWith('g1'))
      expect(h.makeOptimisticGearItemDelete).toHaveBeenCalledWith({
        qc,
        errorToast: "Couldn't confirm that item was deleted. Refresh to check before trying again.",
      })
    })
  })
})
