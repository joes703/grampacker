import { describe, expect, it } from 'vitest'
import type { ListItemWithGear } from '../lib/types'
import {
  isNoOpSlot,
  placementSlotLabel,
  planPlacementWithinLocation,
  visualSlotToInsertIndex,
} from './placement-plan'

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
// and imports leave gaps on purpose.
const rows = [item('A', 0), item('B', 10), item('C', 20), item('D', 30), item('E', 45)]
const order = (updates: { id: string; sortOrder: number }[] | null) =>
  updates === null
    ? null
    : [...updates].sort((x, y) => x.sortOrder - y.sortOrder).map((u) => u.id)

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
    expect(updates.map((u) => u.sortOrder).sort((a, b) => a - b))
      .toEqual(rows.map((r) => r.sortOrder).sort((a, b) => a - b))
    expect(updates.map((u) => u.id).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('operates on the array it is GIVEN, hidden rows already absent', () => {
    // The caller passes the rendered cohort, so filtered-out rows never appear
    // here and keep their ranks untouched. Reconstructing the cohort from a
    // location id instead is the bug this signature exists to prevent.
    const visible = [rows[0]!, rows[2]!, rows[4]!] // A, C, E
    const updates = planPlacementWithinLocation('E', 0, visible)!
    expect(order(updates)).toEqual(['E', 'A', 'C'])
    expect(updates.map((u) => u.id).sort()).toEqual(['A', 'C', 'E'])
    // B and D are untouched entirely.
    expect(updates.map((u) => u.sortOrder).sort((a, b) => a - b)).toEqual([0, 20, 45])
  })

  it('handles a two-row bag, where every real move is a swap', () => {
    const two = [item('A', 5), item('B', 9)]
    expect(order(planPlacementWithinLocation('B', 0, two))).toEqual(['B', 'A'])
    expect(order(planPlacementWithinLocation('A', 1, two))).toEqual(['B', 'A'])
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
