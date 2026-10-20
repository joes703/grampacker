import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { ListFoodResponse } from '../../../shared/food'
import { arrayShape, fieldScopedCache } from './field-scoped'
import { foodItemsShape } from './food'

// The lifecycle-level pins (concurrent sibling writes, the last-one-out
// invalidation gate, two-cache resets) live with each hook's own tests. This
// file pins the primitive's contract directly.

type Row = { id: string; isPacked: boolean; isReady: boolean; rank: number }

const KEY = ['rows', 'l1']

function seed(qc: QueryClient, rows: Row[]) {
  qc.setQueryData<Row[]>(KEY, rows)
}

function rowCache(qc: QueryClient) {
  return fieldScopedCache(qc, KEY, arrayShape<Row>())
}

describe('fieldScopedCache on a bare array', () => {
  it('snapshots only the touched fields and applies the patch', async () => {
    const qc = new QueryClient()
    seed(qc, [
      { id: 'a', isPacked: false, isReady: true, rank: 1 },
      { id: 'b', isPacked: false, isReady: false, rank: 2 },
    ])
    const cache = rowCache(qc)
    const prev = await cache.patchRow('a', { isPacked: true })
    expect(prev).toEqual({ isPacked: false })
    expect(qc.getQueryData<Row[]>(KEY)).toEqual([
      { id: 'a', isPacked: true, isReady: true, rank: 1 },
      { id: 'b', isPacked: false, isReady: false, rank: 2 },
    ])
  })

  it('does not snapshot keys passed as undefined', async () => {
    const qc = new QueryClient()
    seed(qc, [{ id: 'a', isPacked: false, isReady: true, rank: 1 }])
    const prev = await rowCache(qc).patchRow('a', {
      isPacked: true,
      isReady: undefined,
    })
    expect(prev).toEqual({ isPacked: false })
  })

  it('restores only the snapshotted fields onto the row as it is NOW', async () => {
    // The reason this primitive exists: a concurrent sibling write that
    // landed after the snapshot must survive the rollback.
    const qc = new QueryClient()
    seed(qc, [{ id: 'a', isPacked: false, isReady: false, rank: 1 }])
    const cache = rowCache(qc)
    const prev = await cache.patchRow('a', { isPacked: true })
    // A sibling write lands while the first patch is in flight.
    await cache.patchRow('a', { isReady: true })
    cache.restoreRow('a', prev!)
    expect(qc.getQueryData<Row[]>(KEY)).toEqual([
      { id: 'a', isPacked: false, isReady: true, rank: 1 },
    ])
  })

  it('leaves an absent cache absent and reports nothing to restore', async () => {
    const qc = new QueryClient()
    const prev = await rowCache(qc).patchRow('a', { isPacked: true })
    expect(prev).toBeUndefined()
    expect(qc.getQueryData<Row[]>(KEY)).toBeUndefined()
  })

  it('applies nothing for an absent row', async () => {
    const qc = new QueryClient()
    const rows: Row[] = [{ id: 'a', isPacked: false, isReady: false, rank: 1 }]
    seed(qc, rows)
    const prev = await rowCache(qc).patchRow('missing', { isPacked: true })
    expect(prev).toBeUndefined()
    // Untouched, by identity: nothing was applied, nothing re-rendered.
    expect(qc.getQueryData<Row[]>(KEY)).toBe(rows)
  })
})

describe('fieldScopedCache on the food document', () => {
  const FOOD_KEY = ['list-food', 'l1']
  const doc: ListFoodResponse = {
    dayCount: 3,
    slots: [
      { id: 's1', dayNumber: 1, meal: 'breakfast' },
      { id: 's2', dayNumber: 1, meal: 'dinner' },
    ],
    items: [
      {
        id: 'f1',
        name: 'Oats',
        weightGrams: 100,
        quantity: 1,
        isPerMeal: false,
        unitCount: 1,
        sortOrder: 1,
        isPacked: false,
        isReady: false,
        packingLocationId: null,
        packSortOrder: 1,
        slotIds: ['s1'],
      },
      {
        id: 'f2',
        name: 'Chili',
        weightGrams: 250,
        quantity: 1,
        isPerMeal: true,
        unitCount: 1,
        sortOrder: 2,
        isPacked: false,
        isReady: false,
        packingLocationId: null,
        packSortOrder: 2,
        slotIds: ['s2'],
      },
    ],
  }

  it('patches one row while preserving the document metadata and other rows', async () => {
    const qc = new QueryClient()
    qc.setQueryData<ListFoodResponse>(FOOD_KEY, doc)
    const cache = fieldScopedCache(qc, FOOD_KEY, foodItemsShape)
    const prev = await cache.patchRow('f1', {
      packingLocationId: 'loc1',
      packSortOrder: 9,
    })
    expect(prev).toEqual({ packingLocationId: null, packSortOrder: 1 })
    const after = qc.getQueryData<ListFoodResponse>(FOOD_KEY)!
    // The metadata the write must pass through untouched.
    expect(after.dayCount).toBe(3)
    expect(after.slots).toEqual(doc.slots)
    expect(after.items[0]).toMatchObject({ id: 'f1', packingLocationId: 'loc1', packSortOrder: 9 })
    expect(after.items[1]).toEqual(doc.items[1])

    cache.restoreRow('f1', prev!)
    expect(qc.getQueryData<ListFoodResponse>(FOOD_KEY)).toEqual(doc)
  })
})
