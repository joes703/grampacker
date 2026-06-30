// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { GearItem } from '../lib/types'

// The add/edit/delete gear-item mutations were inline in GearLibraryPage (which
// has no component test), so this locks the logic the extraction exposed: add
// goes through createGearItem at the next sort slot with the right optimistic
// placeholder, and edit/delete compose the GEAR-SPECIFIC fan-out helpers (not
// the generic optimistic helpers). The fan-out cache lifecycle itself (the
// patch-affects-view gate, rollback, dual-cache invalidation) is owned and
// tested by gear-list-items-fan-out.test.ts; here we mock those helpers and
// assert only that the hook wires the correct path, not their internals.

type GearItemInput = Pick<
  GearItem,
  'name' | 'description' | 'weight_grams' | 'category_id' | 'cost' | 'purchase_date' | 'status'
>
type OptimisticLifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }
type InsertOpts = { qc: unknown; queryKey: unknown; optimistic: (data: GearItemInput) => GearItem }

const h = vi.hoisted(() => ({
  queryKeys: { gearItems: () => ['gear-items'] as const },
  createGearItem: vi.fn<(userId: string, data: GearItemInput, sortOrder: number) => Promise<unknown>>(),
  updateGearItem: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteGearItem: vi.fn<(id: string) => Promise<void>>(),
  nextGearItemSortOrder: vi.fn<(items: unknown[]) => number>(),
  makeOptimisticInsert: vi.fn<(opts: InsertOpts) => OptimisticLifecycle>(),
}))
const fanout = vi.hoisted(() => ({
  makeOptimisticGearItemUpdate: vi.fn<(qc: unknown) => OptimisticLifecycle>(),
  makeOptimisticGearItemDelete: vi.fn<(qc: unknown) => OptimisticLifecycle>(),
}))

vi.mock('../lib/queries', () => h)
vi.mock('../lib/queries/gear-list-items-fan-out', () => fanout)
// Deterministic temp id so the optimistic placeholder is exact-matchable.
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))

import { useGearItemActions } from './use-gear-item-actions'

const NOW = '2026-01-01T00:00:00.000Z'

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1', user_id: 'u1', category_id: 'c1', name: 'Tent', description: null,
    weight_grams: 1200, cost: null, purchase_date: null, status: 'active',
    sort_order: 0, created_at: NOW, updated_at: NOW, ...over,
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
  const { result } = renderHook(() => useGearItemActions('u1', allItems), { wrapper })
  return { result }
}

beforeEach(() => {
  h.makeOptimisticInsert.mockReturnValue(lifecycle())
  fanout.makeOptimisticGearItemUpdate.mockReturnValue(lifecycle())
  fanout.makeOptimisticGearItemDelete.mockReturnValue(lifecycle())
  h.nextGearItemSortOrder.mockReturnValue(7)
  h.createGearItem.mockResolvedValue({ id: 'g-new' })
  h.updateGearItem.mockResolvedValue(undefined)
  h.deleteGearItem.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe('useGearItemActions', () => {
  describe('addItem', () => {
    it('creates a gear item at the next sort slot and targets the gear-items cache', async () => {
      const { result } = setup([gear({ id: 'g0', sort_order: 3 })])
      const data: GearItemInput = {
        name: 'Stove', description: null, weight_grams: 90, category_id: 'c1',
        cost: null, purchase_date: null, status: 'active',
      }

      result.current.addItem.mutate(data)

      await waitFor(() => expect(h.createGearItem).toHaveBeenCalledWith('u1', data, 7))
      // Optimistic insert wired to ['gear-items'] - the cache it settles/invalidates.
      expect(h.makeOptimisticInsert).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['gear-items'] }),
      )
    })

    it('builds an optimistic placeholder with a temp id, the owner, and the next sort slot', () => {
      setup([])
      const opts = h.makeOptimisticInsert.mock.calls[0]![0]
      const placeholder = opts.optimistic({
        name: 'Stove', description: 'liquid fuel', weight_grams: 90, category_id: 'c2',
        cost: 80, purchase_date: '2026-01-01', status: 'active',
      })
      expect(placeholder).toMatchObject({
        id: 'temp-tmp-id', user_id: 'u1', name: 'Stove', description: 'liquid fuel',
        category_id: 'c2', weight_grams: 90, cost: 80, purchase_date: '2026-01-01',
        status: 'active', sort_order: 7,
      })
    })
  })

  describe('editItem', () => {
    it('updates by id through the gear fan-out update path', async () => {
      const { result } = setup()

      result.current.editItem.mutate({ id: 'g1', patch: { name: 'New name' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { name: 'New name' }))
      // The gear-specific fan-out helper (dual-cache lifecycle), NOT the generic
      // makeOptimisticUpdate - the F1 fan-out boundary is preserved.
      expect(fanout.makeOptimisticGearItemUpdate).toHaveBeenCalled()
    })

    it('forwards a status-only patch unchanged (the inline quick-status path)', async () => {
      const { result } = setup()

      result.current.editItem.mutate({ id: 'g1', patch: { status: 'loaned_out' } })

      await waitFor(() => expect(h.updateGearItem).toHaveBeenCalledWith('g1', { status: 'loaned_out' }))
    })
  })

  describe('removeItem', () => {
    it('deletes by id through the gear fan-out delete path', async () => {
      const { result } = setup()

      result.current.removeItem.mutate('g1')

      await waitFor(() => expect(h.deleteGearItem).toHaveBeenCalledWith('g1'))
      expect(fanout.makeOptimisticGearItemDelete).toHaveBeenCalled()
    })
  })
})
