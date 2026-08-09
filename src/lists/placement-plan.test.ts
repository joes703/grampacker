import { describe, expect, it } from 'vitest'
import type { FoodItemResponse } from '../../shared/food'
import type { ListItemWithGear } from '../lib/types'
import {
  isNoOpSlot,
  placementSlotLabel,
  planPlacementWithinLocation,
  visualSlotToInsertIndex,
} from './placement-plan'
import type { PackRow, UnionRankUpdates } from './pack-rows'

function gearRow(id: string, sortOrder: number): PackRow {
  return { kind: 'gear', gear: item(id, sortOrder) }
}

function foodRow(id: string, packSortOrder: number): PackRow {
  const food: FoodItemResponse = {
    id,
    name: id,
    weightGrams: 100,
    quantity: 1,
    sortOrder: 0,
    isPacked: false,
    isReady: false,
    packingLocationId: 'loc-1',
    packSortOrder,
    slotIds: [],
  }
  return { kind: 'food', food }
}

function item(id: string, sortOrder: number): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: 'loc-1',
    sortOrder,
    packSortOrder: sortOrder,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      categoryId: null,
      name: id,
      description: null,
      weightGrams: 100,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

// A B C D E, ranks deliberately sparse: nothing constrains them to be dense
// and imports leave gaps on purpose. C is a FOOD row (0022: placement spans
// the union), so every move through it exercises the cross-kind path.
const rows = [gearRow('A', 0), gearRow('B', 10), foodRow('C', 20), gearRow('D', 30), gearRow('E', 45)]
// Click-to-place is a Pack action, so the plan it returns permutes PACK ranks
// across both payload halves. The assertions below pin the resulting ORDER of
// the union, which is the point.
const order = (updates: UnionRankUpdates | null) =>
  updates === null
    ? null
    : [...updates.items, ...updates.foodItems]
        .sort((x, y) => x.packSortOrder - y.packSortOrder)
        .map((u) => u.id)
const allEntries = (updates: UnionRankUpdates) => [
  ...updates.items,
  ...updates.foodItems,
]

describe('visualSlotToInsertIndex', () => {
  // The moving row occupies a position in the VISUAL list but not in the
  // reduced one, so every slot past it shifts down by one. Getting this
  // backwards only breaks movement in one direction, which is why it is
  // pinned in both.
  it('passes slots above the row through unchanged', () => {
    expect(visualSlotToInsertIndex(0, 2)).toBe(0)
    expect(visualSlotToInsertIndex(2, 2)).toBe(2)
  })

  it('shifts slots below the row down by one', () => {
    expect(visualSlotToInsertIndex(3, 2)).toBe(2)
    expect(visualSlotToInsertIndex(5, 2)).toBe(4)
  })
})

describe('isNoOpSlot', () => {
  it('suppresses both slots touching the row, wherever it sits', () => {
    // Middle.
    expect(isNoOpSlot(2, 2)).toBe(true)
    expect(isNoOpSlot(3, 2)).toBe(true)
    expect(isNoOpSlot(1, 2)).toBe(false)
    expect(isNoOpSlot(4, 2)).toBe(false)
    // First row: slots 0 and 1.
    expect(isNoOpSlot(0, 0)).toBe(true)
    expect(isNoOpSlot(1, 0)).toBe(true)
    expect(isNoOpSlot(2, 0)).toBe(false)
    // Last row of five: slots 4 and 5.
    expect(isNoOpSlot(4, 4)).toBe(true)
    expect(isNoOpSlot(5, 4)).toBe(true)
    expect(isNoOpSlot(3, 4)).toBe(false)
  })

  it('leaves a single-row bag with no usable slot at all', () => {
    // One row means two slots and both touch it. The UI must refuse to open
    // placement rather than showing a mode with nothing in it.
    expect(isNoOpSlot(0, 0)).toBe(true)
    expect(isNoOpSlot(1, 0)).toBe(true)
  })
})

describe('planPlacementWithinLocation', () => {
  it('moves a middle row to the top', () => {
    expect(order(planPlacementWithinLocation('C', 0, rows))).toEqual(['C', 'A', 'B', 'D', 'E'])
  })

  it('moves a middle row to the bottom', () => {
    expect(order(planPlacementWithinLocation('C', 4, rows))).toEqual(['A', 'B', 'D', 'E', 'C'])
  })

  it('moves a row up by one', () => {
    expect(order(planPlacementWithinLocation('C', 1, rows))).toEqual(['A', 'C', 'B', 'D', 'E'])
  })

  it('moves a row down by one', () => {
    expect(order(planPlacementWithinLocation('C', 3, rows))).toEqual(['A', 'B', 'D', 'C', 'E'])
  })

  it('moves the first row and the last row', () => {
    expect(order(planPlacementWithinLocation('A', 4, rows))).toEqual(['B', 'C', 'D', 'E', 'A'])
    expect(order(planPlacementWithinLocation('E', 0, rows))).toEqual(['E', 'A', 'B', 'C', 'D'])
  })

  it('refuses the no-op, a missing row, and an out-of-range slot', () => {
    expect(planPlacementWithinLocation('C', 2, rows)).toBeNull()
    expect(planPlacementWithinLocation('missing', 1, rows)).toBeNull()
    expect(planPlacementWithinLocation('C', -1, rows)).toBeNull()
    expect(planPlacementWithinLocation('C', 5, rows)).toBeNull()
  })

  it('permutes the cohort ranks rather than minting new ones', () => {
    // Load-bearing twice over: it keeps rows OUTSIDE this bag from renumbering,
    // and the optimistic reorder validator rejects any update set that is not
    // a permutation of the ranks it touched.
    const updates = planPlacementWithinLocation('C', 0, rows)!
    expect(allEntries(updates).map((u) => u.packSortOrder).sort((a, b) => a - b))
      .toEqual([0, 10, 20, 30, 45])
    expect(allEntries(updates).map((u) => u.id).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    // The food row's new rank rides the food half of the payload.
    expect(updates.foodItems).toEqual([{ id: 'C', packSortOrder: 0 }])
  })

  it('operates on the array it is GIVEN, hidden rows already absent', () => {
    // The caller passes the rendered cohort, so filtered-out rows never appear
    // here and keep their ranks untouched. Reconstructing the cohort from a
    // location id instead is the bug this signature exists to prevent.
    const visible = [rows[0]!, rows[2]!, rows[4]!] // A, C, E
    const updates = planPlacementWithinLocation('E', 0, visible)!
    expect(order(updates)).toEqual(['E', 'A', 'C'])
    expect(allEntries(updates).map((u) => u.id).sort()).toEqual(['A', 'C', 'E'])
    // B and D are untouched entirely.
    expect(allEntries(updates).map((u) => u.packSortOrder).sort((a, b) => a - b)).toEqual([0, 20, 45])
  })

  it('handles a two-row bag, where every real move is a swap', () => {
    const two = [gearRow('A', 5), gearRow('B', 9)]
    expect(order(planPlacementWithinLocation('B', 0, two))).toEqual(['B', 'A'])
    expect(order(planPlacementWithinLocation('A', 1, two))).toEqual(['B', 'A'])
  })
})

describe('planPlacementWithinLocation over a tied cohort', () => {
  it('heals a cross-table tie densely, avoiding reserved ranks', () => {
    // Visible gear and food tied at 0, hidden worn row reserving 1 (passed
    // as avoidRanks). Placing the food row first must produce unique ranks
    // that skip the reserved slot - round-5 finding 2: without the avoid
    // set this path minted the worn row's rank.
    const tied = [gearRow('G', 0), foodRow('F', 0)]
    const updates = planPlacementWithinLocation('F', 0, tied, new Set([1]))!
    expect(updates).toEqual({
      items: [{ id: 'G', packSortOrder: 2 }],
      foodItems: [{ id: 'F', packSortOrder: 0 }],
    })
  })
})

describe('placementSlotLabel', () => {
  it('names the row, the destination and the bag', () => {
    expect(placementSlotLabel('Tarp', 1, rows, 'Main pack')).toBe('Place Tarp before B')
  })

  it('says "at the end" for the trailing slot', () => {
    expect(placementSlotLabel('Tarp', rows.length, rows, 'Main pack'))
      .toBe('Place Tarp at the end of Main pack')
  })
})
