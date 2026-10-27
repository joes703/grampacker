// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { GearItem, ListItemWithGear } from '../lib/types'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { deferred } from '../test/deferred'

// The add/update/move/delete/quick-add list-item mutations were inline in
// ListDetailPage (which has no component test), so this locks the logic the
// extraction exposed: the correct query helpers are called with the right args,
// the optimistic helpers are wired to the ['list-items', listId] cache, addNewItem
// maps AddItemData -> the quickAddListItem request and invalidates both
// caches, and - the highest-value regressions - updateItem's hand-rolled
// lifecycle: field-scoped rollbacks that compose under concurrency (a failing
// patch restores ONLY its own fields, never a sibling's optimistic write) and
// the last-one-out invalidation gate (no refetch while siblings are pending;
// exactly one after the final settle, which is what re-converges the cache
// with server truth after external races). Only the network functions and
// the toast are mocked: add and delete run the real optimistic helpers, so
// their tests read the cache the user sees.

const LIST_ID = 'list-1'

const h = vi.hoisted(() => ({
  addListItem: vi.fn<(listId: string, gearItemId: string) => Promise<unknown>>(),
  quickAddListItem: vi.fn<(listId: string, input: Record<string, unknown>) => Promise<void>>(),
  updateListItem: vi.fn<(listId: string, itemId: string, patch: unknown) => Promise<void>>(),
  deleteListItem: vi.fn<(listId: string, itemId: string) => Promise<void>>(),
}))
const toast = vi.hoisted(() => ({ showToast: vi.fn<(message: string, options?: unknown) => number>() }))

vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  ...h,
}))
vi.mock('../lib/random-temp-id', () => ({ randomTempId: () => 'tmp-id' }))
vi.mock('../lib/toast', () => toast)

import { useListItemActions } from './use-list-item-actions'

function gear(over: Partial<GearItem> = {}): GearItem {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'g1', categoryId: 'c1', name: 'Tent', description: null,
    weightGrams: 1200, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: now, updatedAt: now, ...over,
  }
}

function item(over: Partial<ListItemWithGear> = {}): ListItemWithGear {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'a', listId: LIST_ID, gearItemId: 'g1', gearItem: gear(),
    quantity: 1, isWorn: false, isConsumable: false, isPacked: false, isReady: false,
    packingLocationId: null,
    sortOrder: 0, packSortOrder: 0, createdAt: now, updatedAt: now, ...over,
  }
}

const sampleAddData = {
  name: 'Stove', description: 'liquid fuel', weightGrams: 90,
  quantity: 2, isWorn: true, isConsumable: true,
}

function makeQc() {
  return new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderWith(qc: QueryClient, listItems: ListItemWithGear[] = []) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => useListItemActions(LIST_ID, { listItems, foodItems: [] }),
    { wrapper },
  ).result
}

// Seeds the list-items cache with the rows the page passes to the hook.
function setup(listItems: ListItemWithGear[] = []) {
  const qc = makeQc()
  qc.setQueryData<ListItemWithGear[]>(['list-items', LIST_ID], listItems)
  return { qc, result: renderWith(qc, listItems) }
}

const cachedItems = (qc: QueryClient) =>
  qc.getQueryData<ListItemWithGear[]>(['list-items', LIST_ID])

const invalidationsFor = (spy: ReturnType<typeof vi.spyOn>, key: readonly unknown[]) =>
  spy.mock.calls.filter((call: unknown[]) => {
    const arg = call[0] as { queryKey?: unknown } | undefined
    return JSON.stringify(arg?.queryKey) === JSON.stringify(key)
  }).length

beforeEach(() => {
  h.addListItem.mockResolvedValue({ id: 'li-new' })
  h.quickAddListItem.mockResolvedValue(undefined)
  h.updateListItem.mockResolvedValue(undefined)
  h.deleteListItem.mockResolvedValue(undefined)
  toast.showToast.mockReturnValue(0)
})

afterEach(() => vi.clearAllMocks())

describe('useListItemActions', () => {
  describe('addItem', () => {
    it('adds the gear item to the list and shows it in the list-items cache while it is pending', async () => {
      const add = deferred<unknown>()
      h.addListItem.mockReturnValueOnce(add.promise)
      const existing = item({ id: 'a', gearItemId: 'g0' })
      const { qc, result } = setup([existing])

      result.current.addItem.mutate(gear({ id: 'g1' }))

      await waitFor(() => expect(h.addListItem).toHaveBeenCalledWith(LIST_ID, 'g1'))
      await waitFor(() => expect(cachedItems(qc)).toHaveLength(2))
      expect(cachedItems(qc)?.[0]).toBe(existing)
      expect(cachedItems(qc)?.[1]).toMatchObject({ id: 'temp-tmp-id', gearItemId: 'g1' })

      add.resolve({ id: 'li-new' })
      await waitFor(() => expect(result.current.addItem.isSuccess).toBe(true))
    })

    it('builds an optimistic placeholder preserving the embedded gearItem, default flags, temp id, and sort order', async () => {
      const add = deferred<unknown>()
      h.addListItem.mockReturnValueOnce(add.promise)
      const { qc, result } = setup([item({ id: 'a', gearItemId: 'g0', sortOrder: 4 })])
      const g = gear({ id: 'g1', name: 'Tent', description: 'palace', weightGrams: 1200, categoryId: 'c1', status: 'active' })

      result.current.addItem.mutate(g)

      await waitFor(() => expect(cachedItems(qc)).toHaveLength(2))
      const placeholder = cachedItems(qc)![1]!
      expect(placeholder).toMatchObject({
        id: 'temp-tmp-id', listId: LIST_ID, gearItemId: 'g1',
        quantity: 1, isWorn: false, isConsumable: false, isPacked: false, isReady: false,
        sortOrder: 5,
      })
      // The new DTO embeds the FULL gear response; the placeholder embeds
      // the passed gear as-is (same reference, whole shape).
      expect(placeholder.gearItem).toBe(g)

      add.resolve({ id: 'li-new' })
      await waitFor(() => expect(result.current.addItem.isSuccess).toBe(true))
    })
  })

  describe('updateItem', () => {
    it('patches the list item by parent path + id and writes the patch optimistically', async () => {
      const qc = makeQc()
      qc.setQueryData<ListItemWithGear[]>(['list-items', LIST_ID], [item({ id: 'a' })])
      const result = renderWith(qc)

      // Hold the PATCH open so "optimistic" means something. onMutate now awaits
      // cancelQueries (so an in-flight refetch cannot clobber the write), which
      // pushes the cache write one microtask out - a plain synchronous read right
      // after .mutate() would miss it. But simply awaiting the write instead would
      // be a weaker test: it would also pass if the write only landed AFTER the
      // server answered, which is the opposite of optimistic. So: keep the request
      // unresolved, wait for the cache to update, and assert the request is still
      // in flight at that moment.
      let settlePatch!: () => void
      h.updateListItem.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          settlePatch = resolve
        }),
      )

      result.current.updateItem.mutate({ itemId: 'a', patch: { isPacked: true } })

      await waitFor(() => {
        const rows = qc.getQueryData<ListItemWithGear[]>(['list-items', LIST_ID])!
        expect(rows.find((i) => i.id === 'a')!.isPacked).toBe(true)
      })
      expect(h.updateListItem).toHaveBeenCalledWith(LIST_ID, 'a', { isPacked: true })
      expect(result.current.updateItem.isPending).toBe(true)

      await act(async () => {
        settlePatch()
      })
    })

    it('last-one-out gate: no invalidate while a sibling is pending, exactly one after the final settle', async () => {
      // The gate replaces the default "invalidate on every settle": a refetch
      // fired while a sibling update-list-item mutation is still pending could
      // land stale server data over the sibling's optimistic write. In TanStack
      // Query v5 a mutation dispatches its `success` state AFTER
      // options.onSettled runs, so qc.isMutating({ mutationKey }) counts the
      // settling mutation ITSELF - the "siblings pending" check is `> 1`. The
      // LAST settle invalidates once for the whole burst; that trailing refetch
      // is what re-converges the cache with server truth when something
      // external raced the optimistic writes (e.g. the edit-gear dialog's
      // gear-save fan-out refetching this list mid-save).
      const updateA = deferred()
      const updateB = deferred()
      h.updateListItem
        .mockImplementationOnce(() => updateA.promise)
        .mockImplementationOnce(() => updateB.promise)
      const qc = makeQc()
      qc.setQueryData<ListItemWithGear[]>(
        ['list-items', LIST_ID],
        [item({ id: 'a' }), item({ id: 'b' })],
      )
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
      // Two observers on one QueryClient == two updates in flight against one
      // cache, the exact scenario the gate guards.
      const a = renderWith(qc)
      const b = renderWith(qc)

      await act(async () => {
        a.current.updateItem.mutate({ itemId: 'a', patch: { isPacked: true } })
        b.current.updateItem.mutate({ itemId: 'b', patch: { isReady: true } })
      })
      await waitFor(() => expect(h.updateListItem).toHaveBeenCalledTimes(2))

      // First settles while the second is still pending -> gate skips the refetch.
      await act(async () => { updateA.resolve() })
      await waitFor(() => expect(a.current.updateItem.isSuccess).toBe(true))
      expect(invalidationsFor(invalidateSpy, ['list-items', LIST_ID])).toBe(0)

      // Last settles -> exactly one invalidate for the whole burst.
      await act(async () => { updateB.resolve() })
      await waitFor(() => expect(b.current.updateItem.isSuccess).toBe(true))
      await waitFor(() =>
        expect(invalidationsFor(invalidateSpy, ['list-items', LIST_ID])).toBe(1),
      )
    })

    it('field-scoped rollback: a failing patch restores only its own fields, composing with a concurrent sibling on the SAME item', async () => {
      // Regression for the whole-snapshot-rollback bug: with the generic
      // makeOptimisticUpdate lifecycle, the failing Packed mutation's onError
      // restored the entire pre-Packed array snapshot - wiping the concurrent
      // Ready mutation's successful optimistic write on the same item, with no
      // trailing invalidate to heal it. Field-scoped rollback restores ONLY
      // isPacked onto the CURRENT row, so the Ready tick survives.
      const packedWrite = deferred()
      const readyWrite = deferred()
      h.updateListItem
        .mockImplementationOnce(() => packedWrite.promise)
        .mockImplementationOnce(() => readyWrite.promise)
      const qc = makeQc()
      qc.setQueryData<ListItemWithGear[]>(['list-items', LIST_ID], [item({ id: 'a' })])
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
      const a = renderWith(qc)
      const b = renderWith(qc)

      await act(async () => {
        a.current.updateItem.mutate({ itemId: 'a', patch: { isPacked: true } })
        b.current.updateItem.mutate({ itemId: 'a', patch: { isReady: true } })
      })
      await waitFor(() => expect(h.updateListItem).toHaveBeenCalledTimes(2))
      const read = () =>
        qc.getQueryData<ListItemWithGear[]>(['list-items', LIST_ID])!.find((i) => i.id === 'a')!
      // Both optimistic writes applied.
      expect(read()).toMatchObject({ isPacked: true, isReady: true })

      // Ready succeeds first (sibling still pending -> no invalidate yet).
      await act(async () => { readyWrite.resolve() })
      await waitFor(() => expect(b.current.updateItem.isSuccess).toBe(true))

      // Packed fails last: rollback restores isPacked only; Ready's write
      // survives; and as the last one out it still fires the converging
      // invalidate.
      await act(async () => { packedWrite.reject(new Error('boom')) })
      await waitFor(() => expect(a.current.updateItem.isError).toBe(true))
      expect(read()).toMatchObject({ isPacked: false, isReady: true })
      await waitFor(() =>
        expect(invalidationsFor(invalidateSpy, ['list-items', LIST_ID])).toBe(1),
      )
    })
  })

  describe('moveItem', () => {
    // Field-scoped, like updateItem: the gear move used to go through
    // makeOptimisticUpdate, whose rollback restores the whole array as it was
    // when the move started - erasing a Packed tick that saved while the move
    // was in flight. These run against a REAL cache for that reason.
    const rows = (qc: QueryClient) => qc.getQueryData<ListItemWithGear[]>(['list-items', LIST_ID])!
    const row = (qc: QueryClient, id: string) => rows(qc).find((i) => i.id === id)!

    it('sends only the location and writes location + rank optimistically, while the request is in flight', async () => {
      const move = deferred()
      h.updateListItem.mockReturnValueOnce(move.promise)
      const qc = makeQc()
      qc.setQueryData<ListItemWithGear[]>(['list-items', LIST_ID], [item({ id: 'a', sortOrder: 3 })])
      const result = renderWith(qc)

      result.current.moveItem.mutate({ itemId: 'a', locationId: 'bag', nextPackSortOrder: 7 })

      await waitFor(() => expect(row(qc, 'a').packingLocationId).toBe('bag'))
      expect(row(qc, 'a').packSortOrder).toBe(7)
      expect(row(qc, 'a').sortOrder).toBe(3)
      expect(h.updateListItem).toHaveBeenCalledWith(LIST_ID, 'a', { packingLocationId: 'bag' })
      expect(result.current.moveItem.isPending).toBe(true)
      await act(async () => {
        move.resolve()
      })
    })

    it("a failed move rewinds only the moved row's placement: a Packed tick saved mid-flight survives, on another row or the same one", async () => {
      const move = deferred()
      h.updateListItem
        .mockReturnValueOnce(move.promise)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
      const qc = makeQc()
      qc.setQueryData<ListItemWithGear[]>(
        ['list-items', LIST_ID],
        [item({ id: 'a', packingLocationId: 'pocket', packSortOrder: 2 }), item({ id: 'b', packSortOrder: 1 })],
      )
      const result = renderWith(qc)

      await act(async () => {
        result.current.moveItem.mutate({ itemId: 'a', locationId: 'bag', nextPackSortOrder: 9 })
      })
      await act(async () => {
        await result.current.updateItem.mutateAsync({ itemId: 'b', patch: { isPacked: true } })
        await result.current.updateItem.mutateAsync({ itemId: 'a', patch: { isPacked: true } })
      })
      expect(row(qc, 'b').isPacked).toBe(true)
      expect(row(qc, 'a').packingLocationId).toBe('bag')

      await act(async () => {
        move.reject(new Error('network'))
      })
      await waitFor(() => expect(result.current.moveItem.isError).toBe(true))

      expect(row(qc, 'a')).toMatchObject({ packingLocationId: 'pocket', packSortOrder: 2, isPacked: true })
      expect(row(qc, 'b').isPacked).toBe(true)
      expect(toast.showToast).toHaveBeenCalledWith("Couldn't move that item. Please try again.", { type: 'error' })
    })

    it('invalidates the list-items cache when it settles', async () => {
      const qc = makeQc()
      qc.setQueryData<ListItemWithGear[]>(['list-items', LIST_ID], [item({ id: 'a' })])
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
      const result = renderWith(qc)

      await act(async () => {
        await result.current.moveItem.mutateAsync({ itemId: 'a', locationId: 'bag', nextPackSortOrder: 0 })
      })

      expect(invalidationsFor(invalidateSpy, ['list-items', LIST_ID])).toBe(1)
    })
  })

  describe('deleteItem', () => {
    it('deletes the list item by parent path + id and removes it from the list-items cache', async () => {
      const remove = deferred()
      h.deleteListItem.mockReturnValueOnce(remove.promise)
      const keep = item({ id: 'b' })
      const { qc, result } = setup([item({ id: 'a' }), keep])

      result.current.deleteItem.mutate('a')

      await waitFor(() => expect(h.deleteListItem).toHaveBeenCalledWith(LIST_ID, 'a'))
      await waitFor(() => expect(cachedItems(qc)).toEqual([keep]))

      remove.resolve()
      await waitFor(() => expect(result.current.deleteItem.isSuccess).toBe(true))
    })

    it('also invalidates packing locations and food, which the delete can cascade', async () => {
      // A list item can BACK a packing location, and that FK is ON DELETE
      // CASCADE, so this delete can remove a location row the client never
      // touched - and since 0022 that location's SET NULL + rerank cascade
      // moves FOOD rows too. Without these keys the pack view kept
      // rendering stale sections and stale food placement.
      const { qc, result } = setup([item({ id: 'a' })])
      qc.setQueryData(['packing-locations', LIST_ID], [])
      qc.setQueryData(['list-food', LIST_ID], { dayCount: 1, slots: [], items: [] })

      result.current.deleteItem.mutate('a')

      await waitFor(() => expect(result.current.deleteItem.isSuccess).toBe(true))
      expect(qc.getQueryState(['packing-locations', LIST_ID])?.isInvalidated).toBe(true)
      expect(qc.getQueryState(['list-food', LIST_ID])?.isInvalidated).toBe(true)
    })

    it('restores the row and toasts on failure, because neither removal route leaves one visible', async () => {
      // The rule in src/lib/mutation-error-handler.ts. Both ways in are easy to
      // miss: the confirm closes before mutating, and a pristine item is removed
      // with no confirm at all - so without this the only evidence of failure is a
      // row quietly returning to a long list.
      h.deleteListItem.mockRejectedValueOnce(new Error('boom'))
      const rows = [item({ id: 'a' }), item({ id: 'b' })]
      const { qc, result } = setup(rows)

      result.current.deleteItem.mutate('a')

      await waitFor(() => expect(result.current.deleteItem.isError).toBe(true))
      expect(cachedItems(qc)).toEqual(rows)
      expect(toast.showToast).toHaveBeenCalledTimes(1)
      expect(toast.showToast).toHaveBeenCalledWith(
        "Couldn't confirm that item was removed. Refresh to check before trying again.",
        { type: 'error' },
      )
    })
  })

  describe('addNewItemOnce', () => {
    // Enter then blur, or two Enter presses, commit the same draft twice.
    // Without a guard the second request creates a duplicate gear item.
    it('sends one request for two calls while the first is pending', async () => {
      h.quickAddListItem.mockReturnValue(new Promise<never>(() => {}))
      const { result } = setup()

      result.current.addNewItemOnce(null, sampleAddData)
      result.current.addNewItemOnce(null, sampleAddData)

      await waitFor(() => expect(h.quickAddListItem).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(h.quickAddListItem).toHaveBeenCalledTimes(1)
    })

    it('accepts the next add once the first has settled', async () => {
      const { result } = setup()

      result.current.addNewItemOnce(null, sampleAddData)
      await waitFor(() => expect(h.quickAddListItem).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(result.current.addNewItem.isPending).toBe(false))

      result.current.addNewItemOnce(null, sampleAddData)
      await waitFor(() => expect(h.quickAddListItem).toHaveBeenCalledTimes(2))
    })
  })

  describe('addNewItem', () => {
    it('maps AddItemData to the quickAddListItem request', async () => {
      const { result } = setup()

      result.current.addNewItem.mutate({ categoryId: 'c2', data: sampleAddData })

      await waitFor(() =>
        expect(h.quickAddListItem).toHaveBeenCalledWith(LIST_ID, {
          name: 'Stove',
          description: 'liquid fuel',
          weightGrams: 90,
          categoryId: 'c2',
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

      await waitFor(() => expect(h.quickAddListItem).toHaveBeenCalled())
      await waitFor(() => {
        expect(invalidationsFor(invalidateSpy, ['gear-items'])).toBe(1)
        expect(invalidationsFor(invalidateSpy, ['list-items', LIST_ID])).toBe(1)
      })
    })

    it('surfaces the errorToast copy on failure (via meta + the global handler)', async () => {
      h.quickAddListItem.mockRejectedValueOnce(new Error('boom'))
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
