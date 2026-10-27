import { describe, expect, it } from 'vitest'
import type { FoodItemResponse } from '../../shared/food'
import type { ListItemWithGear } from '../lib/types'
import { makeDnDId } from '../lib/dnd-ids'
import { isPackingCollisionTarget, planPackingRowDragEnd } from './packing-dnd'

function item(
  id: string,
  locationId: string | null,
  sortOrder = 0,
): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: locationId,
    sortOrder,
    packSortOrder: sortOrder,
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

function food(
  id: string,
  locationId: string | null,
  packSortOrder = 0,
): FoodItemResponse {
  return {
    id,
    name: id,
    weightGrams: 100,
    quantity: 1,
    // Shared, so unitCount == quantity. Per-meal derivation has its own
    // tests.
    isPerMeal: false,
    unitCount: 1,
    sortOrder: 0,
    isPacked: false,
    isReady: false,
    packingLocationId: locationId,
    packSortOrder,
    slotIds: [],
  }
}

const source = item('source', 'loc-a')
const target = item('target', 'loc-b')
const items = [source, target]
const noFood: FoodItemResponse[] = []
const validLocationIds = new Set(['loc-a', 'loc-b'])
const containerItemIdByLocation = new Map([['loc-b', 'source']])
const noContainerItems = new Map<string, string>()
const noExcludedLocations = new Map<string, ReadonlySet<string>>()

// Gear-only payloads keep the historical shapes: same-location row drop is a
// union reorder with an empty food half; cross-location drop is a gear move.
describe('planPackingRowDragEnd over gear rows', () => {
  const first = item('first', 'loc-a', 2)
  const second = item('second', 'loc-a', 8)
  const elsewhere = item('elsewhere', 'loc-b', 5)
  const reorderItems = [first, elsewhere, second]

  it('reorders rows within the same packing location', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', first.id),
      makeDnDId('packing-item', second.id),
      reorderItems,
      noFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({
      kind: 'reorder',
      updates: {
        items: [
          { id: 'second', packSortOrder: 2 },
          { id: 'first', packSortOrder: 8 },
        ],
        foodItems: [],
      },
    })
  })

  it('does not reorder hidden backing items that render as container headers', () => {
    const hiddenContainer = item('hidden-container', 'loc-a', 5)
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', first.id),
      makeDnDId('packing-item', second.id),
      [first, hiddenContainer, second],
      noFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
      new Set([hiddenContainer.id]),
    )).toEqual({
      kind: 'reorder',
      updates: {
        items: [
          { id: 'second', packSortOrder: 2 },
          { id: 'first', packSortOrder: 8 },
        ],
        foodItems: [],
      },
    })
  })

  it('assigns when dropped on a location section', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-b'),
      items,
      noFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ kind: 'move-gear', itemId: 'source', locationId: 'loc-b' })
  })

  it('uses the target row location when dropped on another item', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-item', target.id),
      items,
      noFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ kind: 'move-gear', itemId: 'source', locationId: 'loc-b' })
  })

  it('supports the Unassigned droppable', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'unassigned'),
      items,
      noFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ kind: 'move-gear', itemId: 'source', locationId: null })
  })

  it('rejects a same-location drop and non-row active ids', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-a'),
      items,
      noFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toBeNull()
    expect(planPackingRowDragEnd(
      makeDnDId('packing-location', 'loc-a'),
      makeDnDId('packing-location', 'loc-b'),
      items,
      noFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toBeNull()
  })

  it('rejects an optimistic location that does not have a server id yet', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'temp-pending'),
      items,
      noFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toBeNull()
  })

  it('rejects dropping an item into the location it backs', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-b'),
      items,
      noFood,
      validLocationIds,
      containerItemIdByLocation,
      noExcludedLocations,
    )).toBeNull()
  })

  it('rejects dropping a container into one of its descendants', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-child'),
      items,
      noFood,
      new Set([...validLocationIds, 'loc-child']),
      containerItemIdByLocation,
      new Map([['source', new Set(['loc-b', 'loc-child'])]]),
    )).toBeNull()
  })
})

describe('planPackingRowDragEnd over the union', () => {
  // One bag, interleaved: gear at 2, food at 5, gear at 8.
  const gearLow = item('gear-low', 'loc-a', 2)
  const gearHigh = item('gear-high', 'loc-a', 8)
  const foodMid = food('food-mid', 'loc-a', 5)
  const unionItems = [gearLow, gearHigh, target]
  const unionFood = [foodMid]

  it('permutes ranks ACROSS gear and food in one reorder', () => {
    // Drag the food row onto the top gear row: food takes rank 2, the two
    // gear rows shift to 5 and 8.
    expect(planPackingRowDragEnd(
      makeDnDId('packing-food-item', foodMid.id),
      makeDnDId('packing-item', gearLow.id),
      unionItems,
      unionFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({
      kind: 'reorder',
      updates: {
        items: [
          { id: 'gear-low', packSortOrder: 5 },
          { id: 'gear-high', packSortOrder: 8 },
        ],
        foodItems: [{ id: 'food-mid', packSortOrder: 2 }],
      },
    })
  })

  it('reorders gear onto a food target within the bag', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', gearLow.id),
      makeDnDId('packing-food-item', foodMid.id),
      unionItems,
      unionFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({
      kind: 'reorder',
      updates: {
        items: [
          { id: 'gear-low', packSortOrder: 5 },
          { id: 'gear-high', packSortOrder: 8 },
        ],
        foodItems: [{ id: 'food-mid', packSortOrder: 2 }],
      },
    })
  })

  it('moves a food row dropped on a location section', () => {
    // loc-b is backed by a container item. Container rules are gear-only:
    // food cannot create a nesting cycle or contain itself, so it still moves.
    expect(planPackingRowDragEnd(
      makeDnDId('packing-food-item', foodMid.id),
      makeDnDId('packing-location', 'loc-b'),
      unionItems,
      unionFood,
      validLocationIds,
      containerItemIdByLocation,
      noExcludedLocations,
    )).toEqual({ kind: 'move-food', foodItemId: 'food-mid', locationId: 'loc-b' })
  })

  it('moves a food row dropped on a gear row in another bag', () => {
    expect(planPackingRowDragEnd(
      makeDnDId('packing-food-item', foodMid.id),
      makeDnDId('packing-item', target.id),
      unionItems,
      unionFood,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ kind: 'move-food', foodItemId: 'food-mid', locationId: 'loc-b' })
  })

  it('moves a gear row dropped on a food row in another bag', () => {
    const foodElsewhere = food('food-elsewhere', 'loc-b', 0)
    expect(planPackingRowDragEnd(
      makeDnDId('packing-item', gearLow.id),
      makeDnDId('packing-food-item', foodElsewhere.id),
      unionItems,
      [foodMid, foodElsewhere],
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ kind: 'move-gear', itemId: 'gear-low', locationId: 'loc-b' })
  })

  it('permutes only the food subsequence when every gear row is excluded (category fallback)', () => {
    // The no-locations fallback renders food in its own section; the page
    // excludes ALL gear so a food drag reorders exactly what that section
    // shows - a subset permutation of the union, which the server accepts.
    const foodTop = food('food-top', null, 1)
    const foodBottom = food('food-bottom', null, 6)
    const gearBetween = item('gear-between', null, 3)
    expect(planPackingRowDragEnd(
      makeDnDId('packing-food-item', foodBottom.id),
      makeDnDId('packing-food-item', foodTop.id),
      [gearBetween],
      [foodTop, foodBottom],
      new Set(),
      noContainerItems,
      noExcludedLocations,
      new Set([gearBetween.id]),
    )).toEqual({
      kind: 'reorder',
      updates: {
        items: [],
        foodItems: [
          { id: 'food-bottom', packSortOrder: 1 },
          { id: 'food-top', packSortOrder: 6 },
        ],
      },
    })
  })
})

describe('isPackingCollisionTarget', () => {
  it('keeps location reorders on real location sections, not their nested item rows', () => {
    const active = makeDnDId('packing-location', 'loc-a')
    const siblingLocationIdsById = new Map([
      ['loc-a', new Set(['loc-a', 'loc-b'])],
    ])

    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-location', 'loc-b'),
      siblingLocationIdsById,
    )).toBe(true)
    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-item', target.id),
      siblingLocationIdsById,
    )).toBe(false)
    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-location', 'unassigned'),
      siblingLocationIdsById,
    )).toBe(false)
  })

  it('retains item, food, location, and Unassigned targets while moving a row', () => {
    for (const active of [
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-food-item', 'food-x'),
    ]) {
      expect(isPackingCollisionTarget(
        active,
        makeDnDId('packing-item', target.id),
        new Map(),
      )).toBe(true)
      expect(isPackingCollisionTarget(
        active,
        makeDnDId('packing-food-item', 'food-y'),
        new Map(),
      )).toBe(true)
      expect(isPackingCollisionTarget(
        active,
        makeDnDId('packing-location', 'loc-b'),
        new Map(),
      )).toBe(true)
      expect(isPackingCollisionTarget(
        active,
        makeDnDId('packing-location', 'unassigned'),
        new Map(),
      )).toBe(true)
    }
  })
})
