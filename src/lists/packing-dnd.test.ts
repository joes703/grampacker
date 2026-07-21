import { describe, expect, it } from 'vitest'
import type { ListItemWithGear } from '../lib/types'
import { makeDnDId } from '../lib/dnd-ids'
import { planPackingItemDrop } from './packing-dnd'

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
})
