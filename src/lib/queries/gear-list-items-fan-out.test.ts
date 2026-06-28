import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { GearItem, ListItemWithGear } from '../types'
import {
  fanOutGearListItemsCaches,
  invalidateListItemsCaches,
  makeOptimisticGearItemDelete,
  makeOptimisticGearItemUpdate,
  makeOptimisticGearItemsBulkCategoryMove,
  makeOptimisticGearItemsBulkDelete,
  patchAffectsListItemsView,
  rollbackListItemsCaches,
} from './gear-list-items-fan-out'
import { queryKeys } from './keys'

function makeItem(overrides: Partial<ListItemWithGear> = {}): ListItemWithGear {
  return {
    id: 'li-1',
    list_id: 'list-1',
    user_id: 'u-1',
    gear_item_id: 'g-1',
    quantity: 1,
    is_worn: false,
    is_consumable: false,
    is_packed: false,
    is_ready: false,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    gear_item: {
      id: 'g-1',
      name: 'Tent',
      description: null,
      weight_grams: 1200,
      category_id: 'cat-1',
      status: 'active',
    },
    ...overrides,
  }
}

function makeGear(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: 'g-1',
    user_id: 'u-1',
    category_id: 'cat-1',
    name: 'Tent',
    description: null,
    weight_grams: 1200,
    cost: null,
    purchase_date: null,
    status: 'active',
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function seedGearFanout() {
  const qc = new QueryClient()
  qc.setQueryData<GearItem[]>(queryKeys.gearItems(), [
    makeGear(),
    makeGear({ id: 'g-2', name: 'Stove', weight_grams: 90, category_id: 'cat-2', sort_order: 1 }),
    makeGear({ id: 'g-3', name: 'Mug', weight_grams: 50, category_id: 'cat-2', sort_order: 2 }),
  ])
  qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'), [
    makeItem({ id: 'li-a1', list_id: 'list-A' }),
    makeItem({
      id: 'li-a2',
      list_id: 'list-A',
      gear_item_id: 'g-2',
      gear_item: {
        id: 'g-2',
        name: 'Stove',
        description: null,
        weight_grams: 90,
        category_id: 'cat-2',
        status: 'active',
      },
    }),
  ])
  qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems('list-B'), [
    makeItem({ id: 'li-b1', list_id: 'list-B' }),
  ])
  qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems('list-C'), [
    makeItem({
      id: 'li-c1',
      list_id: 'list-C',
      gear_item_id: 'g-3',
      gear_item: {
        id: 'g-3',
        name: 'Mug',
        description: null,
        weight_grams: 50,
        category_id: 'cat-2',
        status: 'active',
      },
    }),
  ])
  return { qc }
}

describe('patchAffectsListItemsView', () => {
  // Embedded gear fields are the columns list_items joins via
  // PostgREST's `gear_item:gear_items(...)` SELECT. Anything outside
  // that set cannot be observed by list-view consumers; the fan-out
  // would be wasted work. See CLAUDE.md "Cache invalidation rules".
  it('returns true for name', () => {
    expect(patchAffectsListItemsView({ name: 'Renamed' })).toBe(true)
  })

  it('returns true for description', () => {
    expect(patchAffectsListItemsView({ description: 'new notes' })).toBe(true)
  })

  it('returns true for weight_grams', () => {
    expect(patchAffectsListItemsView({ weight_grams: 1500 })).toBe(true)
  })

  it('returns true for category_id', () => {
    expect(patchAffectsListItemsView({ category_id: 'cat-9' })).toBe(true)
  })

  it('returns true for status', () => {
    expect(patchAffectsListItemsView({ status: 'needs_repair' })).toBe(true)
  })

  it('returns true when any embedded field is present alongside non-embedded fields', () => {
    expect(patchAffectsListItemsView({ sort_order: 4, name: 'Renamed' })).toBe(true)
  })

  it('returns false for sort_order alone (CLAUDE.md rule)', () => {
    expect(patchAffectsListItemsView({ sort_order: 4 })).toBe(false)
  })

  it('returns false for cost / purchase_date / other non-embedded fields', () => {
    expect(patchAffectsListItemsView({ cost: 50 })).toBe(false)
    expect(patchAffectsListItemsView({ purchase_date: '2026-01-01' })).toBe(false)
    expect(patchAffectsListItemsView({ cost: 50, purchase_date: '2026-01-01' })).toBe(false)
  })

  it('returns false for an empty patch', () => {
    expect(patchAffectsListItemsView({})).toBe(false)
  })
})

describe('fanOutGearListItemsCaches', () => {
  it('updates every cache that references the affected gear and snapshots them in order', () => {
    const qc = new QueryClient()
    const itemsA = [makeItem({ id: 'li-a', list_id: 'list-A' })]
    const itemsB = [makeItem({ id: 'li-b', list_id: 'list-B' })]
    const itemsC = [
      makeItem({ id: 'li-c', list_id: 'list-C', gear_item_id: 'other-gear' }),
    ]
    qc.setQueryData(['list-items', 'list-A'], itemsA)
    qc.setQueryData(['list-items', 'list-B'], itemsB)
    qc.setQueryData(['list-items', 'list-C'], itemsC)

    const snapshots = fanOutGearListItemsCaches(qc, 'g-1', (items) =>
      items.map((i) =>
        i.gear_item_id === 'g-1'
          ? { ...i, gear_item: { ...i.gear_item, name: 'Renamed' } }
          : i,
      ),
    )

    // Caches A and B contain g-1; C does not. Only A and B are
    // snapshotted/mutated.
    expect(snapshots).toHaveLength(2)
    const cacheA = qc.getQueryData<ListItemWithGear[]>(['list-items', 'list-A'])
    const cacheB = qc.getQueryData<ListItemWithGear[]>(['list-items', 'list-B'])
    const cacheC = qc.getQueryData<ListItemWithGear[]>(['list-items', 'list-C'])
    expect(cacheA?.[0]?.gear_item.name).toBe('Renamed')
    expect(cacheB?.[0]?.gear_item.name).toBe('Renamed')
    expect(cacheC?.[0]?.gear_item.name).toBe('Tent') // untouched
  })

  it('rollbackListItemsCaches restores each snapshot byte-for-byte', () => {
    const qc = new QueryClient()
    const original = [makeItem({ id: 'li-a', list_id: 'list-A' })]
    qc.setQueryData(['list-items', 'list-A'], original)

    const snapshots = fanOutGearListItemsCaches(qc, 'g-1', (items) =>
      items.map((i) => ({ ...i, gear_item: { ...i.gear_item, name: 'Renamed' } })),
    )
    expect(qc.getQueryData<ListItemWithGear[]>(['list-items', 'list-A'])?.[0]?.gear_item.name).toBe(
      'Renamed',
    )

    rollbackListItemsCaches(qc, snapshots)
    // After rollback the cache deep-equals the pre-mutation snapshot —
    // the embedded gear_item.name is back to "Tent", not "Renamed".
    expect(qc.getQueryData<ListItemWithGear[]>(['list-items', 'list-A'])).toEqual(original)
  })

  it('invalidateListItemsCaches calls invalidate on each affected key', () => {
    const qc = new QueryClient()
    qc.setQueryData(['list-items', 'list-A'], [makeItem({ list_id: 'list-A' })])
    qc.setQueryData(['list-items', 'list-B'], [makeItem({ list_id: 'list-B' })])

    const snapshots = fanOutGearListItemsCaches(qc, 'g-1', (items) => items)

    // After fan-out neither query is "invalidated" yet; queries are fresh.
    // We assert that invalidateListItemsCaches moves them off "fresh".
    expect(qc.getQueryState(['list-items', 'list-A'])?.isInvalidated).toBe(false)
    invalidateListItemsCaches(qc, snapshots)
    expect(qc.getQueryState(['list-items', 'list-A'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['list-items', 'list-B'])?.isInvalidated).toBe(true)
  })

  it('returns an empty snapshot list when no cache references the gear', () => {
    const qc = new QueryClient()
    qc.setQueryData(
      ['list-items', 'list-A'],
      [makeItem({ gear_item_id: 'something-else' })],
    )

    const snapshots = fanOutGearListItemsCaches(qc, 'g-1', (items) => items)
    expect(snapshots).toEqual([])
  })
})

describe('gear item optimistic fan-out helpers', () => {
  it('updates gear_items and every embedded list item cache for a visible gear patch', () => {
    const { qc } = seedGearFanout()
    const helper = makeOptimisticGearItemUpdate(qc)

    helper.onMutate({ id: 'g-1', patch: { name: 'Tent (lite)', weight_grams: 1100 } })

    expect(qc.getQueryData<GearItem[]>(queryKeys.gearItems())?.[0]).toMatchObject({
      id: 'g-1',
      name: 'Tent (lite)',
      weight_grams: 1100,
    })
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))?.[0]?.gear_item).toMatchObject({
      id: 'g-1',
      name: 'Tent (lite)',
      weight_grams: 1100,
    })
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-B'))?.[0]?.gear_item).toMatchObject({
      id: 'g-1',
      name: 'Tent (lite)',
      weight_grams: 1100,
    })
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-C'))?.[0]?.gear_item.name).toBe('Mug')
  })

  it('updates only gear_items for a non-embedded patch', () => {
    const { qc } = seedGearFanout()
    const beforeListA = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))
    const helper = makeOptimisticGearItemUpdate(qc)

    const ctx = helper.onMutate({ id: 'g-1', patch: { cost: 12.5 } })

    expect(ctx.listSnapshots).toEqual([])
    expect(qc.getQueryData<GearItem[]>(queryKeys.gearItems())?.[0]?.cost).toBe(12.5)
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))).toBe(beforeListA)
  })

  it('rolls back gear_items and touched list item caches for a failed update', () => {
    const { qc } = seedGearFanout()
    const gearBefore = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
    const listBefore = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))
    const helper = makeOptimisticGearItemUpdate(qc)
    const input = { id: 'g-1', patch: { name: 'Tent (lite)' } }

    const ctx = helper.onMutate(input)
    helper.onError(new Error('boom'), input, ctx)

    expect(qc.getQueryData<GearItem[]>(queryKeys.gearItems())).toEqual(gearBefore)
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))).toEqual(listBefore)
  })

  it('invalidates gear_items and only touched list item caches on settled update', () => {
    const { qc } = seedGearFanout()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const helper = makeOptimisticGearItemUpdate(qc)
    const input = { id: 'g-1', patch: { name: 'Tent (lite)' } }

    const ctx = helper.onMutate(input)
    helper.onSettled(undefined, null, input, ctx)
    const invalidatedKeys = invalidateSpy.mock.calls.map(([arg]) => (arg as { queryKey: readonly unknown[] }).queryKey)

    expect(invalidatedKeys).toContainEqual(queryKeys.gearItems())
    expect(invalidatedKeys).toContainEqual(queryKeys.listItems('list-A'))
    expect(invalidatedKeys).toContainEqual(queryKeys.listItems('list-B'))
    expect(invalidatedKeys).not.toContainEqual(queryKeys.listItems('list-C'))
  })

  it('deletes one gear item from gear_items and every affected list item cache', () => {
    const { qc } = seedGearFanout()
    const helper = makeOptimisticGearItemDelete(qc)

    helper.onMutate('g-1')

    expect(qc.getQueryData<GearItem[]>(queryKeys.gearItems())?.map((g) => g.id)).toEqual(['g-2', 'g-3'])
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))?.map((i) => i.gear_item_id)).toEqual([
      'g-2',
    ])
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-B'))).toEqual([])
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-C'))?.map((i) => i.gear_item_id)).toEqual([
      'g-3',
    ])
  })

  it('bulk-deletes gear items from gear_items and every affected list item cache', () => {
    const { qc } = seedGearFanout()
    const helper = makeOptimisticGearItemsBulkDelete(qc)

    helper.onMutate(['g-1', 'g-3'])

    expect(qc.getQueryData<GearItem[]>(queryKeys.gearItems())?.map((g) => g.id)).toEqual(['g-2'])
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))?.map((i) => i.gear_item_id)).toEqual([
      'g-2',
    ])
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-B'))).toEqual([])
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-C'))).toEqual([])
  })

  it('bulk-moves gear items in gear_items and every embedded list item cache', () => {
    const { qc } = seedGearFanout()
    const helper = makeOptimisticGearItemsBulkCategoryMove(qc)

    helper.onMutate({ ids: ['g-1', 'g-2'], categoryId: 'cat-new' })

    expect(qc.getQueryData<GearItem[]>(queryKeys.gearItems())?.map((g) => [g.id, g.category_id])).toEqual([
      ['g-1', 'cat-new'],
      ['g-2', 'cat-new'],
      ['g-3', 'cat-2'],
    ])
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))?.map((i) => [
      i.gear_item_id,
      i.gear_item.category_id,
    ])).toEqual([
      ['g-1', 'cat-new'],
      ['g-2', 'cat-new'],
    ])
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-B'))?.[0]?.gear_item.category_id).toBe(
      'cat-new',
    )
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-C'))?.[0]?.gear_item.category_id).toBe(
      'cat-2',
    )
  })

  it('rolls back gear_items and touched list item caches for a failed bulk move', () => {
    const { qc } = seedGearFanout()
    const gearBefore = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
    const listBefore = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))
    const helper = makeOptimisticGearItemsBulkCategoryMove(qc)
    const input = { ids: ['g-1', 'g-2'], categoryId: 'cat-new' }

    const ctx = helper.onMutate(input)
    helper.onError(new Error('boom'), input, ctx)

    expect(qc.getQueryData<GearItem[]>(queryKeys.gearItems())).toEqual(gearBefore)
    expect(qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems('list-A'))).toEqual(listBefore)
  })
})
