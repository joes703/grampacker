import { describe, expect, it } from 'vitest'
import type { ListItemWithGear } from '../lib/types'
import { makeDnDId } from '../lib/dnd-ids'
import { isPackingCollisionTarget, planPackingItemDrop } from './packing-dnd'

function item(id: string, locationId: string | null): ListItemWithGear {
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
    sortOrder: 0,
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

describe('planPackingItemDrop', () => {
  it('assigns when dropped on a location section', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-b'),
      items,
      validLocationIds,
    )).toEqual({ itemId: 'source', locationId: 'loc-b' })
  })

  it('uses the target row location when dropped on another item', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-item', target.id),
      items,
      validLocationIds,
    )).toEqual({ itemId: 'source', locationId: 'loc-b' })
  })

  it('supports the Unassigned droppable', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'unassigned'),
      items,
      validLocationIds,
    )).toEqual({ itemId: 'source', locationId: null })
  })

  it('rejects a same-location drop and non-item active ids', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-a'),
      items,
      validLocationIds,
    )).toBeNull()
    expect(planPackingItemDrop(
      makeDnDId('packing-location', 'loc-a'),
      makeDnDId('packing-location', 'loc-b'),
      items,
      validLocationIds,
    )).toBeNull()
  })

  it('rejects an optimistic location that does not have a server id yet', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'temp-pending'),
      items,
      validLocationIds,
    )).toBeNull()
  })

  it('rejects dropping an item into the location it backs', () => {
    expect(planPackingItemDrop(
      makeDnDId('packing-item', source.id),
      makeDnDId('packing-location', 'loc-b'),
      items,
      validLocationIds,
      containerItemIdByLocation,
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

describe('isPackingCollisionTarget', () => {
  it('keeps location reorders on real location sections, not their nested item rows', () => {
    const active = makeDnDId('packing-location', 'loc-a')

    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-location', 'loc-b'),
    )).toBe(true)
    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-item', target.id),
    )).toBe(false)
    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-location', 'unassigned'),
    )).toBe(false)
  })

  it('retains item, location, and Unassigned targets while moving an item', () => {
    const active = makeDnDId('packing-item', source.id)

    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-item', target.id),
    )).toBe(true)
    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-location', 'loc-b'),
    )).toBe(true)
    expect(isPackingCollisionTarget(
      active,
      makeDnDId('packing-location', 'unassigned'),
    )).toBe(true)
  })
})
