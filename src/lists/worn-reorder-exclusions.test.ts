import { describe, expect, it } from 'vitest'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { derivePackReorderExclusions } from './ListDetailPage'
import { deriveWornReorderExclusions } from './packing-tree'

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
    packSortOrder: 0,
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

// Organize and Pack used to be separate views that each derived their own
// reorder exclusions, and this test existed to keep the two definitions in
// agreement. They are one view now, but both derivations survive - the page
// composes deriveWornReorderExclusions with the container ids for the packing
// planner, and derivePackReorderExclusions does the same job in one call for
// the category planner. Two call sites, one answer required.
describe('packing reorder exclusions', () => {
  it('derives the same complete exclusion set from either entry point', () => {
    const items = [item('a'), item('b'), item('worn', true), item('container')]
    const locations: PackingLocation[] = [{
      id: 'loc-1',
      name: 'Backpack',
      sortOrder: 0,
      containerListItemId: 'container',
    }]
    const containerItemIdByLocation = new Map([['loc-1', 'container']])
    const packingPlannerExclusions = new Set([
      ...containerItemIdByLocation.values(),
      ...deriveWornReorderExclusions(items),
    ])

    expect(derivePackReorderExclusions(items, locations)).toEqual(packingPlannerExclusions)
    expect([...packingPlannerExclusions].sort()).toEqual(['container', 'worn'])
  })
})
