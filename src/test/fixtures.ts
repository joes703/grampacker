import type { GearItem, List, ListItemWithGear } from '../lib/types'

const timestamp = '2026-07-01T00:00:00.000Z'

export function makeList(overrides: Partial<List> = {}): List {
  return {
    id: 'list-1', name: 'Sierra High Route', description: null,
    slug: 'abc123', isShared: false, isDraft: true, sortOrder: 0,
    createdAt: timestamp, updatedAt: timestamp, ...overrides,
  }
}

export function makeGearItem(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: 'gear-1', name: 'Cooking pot', description: null, categoryId: null,
    weightGrams: 210, cost: null, purchaseDate: null, status: 'active',
    sortOrder: 0, createdAt: timestamp, updatedAt: timestamp, ...overrides,
  }
}

export function makeListItem(overrides: Partial<ListItemWithGear> = {}): ListItemWithGear {
  const gearItem = overrides.gearItem ?? makeGearItem()
  return {
    id: 'li-1', listId: 'list-1', gearItemId: gearItem.id, gearItem,
    quantity: 1, isWorn: false, isConsumable: false, isPacked: false,
    isReady: false, packingLocationId: null, sortOrder: 0, packSortOrder: 0,
    createdAt: timestamp, updatedAt: timestamp, ...overrides,
  }
}
