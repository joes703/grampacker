import { describe, expect, it } from 'vitest'
import { makeDnDId } from '../lib/dnd-ids'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { planListItemReorder } from './ListDetailPage'

function item(
  id: string,
  sortOrder: number,
  isPacked: boolean,
): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked,
    isReady: false,
    packingLocationId: 'loc-1',
    sortOrder,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      name: id,
      description: null,
      weightGrams: 100,
      categoryId: 'cat-1',
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

const visibleFirst = item('visible-first', 1, false)
const hiddenPacked = item('hidden-packed', 2, true)
const visibleLast = item('visible-last', 3, false)
const items = [visibleFirst, hiddenPacked, visibleLast]
const locations: PackingLocation[] = [{
  id: 'loc-1',
  name: 'Pack',
  sortOrder: 0,
  containerListItemId: null,
}]
const expectedVisibleSlotSwap = [
  { id: 'visible-last', sortOrder: 1 },
  { id: 'visible-first', sortOrder: 3 },
]

describe('ListDetailPage reorder planning', () => {
  it.each(['location', 'category'] as const)(
    'preserves hidden packed rows when reordering visible %s rows',
    (groupingKind) => {
      expect(planListItemReorder({
        activeId: makeDnDId('item', visibleLast.id),
        overId: makeDnDId('item', visibleFirst.id),
        items,
        groupingKind,
        locations,
        hidePackedItems: true,
      })).toEqual(expectedVisibleSlotSwap)
    },
  )
})
