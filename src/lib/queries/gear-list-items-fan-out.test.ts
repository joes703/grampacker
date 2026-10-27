import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.mock('../toast', () => ({
  showToast: vi.fn(),
}))

import {
  makeOptimisticGearItemUpdate,
  makeOptimisticGearItemDelete,
  makeOptimisticGearItemsBulkDelete,
  makeOptimisticGearItemsBulkCategoryMove,
} from './gear-list-items-fan-out'
import { queryKeys } from './keys'
import { showToast } from '../toast'
import type { GearItem } from './gear'
import type { ListItemWithGear } from './list-items'

// Cross-cache lifecycle regressions for the gear fan-out: every helper
// must apply the same logical change to the gear library cache AND every
// per-list cache embedding the gear, snapshot exactly the caches it
// touched, restore all of them on error, and leave unaffected caches
// untouched BY IDENTITY (a churned reference re-renders an unrelated
// open list for nothing).

const NOW = '2026-01-01T00:00:00.000Z'

function gear(over: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g1', categoryId: 'c1', name: 'Tent', description: null,
    weightGrams: 1200, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: NOW, updatedAt: NOW, ...over,
  }
}

function listItem(over: Partial<ListItemWithGear> = {}): ListItemWithGear {
  const g = over.gearItem ?? gear()
  return {
    id: `li-${g.id}`, listId: 'l1', gearItemId: g.id, quantity: 1,
    isWorn: false, isConsumable: false, isPacked: false, isReady: false,
    packingLocationId: null,
    sortOrder: 0, packSortOrder: 0, createdAt: NOW, updatedAt: NOW,
    gearItem: g, ...over,
  }
}

// Two lists reference g1 (l1 also has g2); a third list references only
// g3 and must never be touched by g1/g2 mutations.
function seed() {
  const qc = new QueryClient()
  const g1 = gear({ id: 'g1', name: 'Tent' })
  const g2 = gear({ id: 'g2', name: 'Quilt' })
  const g3 = gear({ id: 'g3', name: 'Stove' })
  qc.setQueryData(queryKeys.gearItems(), [g1, g2, g3])
  qc.setQueryData(queryKeys.listItems('l1'), [
    listItem({ id: 'li-1', listId: 'l1', gearItemId: 'g1', gearItem: g1 }),
    listItem({ id: 'li-2', listId: 'l1', gearItemId: 'g2', gearItem: g2 }),
  ])
  qc.setQueryData(queryKeys.listItems('l2'), [
    listItem({ id: 'li-3', listId: 'l2', gearItemId: 'g1', gearItem: g1, quantity: 2 }),
  ])
  qc.setQueryData(queryKeys.listItems('l3'), [
    listItem({ id: 'li-4', listId: 'l3', gearItemId: 'g3', gearItem: g3 }),
  ])
  return { qc }
}

function gearCache(qc: QueryClient): GearItem[] {
  return qc.getQueryData<GearItem[]>(queryKeys.gearItems())!
}

function itemsOf(qc: QueryClient, listId: string): ListItemWithGear[] {
  return qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))!
}

afterEach(() => vi.clearAllMocks())

describe('makeOptimisticGearItemUpdate', async () => {
  it('patches the gear cache and the embedded copy in every affected list', async () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemUpdate({ qc })

    await onMutate({ id: 'g1', patch: { name: 'Mid', weightGrams: 900 } })

    expect(gearCache(qc).find((g) => g.id === 'g1')).toMatchObject({
      name: 'Mid', weightGrams: 900,
    })
    expect(itemsOf(qc, 'l1').find((i) => i.gearItemId === 'g1')?.gearItem)
      .toMatchObject({ name: 'Mid', weightGrams: 900 })
    expect(itemsOf(qc, 'l2')[0]?.gearItem).toMatchObject({ name: 'Mid' })
    // The other row in l1 is not the target and keeps its gear.
    expect(itemsOf(qc, 'l1').find((i) => i.gearItemId === 'g2')?.gearItem.name)
      .toBe('Quilt')
  })

  it('never overwrites an embedded field with undefined (PATCH semantics)', async () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemUpdate({ qc })

    await onMutate({ id: 'g1', patch: { weightGrams: 900, name: undefined } })

    expect(itemsOf(qc, 'l2')[0]?.gearItem).toMatchObject({
      name: 'Tent', weightGrams: 900,
    })
  })

  it('leaves unrelated list caches untouched by identity', async () => {
    const { qc } = seed()
    const before = itemsOf(qc, 'l3')
    const { onMutate } = makeOptimisticGearItemUpdate({ qc })

    const ctx = await onMutate({ id: 'g1', patch: { name: 'Mid' } })

    expect(itemsOf(qc, 'l3')).toBe(before) // same reference: no snapshot, no write
    expect(ctx.listSnapshots.map((s) => s.key)).toEqual([
      queryKeys.listItems('l1'),
      queryKeys.listItems('l2'),
    ])
  })

  it('onError restores the gear cache and every touched list cache exactly', async () => {
    const { qc } = seed()
    const gearBefore = gearCache(qc)
    const l1Before = itemsOf(qc, 'l1')
    const l2Before = itemsOf(qc, 'l2')
    const { onMutate, onError } = makeOptimisticGearItemUpdate({ qc })

    const ctx = await onMutate({ id: 'g1', patch: { name: 'Mid' } })
    onError(new Error('nope'), { id: 'g1', patch: { name: 'Mid' } }, ctx)

    expect(gearCache(qc)).toEqual(gearBefore)
    expect(itemsOf(qc, 'l1')).toEqual(l1Before)
    expect(itemsOf(qc, 'l2')).toEqual(l2Before)
    // No toast configured for single-item mutations.
    expect(showToast).not.toHaveBeenCalled()
  })

  it('onSettled invalidates the gear cache and every list', async () => {
    const { qc } = seed()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { onMutate, onSettled } = makeOptimisticGearItemUpdate({ qc })

    const ctx = await onMutate({ id: 'g1', patch: { name: 'Mid' } })
    onSettled(undefined, null, { id: 'g1', patch: { name: 'Mid' } }, ctx)

    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey)
    expect(keys).toContainEqual(queryKeys.gearItems())
    expect(keys).toContainEqual(queryKeys.listItemsAll())
  })
})

describe('settling a gear write', () => {
  // A list opened while the save is running fetches the gear's old values and
  // was never snapshotted, so only a prefix invalidation reaches it.
  it('invalidates a list cache that appeared while the write was in flight', async () => {
    const { qc } = seed()
    const { onMutate, onSettled } = makeOptimisticGearItemUpdate({ qc })

    const ctx = await onMutate({ id: 'g1', patch: { name: 'Mid' } })
    qc.setQueryData(queryKeys.listItems('l4'), [
      listItem({ id: 'li-5', listId: 'l4', gearItemId: 'g1', gearItem: gear({ id: 'g1' }) }),
    ])
    onSettled(undefined, null, { id: 'g1', patch: { name: 'Mid' } }, ctx)

    expect(qc.getQueryState(queryKeys.listItems('l4'))?.isInvalidated).toBe(true)
  })
})

describe('makeOptimisticGearItemDelete', async () => {
  it('drops the gear row and its membership rows in every affected list', async () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemDelete({ qc })

    await onMutate('g1')

    expect(gearCache(qc).map((g) => g.id)).toEqual(['g2', 'g3'])
    expect(itemsOf(qc, 'l1').map((i) => i.gearItemId)).toEqual(['g2'])
    expect(itemsOf(qc, 'l2')).toEqual([])
    expect(itemsOf(qc, 'l3')).toHaveLength(1)
  })

  it('onError restores dropped membership rows', async () => {
    const { qc } = seed()
    const l2Before = itemsOf(qc, 'l2')
    const { onMutate, onError } = makeOptimisticGearItemDelete({ qc })

    const ctx = await onMutate('g1')
    onError(new Error('nope'), 'g1', ctx)

    expect(itemsOf(qc, 'l2')).toEqual(l2Before)
  })
})

// A gear DELETE cascades server-side past list_items: a row that backed a
// packing location takes the location with it, and its contents (gear AND
// food) are returned to Unassigned and reranked. The membership-delete path
// already invalidates both caches; the gear-delete path did not, so a ghost
// bag stayed on screen until something else refetched.
describe('gear delete invalidates the caches the server cascade reaches', () => {
  function seedWithLocationsAndFood() {
    const { qc } = seed()
    // l9 has locations and food cached but NO list-items cache at all - the
    // shape a per-list discovery through list-items cannot see.
    qc.setQueryData(queryKeys.packingLocations('l9'), [{ id: 'loc-9' }])
    qc.setQueryData(queryKeys.listFood('l9'), { dayCount: 0, slots: [], items: [] })
    qc.setQueryData(queryKeys.packingLocations('l1'), [{ id: 'loc-1' }])
    return { qc }
  }

  const invalidatedKeys = (invalidate: { mock: { calls: unknown[][] } }) =>
    invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown } | undefined)?.queryKey)

  it('single delete: locations and food families, even without a list-items snapshot', async () => {
    const { qc } = seedWithLocationsAndFood()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { onMutate, onSettled } = makeOptimisticGearItemDelete({ qc })

    const ctx = await onMutate('g1')
    onSettled(undefined, null, 'g1', ctx)

    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(queryKeys.packingLocationsAll())
    expect(keys).toContainEqual(queryKeys.listFoodAll())
    // Prefix keys cover l9, which had no list-items snapshot to be found by.
    expect(qc.getQueryState(queryKeys.packingLocations('l9'))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(queryKeys.listFood('l9'))?.isInvalidated).toBe(true)
  })

  it('bulk delete: the same families, on failure settlement too', async () => {
    const { qc } = seedWithLocationsAndFood()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { onMutate, onError, onSettled } = makeOptimisticGearItemsBulkDelete({ qc })

    const ctx = await onMutate(['g1', 'g2'])
    onError(new Error('nope'), ['g1', 'g2'], ctx)
    onSettled(undefined, new Error('nope'), ['g1', 'g2'], ctx)

    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(queryKeys.packingLocationsAll())
    expect(keys).toContainEqual(queryKeys.listFoodAll())
  })

  it('an edit or a category move cascades nothing and leaves both families alone', async () => {
    const { qc } = seedWithLocationsAndFood()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    const edit = makeOptimisticGearItemUpdate({ qc })
    const editCtx = await edit.onMutate({ id: 'g1', patch: { name: 'Mid' } })
    edit.onSettled(undefined, null, { id: 'g1', patch: { name: 'Mid' } }, editCtx)

    const move = makeOptimisticGearItemsBulkCategoryMove({ qc })
    const moveCtx = await move.onMutate({ ids: ['g1'], categoryId: null })
    move.onSettled(undefined, null, { ids: ['g1'], categoryId: null }, moveCtx)

    const keys = invalidatedKeys(invalidate)
    expect(keys).not.toContainEqual(queryKeys.packingLocationsAll())
    expect(keys).not.toContainEqual(queryKeys.listFoodAll())
    expect(qc.getQueryState(queryKeys.packingLocations('l1'))?.isInvalidated).toBe(false)
  })
})

describe('makeOptimisticGearItemsBulkDelete', async () => {
  it('drops every selected id across gear and list caches', async () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemsBulkDelete({ qc })

    await onMutate(['g1', 'g2'])

    expect(gearCache(qc).map((g) => g.id)).toEqual(['g3'])
    expect(itemsOf(qc, 'l1')).toEqual([])
    expect(itemsOf(qc, 'l2')).toEqual([])
    expect(itemsOf(qc, 'l3')).toHaveLength(1)
  })

  // The failure toast comes from the mutation's meta through the global
  // handler (src/lib/mutation-error-handler.ts); the helper only rolls back.
  it('restores the caches on rollback without raising a toast itself', async () => {
    const { qc } = seed()
    const { onMutate, onError } = makeOptimisticGearItemsBulkDelete({ qc })

    const ctx = await onMutate(['g1'])
    onError(new Error('nope'), ['g1'], ctx)

    expect(showToast).not.toHaveBeenCalled()
    expect(gearCache(qc).map((g) => g.id)).toEqual(['g1', 'g2', 'g3'])
    expect(itemsOf(qc, 'l2')).toHaveLength(1)
  })
})

// findAll matches ['list-items'] as a PREFIX, so the fan-out also sees a
// bare ['list-items'] query, longer keys, and non-string list ids - none
// of which hold the per-list array shape. If reading one of those threw
// inside onMutate (after the gear write, before the context returns),
// the rollback contract would break. These pin that only the exact
// ['list-items', string] shape with array data is ever touched.
describe('fan-out cache discovery hardening', async () => {
  function poison(qc: QueryClient) {
    // Bare prefix key holding non-array garbage.
    qc.setQueryData(queryKeys.listItemsAll(), { not: 'an array' })
    // Longer key whose array data WOULD match g1 if shape were ignored.
    qc.setQueryData(
      ['list-items', 'l1', 'extra'],
      [listItem({ id: 'li-x', listId: 'l1', gearItemId: 'g1' })],
    )
    // Two-element key with a non-string second element.
    qc.setQueryData(['list-items', 42], [listItem({ id: 'li-y', gearItemId: 'g1' })])
  }

  it('skips non-per-list caches without throwing and still fans out', async () => {
    const { qc } = seed()
    poison(qc)
    const bareBefore = qc.getQueryData(queryKeys.listItemsAll())
    const longBefore = qc.getQueryData(['list-items', 'l1', 'extra'])
    const numBefore = qc.getQueryData(['list-items', 42])
    const { onMutate } = makeOptimisticGearItemUpdate({ qc })

    const ctx = await onMutate({ id: 'g1', patch: { name: 'Mid' } })

    // The malformed caches keep identity: never canceled, snapshotted,
    // or written.
    expect(qc.getQueryData(queryKeys.listItemsAll())).toBe(bareBefore)
    expect(qc.getQueryData(['list-items', 'l1', 'extra'])).toBe(longBefore)
    expect(qc.getQueryData(['list-items', 42])).toBe(numBefore)
    expect(ctx.listSnapshots.map((s) => s.key)).toEqual([
      queryKeys.listItems('l1'),
      queryKeys.listItems('l2'),
    ])
    // The real fan-out still happened around them.
    expect(itemsOf(qc, 'l1').find((i) => i.gearItemId === 'g1')?.gearItem.name)
      .toBe('Mid')
    expect(itemsOf(qc, 'l2')[0]?.gearItem.name).toBe('Mid')
  })
})

describe('makeOptimisticGearItemsBulkCategoryMove', async () => {
  it('recategorizes the gear rows and their embedded copies', async () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemsBulkCategoryMove({ qc })

    await onMutate({ ids: ['g1', 'g2'], categoryId: 'c9' })

    expect(gearCache(qc).filter((g) => g.categoryId === 'c9').map((g) => g.id))
      .toEqual(['g1', 'g2'])
    expect(itemsOf(qc, 'l1').every((i) => i.gearItem.categoryId === 'c9'))
      .toBe(true)
    expect(itemsOf(qc, 'l2')[0]?.gearItem.categoryId).toBe('c9')
    expect(itemsOf(qc, 'l3')[0]?.gearItem.categoryId).toBe('c1')
  })

  it('null recategorization (uncategorize) fans out too', async () => {
    const { qc } = seed()
    const { onMutate } = makeOptimisticGearItemsBulkCategoryMove({ qc })

    await onMutate({ ids: ['g1'], categoryId: null })

    expect(gearCache(qc).find((g) => g.id === 'g1')?.categoryId).toBeNull()
    expect(itemsOf(qc, 'l2')[0]?.gearItem.categoryId).toBeNull()
    // Membership fields (quantity, flags) are not the mutation's business.
    expect(itemsOf(qc, 'l2')[0]?.quantity).toBe(2)
  })
})

// The fan-out counterpart of the mechanism suite in optimistic.test.ts, with the
// same caveat: it pins the MECHANISM (an awaited cancel keeps the optimistic write
// on every surface it touched), at a microtask offset that a user gesture cannot
// reach. Read the note over there before citing this as a user-facing bug.
//
// The wider blast radius is what makes it worth pinning at all: a gear edit writes
// to the gear cache AND to every list cache embedding that gear, so the write can be
// lost on any one of them independently, and a rollback context assembled across a
// moving set of caches restores a state that never existed.
describe('an in-flight refetch cannot clobber the gear fan-out', () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('the optimistic write survives on the gear cache AND every affected list', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const g1 = gear({ id: 'g1', name: 'Tent' })
    qc.setQueryData(queryKeys.gearItems(), [g1])
    qc.setQueryData(queryKeys.listItems('l1'), [
      listItem({ id: 'li-1', listId: 'l1', gearItemId: 'g1', gearItem: g1 }),
    ])
    qc.setQueryData(queryKeys.listItems('l2'), [
      listItem({ id: 'li-3', listId: 'l2', gearItemId: 'g1', gearItem: g1 }),
    ])

    // A GET is in flight for BOTH the gear library and one of the open lists - the
    // ordinary consequence of a previous mutation's invalidate, or a tab refocus.
    const gearServer = deferred<GearItem[]>()
    const listServer = deferred<ListItemWithGear[]>()
    const gearInFlight = qc
      .fetchQuery({ queryKey: queryKeys.gearItems(), queryFn: () => gearServer.promise })
      .catch(() => undefined)
    const listInFlight = qc
      .fetchQuery({
        queryKey: queryKeys.listItems('l1'),
        queryFn: () => listServer.promise,
      })
      .catch(() => undefined)

    // Both answer with pre-edit truth (the OLD name).
    gearServer.resolve([gear({ id: 'g1', name: 'Tent' })])
    listServer.resolve([
      listItem({ id: 'li-1', listId: 'l1', gearItemId: 'g1', gearItem: gear({ id: 'g1', name: 'Tent' }) }),
    ])

    // The one microtask that opens the window (see optimistic.test.ts).
    await Promise.resolve()

    const { onMutate } = makeOptimisticGearItemUpdate({ qc })
    await onMutate({ id: 'g1', patch: { name: 'Mid' } })

    await gearInFlight
    await listInFlight

    // The rename must be visible on every surface it was applied to. Without the
    // awaited cancels, the stale 'Tent' lands on top and the user watches their
    // edit silently revert.
    expect(gearCache(qc)[0]?.name).toBe('Mid')
    expect(itemsOf(qc, 'l1')[0]?.gearItem.name).toBe('Mid')
    expect(itemsOf(qc, 'l2')[0]?.gearItem.name).toBe('Mid')
  })
})
