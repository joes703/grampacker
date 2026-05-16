import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ListItemWithGear } from '../lib/types'
import {
  fanOutGearListItemsCaches,
  invalidateListItemsCaches,
  patchAffectsListItemsView,
  rollbackListItemsCaches,
} from './list-items-fan-out'

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
