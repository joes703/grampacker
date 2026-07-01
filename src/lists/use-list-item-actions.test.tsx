// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { GearItem, ListItemWithGear } from '../lib/types'
import { mutationErrorHandler } from '../lib/mutation-error-handler'

// The add/update/delete/quick-add list-item mutations were inline in
// ListDetailPage (which has no component test), so this locks the logic the
// extraction exposed: the correct query helpers are called with the right args,
// the optimistic helpers are wired to the ['list-items', listId] cache, addNewItem
// maps AddItemData -> the new addGearItemWithListItem wrapper and invalidates both
// caches, and - the highest-value regression - the update sibling-in-flight gate
// only lets the LAST-settled concurrent update refetch. The optimistic cache
// lifecycle itself is owned/tested by optimistic.ts; here we mock those helpers
// and assert wiring, not internals.

const LIST_ID = 'list-1'
const USER_ID = 'u1'

type Lifecycle = { onMutate: () => unknown; onError: () => void; onSettled: () => void }
type InsertOpts = { qc: unknown; queryKey: unknown; optimistic: (item: GearItem) => ListItemWithGear }

const h = vi.hoisted(() => ({
  queryKeys: {
    gearItems: () => ['gear-items'] as const,
    listItems: (id: string) => ['list-items', id] as const,
  },
  addGearItemToList: vi.fn<(listId: string, userId: string, gearItemId: string, sortOrder: number) => Promise<unknown>>(),
  addGearItemWithListItem: vi.fn<(params: Record<string, unknown>) => Promise<void>>(),
  updateListItem: vi.fn<(id: string, patch: unknown) => Promise<void>>(),
  deleteListItem: vi.fn<(id: string) => Promise<void>>(),
  nextGearItemSortOrder: vi.fn<(items: unknown[]) => number>(),
  nextListItemSortOrder: vi.fn<(items: unknown[]) => number>(),
  makeOptimisticInsert: vi.fn<(opts: InsertOpts) => Lifecycle>(),
  makeOptimisticUpdate: vi.fn<(opts: { queryKey: unknown }) => Lifecycle>(),
  makeOptimisticDelete: vi.fn<(opts: { queryKey: unknown }) => Lifecycle>(),
}))
const toast = vi.hoisted(() => ({ showToast: vi.fn<(message: string, options?: unknown) => number>() }))

vi.mock('../lib/queries', () => h)
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))
vi.mock('../lib/toast', () => toast)

import { useListItemActions } from './use-list-item-actions'

const lifecycle = (): Lifecycle => ({ onMutate: vi.fn(), onError: vi.fn(), onSettled: vi.fn() })

function gear(over: Partial<GearItem> = {}): GearItem {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'g1', user_id: USER_ID, category_id: 'c1', name: 'Tent', description: null,
    weight_grams: 1200, cost: null, purchase_date: null, status: 'active',
    sort_order: 0, created_at: now, updated_at: now, ...over,
  }
}

const sampleAddData = {
  name: 'Stove', description: 'liquid fuel', weight_grams: 90,
  quantity: 2, is_worn: true, is_consumable: true,
}

function makeQc() {
  return new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderWith(qc: QueryClient, listItems: ListItemWithGear[] = [], gearItems: GearItem[] = []) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => useListItemActions(LIST_ID, USER_ID, { listItems, gearItems }),
    { wrapper },
  ).result
}

function setup(listItems: ListItemWithGear[] = [], gearItems: GearItem[] = []) {
  const qc = makeQc()
  return { qc, result: renderWith(qc, listItems, gearItems) }
}

const invalidationsFor = (spy: ReturnType<typeof vi.spyOn>, key: readonly unknown[]) =>
  spy.mock.calls.filter((call: unknown[]) => {
    const arg = call[0] as { queryKey?: unknown } | undefined
    return JSON.stringify(arg?.queryKey) === JSON.stringify(key)
  }).length

beforeEach(() => {
  h.makeOptimisticInsert.mockReturnValue(lifecycle())
  h.makeOptimisticUpdate.mockReturnValue(lifecycle())
  h.makeOptimisticDelete.mockReturnValue(lifecycle())
  h.nextListItemSortOrder.mockReturnValue(5)
  h.nextGearItemSortOrder.mockReturnValue(9)
  h.addGearItemToList.mockResolvedValue({ id: 'li-new' })
  h.addGearItemWithListItem.mockResolvedValue(undefined)
  h.updateListItem.mockResolvedValue(undefined)
  h.deleteListItem.mockResolvedValue(undefined)
  toast.showToast.mockReturnValue(0)
})

afterEach(() => vi.clearAllMocks())

describe('useListItemActions', () => {
  describe('addItem', () => {
    it('adds the gear item to the list at the next sort slot and targets the list-items cache', async () => {
      const { result } = setup()

      result.current.addItem.mutate(gear({ id: 'g1' }))

      await waitFor(() => expect(h.addGearItemToList).toHaveBeenCalledWith(LIST_ID, USER_ID, 'g1', 5))
      expect(h.makeOptimisticInsert).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['list-items', LIST_ID] }),
      )
    })

    it('builds an optimistic placeholder preserving the embedded gear_item, default flags, temp id, and sort order', () => {
      setup()
      const opts = h.makeOptimisticInsert.mock.calls[0]![0]
      const placeholder = opts.optimistic(
        gear({ id: 'g1', name: 'Tent', description: 'palace', weight_grams: 1200, category_id: 'c1', status: 'active' }),
      )
      expect(placeholder).toMatchObject({
        id: 'temp-tmp-id', list_id: LIST_ID, user_id: USER_ID, gear_item_id: 'g1',
        gear_item: {
          id: 'g1', name: 'Tent', description: 'palace', weight_grams: 1200,
          category_id: 'c1', status: 'active',
        },
        quantity: 1, is_worn: false, is_consumable: false, is_packed: false, is_ready: false,
        sort_order: 5,
      })
    })
  })

  describe('updateItem', () => {
    it('patches the list item by id and targets the list-items cache', async () => {
      const { result } = setup()

      result.current.updateItem.mutate({ itemId: 'a', patch: { is_packed: true } })

      await waitFor(() => expect(h.updateListItem).toHaveBeenCalledWith('a', { is_packed: true }))
      expect(h.makeOptimisticUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['list-items', LIST_ID] }),
      )
    })

    it('sibling-in-flight gate: concurrent updates never over-invalidate the list-items cache', async () => {
      // The gate REPLACES makeOptimisticUpdate's default "invalidate list-items
      // on every settle" (makeSettled) with a guarded invalidate: skip the
      // refetch while any sibling update-list-item mutation is still pending, so
      // rapid Packed-then-Ready taps can't have the first settle refetch stale
      // server data over the second's optimistic value.
      //
      // Actual runtime (locked here as behavior we must preserve verbatim from
      // main): in TanStack Query v5 a mutation dispatches its `success` state
      // AFTER options.onSettled runs (query-core mutation.ts: onSettled ~L137,
      // success dispatch ~L144), so qc.isMutating({ mutationKey }) still counts
      // the settling mutation ITSELF during its own onSettled. The `> 0` guard is
      // therefore always true and the invalidate never fires - even for a single
      // update. Net effect: the optimistic write is the source of truth for these
      // field patches and no post-update refetch can race a sibling.
      //
      // So two concurrent updates settle with ZERO list-items invalidations. This
      // still catches a regression that drops the gate: the bare makeSettled
      // default would invalidate on each settle (count 2). See PR notes - the
      // gate's stated intent ("only the LAST settled call refetches") differs from
      // this runtime behavior; that discrepancy is deliberately left for a
      // separate, non-refactor change.
      let resolveA!: () => void
      let resolveB!: () => void
      h.updateListItem
        .mockImplementationOnce(() => new Promise<void>((r) => { resolveA = () => r() }))
        .mockImplementationOnce(() => new Promise<void>((r) => { resolveB = () => r() }))
      const qc = makeQc()
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
      // Two observers on one QueryClient == two updates in flight against one
      // cache, the exact scenario the gate guards.
      const a = renderWith(qc)
      const b = renderWith(qc)

      await act(async () => {
        a.current.updateItem.mutate({ itemId: 'a', patch: { is_packed: true } })
        b.current.updateItem.mutate({ itemId: 'b', patch: { is_ready: true } })
      })
      await waitFor(() => expect(h.updateListItem).toHaveBeenCalledTimes(2))

      // First settles while the second is still pending -> gate skips the refetch.
      await act(async () => { resolveA() })
      await waitFor(() => expect(a.current.updateItem.isSuccess).toBe(true))
      expect(invalidationsFor(invalidateSpy, ['list-items', LIST_ID])).toBe(0)

      // Last settles -> gate still skips (self-count), so no refetch races either write.
      await act(async () => { resolveB() })
      await waitFor(() => expect(b.current.updateItem.isSuccess).toBe(true))
      expect(invalidationsFor(invalidateSpy, ['list-items', LIST_ID])).toBe(0)
    })
  })

  describe('deleteItem', () => {
    it('deletes the list item by id and targets the list-items cache', async () => {
      const { result } = setup()

      result.current.deleteItem.mutate('a')

      await waitFor(() => expect(h.deleteListItem).toHaveBeenCalledWith('a'))
      expect(h.makeOptimisticDelete).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['list-items', LIST_ID] }),
      )
    })
  })

  describe('addNewItem', () => {
    it('maps AddItemData to the addGearItemWithListItem wrapper params', async () => {
      const { result } = setup()

      result.current.addNewItem.mutate({ categoryId: 'c2', data: sampleAddData })

      await waitFor(() =>
        expect(h.addGearItemWithListItem).toHaveBeenCalledWith({
          userId: USER_ID,
          name: 'Stove',
          description: 'liquid fuel',
          weightGrams: 90,
          categoryId: 'c2',
          gearSortOrder: 9,
          listId: LIST_ID,
          listItemSortOrder: 5,
          quantity: 2,
          isWorn: true,
          isConsumable: true,
        }),
      )
    })

    it('invalidates exactly the gear-items and list-items caches on success', async () => {
      const { qc, result } = setup()
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

      result.current.addNewItem.mutate({ categoryId: null, data: sampleAddData })

      await waitFor(() => expect(h.addGearItemWithListItem).toHaveBeenCalled())
      await waitFor(() => {
        expect(invalidationsFor(invalidateSpy, ['gear-items'])).toBe(1)
        expect(invalidationsFor(invalidateSpy, ['list-items', LIST_ID])).toBe(1)
      })
    })

    it('surfaces the errorToast copy on failure (via meta + the global handler)', async () => {
      h.addGearItemWithListItem.mockRejectedValueOnce(new Error('boom'))
      const { result } = setup()

      result.current.addNewItem.mutate({ categoryId: null, data: sampleAddData })

      await waitFor(() =>
        expect(toast.showToast).toHaveBeenCalledWith(
          "Couldn't add that item. Please try again.",
          { type: 'error' },
        ),
      )
    })
  })

  it('returns raw mutations usable with mutate-time callbacks (the page uses call-site onSuccess/onSettled)', async () => {
    const { result } = setup()
    const onSuccess = vi.fn()

    result.current.addItem.mutate(gear({ id: 'g1' }), { onSuccess })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })
})
