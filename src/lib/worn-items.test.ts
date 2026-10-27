import { describe, expect, it } from 'vitest'
import { wornItemsInDocumentOrder } from './worn-items'
import type { ListItemWithGear } from './types'

// The function reads only `.items`, so the groups are written as literals. The
// orderings below are DELIBERATELY not sorted: each one is what the assertion
// underneath it has to overcome.
const groups = (...buckets: ListItemWithGear[][]) => buckets.map((items) => ({ items }))

function item(
  id: string,
  locationId: string | null,
  isWorn: boolean,
  sortOrder = 0,
  packSortOrder = 0,
): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: locationId,
    sortOrder,
    packSortOrder,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      name: id,
      description: null,
      weightGrams: 100,
      categoryId: null,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

describe('wornItemsInDocumentOrder with location groups', () => {
  const wornAssigned = item('worn-assigned', 'loc-1', true)
  const wornUnassigned = item('worn-unassigned', null, true)
  const normal = item('normal', 'loc-1', false)
  // loc-1's bucket, then the Unassigned bucket last.
  const grouped = groups([wornAssigned, normal], [wornUnassigned])

  it('extracts worn rows across every group', () => {
    expect(wornItemsInDocumentOrder(grouped).map((entry) => entry.id)).toEqual([
      'worn-assigned',
      'worn-unassigned',
    ])
  })
})

// The Worn section renders in DOCUMENT order, and it has to derive that
// itself. This walks the grouped buckets, so without a sort two worn rows
// in different groups come out ordered by their GROUPS - which is not an order
// the user ever chose for them.
//
// Pack order is deliberately not used here either: worn rows sit outside the
// packing tree and cannot be dragged, so ranking them by a pack rank would
// sort them on a number nobody can control. They keep that rank - it reserves
// their slot for when they stop being worn - it just is not what this reads.
describe('wornItemsInDocumentOrder ordering', () => {
  it('orders by document rank across groups, not by group', () => {
    // Document order says late-bag-row comes FIRST. Group order would put it
    // last, because its bag sorts second. Pack ranks run the other way, so
    // sorting by pack rank fails here too.
    const early = item('early-doc', 'loc-2', true, 0, 99)
    const late = item('late-doc', 'loc-1', true, 5, 0)
    // First bag then second bag, so `late` leads. That inversion is the point:
    // a version that stopped sorting would return it first and fail below.
    const grouped = groups([late], [early])

    expect(wornItemsInDocumentOrder(grouped).map((entry) => entry.id)).toEqual([
      'early-doc',
      'late-doc',
    ])
  })

  it('ignores pack rank entirely', () => {
    // Pack ranks are the reverse of document ranks. Document order wins.
    const a = item('a', 'loc-1', true, 0, 2)
    const b = item('b', 'loc-1', true, 1, 1)
    const c = item('c', 'loc-1', true, 2, 0)
    // All in ONE bag, in pack-rank order c-b-a, so a version that sorted only
    // across groups would keep that order. The second bag is empty.
    const grouped = groups([c, b, a], [])

    expect(wornItemsInDocumentOrder(grouped).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })
})
