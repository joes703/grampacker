import { describe, expect, it } from 'vitest'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { derivePackReorderExclusions } from './ListDetailPage'
import { deriveOrganizeHiddenReorderItemIds } from './OrganizePackPanel'

function item(id: string, isWorn = false): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: 'loc-1',
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

describe('Pack and Organize worn reorder wiring', () => {
  it('derives the same complete exclusion set in both modes', () => {
    const items = [item('a'), item('b'), item('worn', true), item('container')]
    const locations: PackingLocation[] = [{
      id: 'loc-1',
      name: 'Backpack',
      sortOrder: 0,
      containerListItemId: 'container',
    }]
    const containerItemIdByLocation = new Map([['loc-1', 'container']])
    const organizeExclusions = new Set([
      ...containerItemIdByLocation.values(),
      ...deriveOrganizeHiddenReorderItemIds(items),
    ])

    expect(derivePackReorderExclusions(items, locations)).toEqual(organizeExclusions)
    expect([...organizeExclusions].sort()).toEqual(['container', 'worn'])
  })
})
