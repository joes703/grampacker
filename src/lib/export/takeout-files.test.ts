import { describe, expect, it } from 'vitest'
import { gearItemsToCsv, listItemsToCsv } from '../csv'
import type { Category, GearItem, List, ListItemWithGear } from '../types'
import { buildTakeoutFiles, exportTimestamp } from './takeout-files'

function makeCategory(over: Partial<Category> & { id: string; name: string }): Category {
  return {
    id: over.id,
    name: over.name,
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2024-01-01',
  }
}

function makeGear(over: Partial<GearItem> & { id: string; name: string }): GearItem {
  return {
    id: over.id,
    categoryId: 'categoryId' in over ? over.categoryId ?? null : 'cat-shelter',
    name: over.name,
    description: over.description ?? null,
    weightGrams: over.weightGrams ?? 100,
    cost: over.cost ?? null,
    purchaseDate: over.purchaseDate ?? null,
    status: over.status ?? 'active',
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2024-01-01',
    updatedAt: over.updatedAt ?? '2024-01-01',
  }
}

function makeListItem(
  over: Partial<ListItemWithGear> & { id: string; listId: string; gearItem: GearItem },
): ListItemWithGear {
  return {
    id: over.id,
    listId: over.listId,
    gearItemId: over.gearItem.id,
    quantity: over.quantity ?? 1,
    isWorn: over.isWorn ?? false,
    isConsumable: over.isConsumable ?? false,
    isPacked: over.isPacked ?? false,
    isReady: over.isReady ?? false,
    packingLocationId: over.packingLocationId ?? null,
    sortOrder: over.sortOrder ?? 0,
    packSortOrder: over.packSortOrder ?? over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2024-01-01',
    updatedAt: over.updatedAt ?? '2024-01-01',
    gearItem: over.gearItem,
  }
}

function makeList(over: Partial<List> & { id: string; name: string }): List {
  return {
    id: over.id,
    name: over.name,
    description: over.description ?? null,
    slug: over.slug ?? `slug-${over.id}`,
    isShared: over.isShared ?? false,
    isDraft: over.isDraft ?? false,
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2024-01-01',
    updatedAt: over.updatedAt ?? '2024-01-01',
  }
}

const categories: Category[] = [
  makeCategory({ id: 'cat-shelter', name: 'Shelter', sortOrder: 0 }),
  makeCategory({ id: 'cat-kitchen', name: 'Kitchen', sortOrder: 1 }),
]

const gearItems: GearItem[] = [
  makeGear({ id: 'g-1', name: 'Tarp', categoryId: 'cat-shelter', weightGrams: 240 }),
  makeGear({ id: 'g-2', name: 'Stove', categoryId: 'cat-kitchen', weightGrams: 100 }),
]

// Spread into the tests that do not exercise packing, so their expectations
// stay about the files rather than the packing snapshot's inputs.
const noPacking = { packingLocationsByListId: new Map(), foodByListId: new Map() }

describe('buildTakeoutFiles', () => {
  it('always emits the library files, matching their standalone exports', () => {
    const files = buildTakeoutFiles({ categories, gearItems, lists: [], allItems: [], ...noPacking })
    expect(Object.keys(files).sort()).toEqual([
      'food.json',
      'gear-library.csv',
      'packing.json',
    ])
    expect(files['gear-library.csv']).toBe(gearItemsToCsv(gearItems, categories))
  })

  it('emits one lists/<slug>.csv per list, grouping items by listId', () => {
    const lists = [
      makeList({ id: 'l-1', name: 'Weekend Trip' }),
      makeList({ id: 'l-2', name: 'Thru Hike' }),
    ]
    const itemA = makeListItem({ id: 'i-1', listId: 'l-1', gearItem: gearItems[0]! })
    const itemB = makeListItem({ id: 'i-2', listId: 'l-2', gearItem: gearItems[1]! })
    // Deliberately interleave so grouping (not order) is what's tested.
    const files = buildTakeoutFiles({
      categories,
      gearItems,
      lists,
      allItems: [itemB, itemA],
      ...noPacking,
    })

    expect(Object.keys(files).sort()).toEqual([
      'food.json',
      'gear-library.csv',
      'lists/thru-hike.csv',
      'lists/weekend-trip.csv',
      'packing.json',
    ])
    // Each list CSV contains only its own items.
    expect(files['lists/weekend-trip.csv']).toBe(listItemsToCsv([itemA], categories))
    expect(files['lists/thru-hike.csv']).toBe(listItemsToCsv([itemB], categories))
  })

  it('disambiguates duplicate slugs in list order (trip, trip-2, trip-3)', () => {
    const lists = [
      makeList({ id: 'l-1', name: 'Trip' }),
      makeList({ id: 'l-2', name: 'trip!' }), // slugifies to the same base
      makeList({ id: 'l-3', name: 'TRIP' }),
    ]
    const files = buildTakeoutFiles({ categories, gearItems, lists, allItems: [], ...noPacking })
    const listFiles = Object.keys(files).filter((k) => k.startsWith('lists/'))
    expect(listFiles).toEqual(['lists/trip.csv', 'lists/trip-2.csv', 'lists/trip-3.csv'])
  })

  it('falls back to "list" when a name slugifies to empty, still disambiguating', () => {
    const lists = [
      makeList({ id: 'l-1', name: '!!!' }),
      makeList({ id: 'l-2', name: '---' }),
    ]
    const files = buildTakeoutFiles({ categories, gearItems, lists, allItems: [], ...noPacking })
    const listFiles = Object.keys(files).filter((k) => k.startsWith('lists/'))
    expect(listFiles).toEqual(['lists/list.csv', 'lists/list-2.csv'])
  })

  it('emits an empty (0-byte) CSV file for a list with no items', () => {
    // The file still exists so the export names every list. A header row
    // would add nothing: import treats header-only and empty files the same.
    const lists = [makeList({ id: 'l-1', name: 'Empty' })]
    const files = buildTakeoutFiles({ categories, gearItems, lists, allItems: [], ...noPacking })
    expect(files['lists/empty.csv']).toBe('')
  })

  it('emits a self-contained packing snapshot with empty and duplicate-named locations', () => {
    const lists = [makeList({ id: 'l-1', name: 'JMT section' })]
    const assigned = makeListItem({
      id: 'i-1',
      listId: 'l-1',
      gearItem: gearItems[0]!,
      packingLocationId: 'loc-a',
    })
    const unassigned = makeListItem({
      id: 'i-2',
      listId: 'l-1',
      gearItem: gearItems[1]!,
      packingLocationId: null,
    })
    const packingLocationsByListId = new Map([
      ['l-1', [
        {
          id: 'loc-b', name: 'Side pocket', sortOrder: 1, containerListItemId: null,
        },
        {
          id: 'loc-a', name: 'Side pocket', sortOrder: 0, containerListItemId: 'i-2',
        },
        {
          id: 'loc-empty', name: 'Lid', sortOrder: 2, containerListItemId: null,
        },
      ]],
    ])

    const files = buildTakeoutFiles({
      categories,
      gearItems,
      lists,
      allItems: [assigned, unassigned],
      packingLocationsByListId,
      foodByListId: new Map([
        ['l-1', {
          dayCount: 1,
          slots: [],
          items: [
            {
              id: 'food-2', name: 'Oats', weightGrams: 90, quantity: 1, isPerMeal: false, unitCount: 1,
              sortOrder: 1, isPacked: true, isReady: false,
              packingLocationId: null, packSortOrder: 7, slotIds: [],
            },
            {
              id: 'food-1', name: 'Tortillas', weightGrams: 300, quantity: 2, isPerMeal: false, unitCount: 2,
              sortOrder: 0, isPacked: false, isReady: false,
              packingLocationId: 'loc-b', packSortOrder: 3, slotIds: [],
            },
          ],
        }],
      ]),
    })
    const packing = JSON.parse(files['packing.json'] ?? '') as {
      version: number
      lists: Array<{
        list: { id: string; name: string }
        locations: Array<{
          id: string
          name: string
          sortOrder: number
          containerListItemId: string | null
        }>
        items: Array<{
          listItemId: string
          gearItem: { id: string; name: string }
          packingLocationId: string | null
          packSortOrder: number
        }>
        foodItems: Array<{
          foodItemId: string
          name: string
          packingLocationId: string | null
          packSortOrder: number
        }>
      }>
    }

    expect(packing.version).toBe(4)
    expect(packing.lists[0]?.list).toEqual({ id: 'l-1', name: 'JMT section' })
    expect(packing.lists[0]?.locations.map((location) => location.id)).toEqual([
      'loc-a', 'loc-b', 'loc-empty',
    ])
    expect(packing.lists[0]?.locations.filter((location) => location.name === 'Side pocket'))
      .toHaveLength(2)
    expect(packing.lists[0]?.locations.find((location) => location.id === 'loc-a'))
      .toMatchObject({ containerListItemId: 'i-2' })
    // The food half of the union (0022): organization only (bag + rank),
    // emitted in pack order. Authoring data stays in food.json.
    expect(packing.lists[0]?.foodItems).toEqual([
      { foodItemId: 'food-1', name: 'Tortillas', packingLocationId: 'loc-b', packSortOrder: 3 },
      { foodItemId: 'food-2', name: 'Oats', packingLocationId: null, packSortOrder: 7 },
    ])

    const locationIds = new Set(packing.lists[0]?.locations.map((location) => location.id))
    for (const item of packing.lists[0]?.items ?? []) {
      expect(item.listItemId).not.toBe('')
      expect(item.gearItem.id).not.toBe('')
      expect(item.gearItem.name).not.toBe('')
      if (item.packingLocationId !== null) {
        expect(locationIds.has(item.packingLocationId)).toBe(true)
      }
    }
    expect(packing.lists[0]?.items.find((item) => item.listItemId === 'i-2')?.packingLocationId)
      .toBeNull()

    // v3's reason for existing. The version bump alone would pass even if the
    // new field were silently dropped, which would make this file a LOSSY
    // snapshot while claiming to be a lossless one - the export exists so a
    // reimport can rebuild how a list was organized, and "which bag" without
    // "where in the bag" no longer rebuilds it.
    for (const item of packing.lists[0]?.items ?? []) {
      expect(typeof item.packSortOrder).toBe('number')
      expect(item.packSortOrder).toBeGreaterThanOrEqual(0)
    }
    // Emitted in pack order so the file reads the way Pack view does.
    const ranks = (packing.lists[0]?.items ?? []).map((item) => item.packSortOrder)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})

describe('exportTimestamp', () => {
  it('formats local time as YYYY-MM-DDTHH-MM-SS with zero-padding', () => {
    // Month is 0-indexed: 6 => July. Single-digit parts must pad.
    expect(exportTimestamp(new Date(2026, 6, 9, 4, 5, 3))).toBe('2026-07-09T04-05-03')
  })
})
