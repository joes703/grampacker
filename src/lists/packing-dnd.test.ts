import { describe, expect, it } from 'vitest'
import type { ListItemWithGear } from '../lib/types'
import { makeDnDId } from '../lib/dnd-ids'
import {
  isPackingCollisionTarget,
  planPackingItemDragEnd,
  planPackingItemDrop,
  planPackingItemReorder,
} from './packing-dnd'

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

const source = item('source', 'loc-a')
const target = item('target', 'loc-b')
const items = [source, target]
const validLocationIds = new Set(['loc-a', 'loc-b'])
const containerItemIdByLocation = new Map([['loc-b', 'source']])
const noContainerItems = new Map<string, string>()
const noExcludedLocations = new Map<string, ReadonlySet<string>>()

describe('planPackingItemReorder', () => {
  const first = item('first', 'loc-a', 2)
  const second = item('second', 'loc-a', 8)
  const elsewhere = item('elsewhere', 'loc-b', 5)
  const reorderItems = [first, elsewhere, second]

  it('reorders rows within the same packing location', () => {
    expect(planPackingItemReorder(
      makeDnDId('packing-item', first.id),
      makeDnDId('packing-item', second.id),
      reorderItems,
    )).toEqual([
      { id: 'second', packSortOrder: 2 },
      { id: 'first', packSortOrder: 8 },
    ])
  })

  it('supports the checklist item id kind used in Pack Mode', () => {
    expect(planPackingItemReorder(
      makeDnDId('item', first.id),
      makeDnDId('item', second.id),
      reorderItems,
      'item',
    )).toEqual([
      { id: 'second', packSortOrder: 2 },
      { id: 'first', packSortOrder: 8 },
    ])
  })

  it('does not reorder hidden backing items that render as container headers', () => {
    const hiddenContainer = item('hidden-container', 'loc-a', 5)
    expect(planPackingItemReorder(
      makeDnDId('packing-item', first.id),
      makeDnDId('packing-item', second.id),
      [first, hiddenContainer, second],
      'packing-item',
      new Set([hiddenContainer.id]),
    )).toEqual([
      { id: 'second', packSortOrder: 2 },
      { id: 'first', packSortOrder: 8 },
    ])
  })

  it('leaves cross-location and location-section drops for the move planner', () => {
    expect(planPackingItemReorder(
      makeDnDId('packing-item', first.id),
      makeDnDId('packing-item', elsewhere.id),
      reorderItems,
    )).toBeNull()
    expect(planPackingItemReorder(
      makeDnDId('packing-item', first.id),
      makeDnDId('packing-location', 'loc-a'),
      reorderItems,
    )).toBeNull()
  })
})

describe('planPackingItemDrop', () => {
  it('assigns when dropped on a location section', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-b'),
      items,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ itemId: 'source', locationId: 'loc-b' })
  })

  it('uses the target row location when dropped on another item', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-item', target.id),
      items,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ itemId: 'source', locationId: 'loc-b' })
  })

  it('supports the Unassigned droppable', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'unassigned'),
      items,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ itemId: 'source', locationId: null })
  })

  it('rejects a same-location drop and non-item active ids', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-a'),
      items,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toBeNull()
    expect(planPackingItemDrop(
      makeDnDId('packing-location', 'loc-a'),
      makeDnDId('packing-location', 'loc-b'),
      items,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toBeNull()
  })

  it('rejects an optimistic location that does not have a server id yet', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'temp-pending'),
      items,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toBeNull()
  })

  it('rejects dropping an item into the location it backs', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-b'),
      items,
      validLocationIds,
      containerItemIdByLocation,
      noExcludedLocations,
    )).toBeNull()
  })

  it('rejects dropping a container into one of its descendants', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-child'),
      items,
      new Set([...validLocationIds, 'loc-child']),
      containerItemIdByLocation,
      new Map([['source', new Set(['loc-b', 'loc-child'])]]),
    )).toBeNull()
  })
})

describe('planPackingItemDragEnd', () => {
  const sibling = item('sibling', 'loc-a', 3)
  const dragItems = [item('dragged', 'loc-a', 1), sibling, target]

  it('prioritizes a same-location row drop as a reorder', () => {
    expect(planPackingItemDragEnd(
      makeDnDId('packing-item', 'dragged'),
      makeDnDId('packing-item', sibling.id),
      dragItems,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({
      kind: 'reorder',
      updates: [
        { id: 'sibling', packSortOrder: 1 },
        { id: 'dragged', packSortOrder: 3 },
      ],
    })
  })

  it('keeps a cross-location row drop as a move', () => {
    expect(planPackingItemDragEnd(
      makeDnDId('packing-item', 'dragged'),
      makeDnDId('packing-item', target.id),
      dragItems,
      validLocationIds,
      noContainerItems,
      noExcludedLocations,
    )).toEqual({ kind: 'move', itemId: 'dragged', locationId: 'loc-b' })
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

  it('retains item, location, and Unassigned targets while moving an item', () => {
    const active = makeDnDId('packing-item', source.id)

    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-item', target.id),
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
  })
})
