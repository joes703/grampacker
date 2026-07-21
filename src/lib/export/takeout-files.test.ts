import { describe, expect, it } from 'vitest'
import { FOOD_CSV_HEADER, foodItemsToCsv, gearItemsToCsv, listItemsToCsv } from '../csv'
import type { Category, FoodItem, GearItem, List, ListItemWithGear } from '../types'
import type { FoodPlanDocument, TargetDefault } from '../queries'
import { buildTakeoutFiles, exportTimestamp } from './takeout-files'

// No foods / no plans - spread into the gear-focused tests so their
// assertions stay about gear and lists.
const noFood = {
  foodItems: [] as FoodItem[],
  foodPlans: [] as FoodPlanDocument[],
  targetDefaults: [] as TargetDefault[],
  packingLocationsByListId: new Map(),
}

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
    foodPlanId: over.foodPlanId ?? null,
    isShared: over.isShared ?? false,
    groupWorn: over.groupWorn ?? false,
    readyChecksEnabled: over.readyChecksEnabled ?? false,
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

describe('buildTakeoutFiles', () => {
  it('always emits the library files, matching their standalone exports', () => {
    const files = buildTakeoutFiles({ categories, gearItems, lists: [], allItems: [], ...noFood })
    // The bundle shape is stable: both library files and the json envelope
    // are present even with zero foods and zero plans.
    expect(Object.keys(files).sort()).toEqual([
      'food-data.json',
      'food-library.csv',
      'gear-library.csv',
      'packing.json',
    ])
    expect(files['gear-library.csv']).toBe(gearItemsToCsv(gearItems, categories))
    // Header-only, never a zero-byte file, so the bundle shape is stable.
    expect(files['food-library.csv']).toBe(FOOD_CSV_HEADER)
    expect(JSON.parse(files['food-data.json'] ?? '')).toEqual({
      version: 4,
      foodItems: [],
      foodPlans: [],
      targetDefaults: [],
    })
  })

  it('emits food-library.csv and a version-4 food-data.json with plan graphs + defaults', () => {
    const foodItems: FoodItem[] = [
      {
        id: 'f-1', name: 'Oats', brand: 'Quaker', servingDescription: '1 packet',
        servingWeightGrams: 43, caloriesPerServing: 150, servingsPerPackage: 1,
        fatGrams: 3, saturatedFatGrams: 0.5, carbsGrams: 27, fiberGrams: 3,
        sugarGrams: 12, proteinGrams: 4, sodiumMg: 0, potassiumMg: null,
        notes: null, sortOrder: 0,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    ]
    const foodPlans: FoodPlanDocument[] = [
      {
        id: 'p-1', name: 'JMT week 1', sortOrder: 0,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        meals: [{ id: 'm-1', name: 'Breakfast', anchorRole: 'breakfast', isDefault: true, sortOrder: 0 }],
        days: [{ id: 'd-1', dayTypeOverride: null, sortOrder: 0 }],
        dayMeals: [{ id: 'dm-1', dayId: 'd-1', mealId: 'm-1' }],
        entries: [{ id: 'e-1', dayMealId: 'dm-1', isExtra: false, foodItemId: 'f-1', basis: 'servings', amount: 2, sortOrder: 0 }],
        dailyTargets: [
          { id: 'dt-1', metric: 'calories', mode: 'min', targetMin: 2500, targetMax: null },
        ],
        mealTargets: [
          { id: 'mt-1', mealId: 'm-1', metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 35 },
        ],
        usedByList: { id: 'l-1', name: 'JMT' },
      },
    ]
    const targetDefaults: TargetDefault[] = [
      { id: 'td-1', metric: 'protein', mode: 'min', targetMin: 120, targetMax: null },
    ]
    const files = buildTakeoutFiles({
      categories,
      gearItems,
      lists: [],
      allItems: [],
      packingLocationsByListId: new Map(),
      foodItems,
      foodPlans,
      targetDefaults,
    })
    expect(files['food-library.csv']).toBe(foodItemsToCsv(foodItems))
    expect(JSON.parse(files['food-data.json'] ?? '')).toEqual({
      version: 4,
      foodItems,
      foodPlans,
      targetDefaults,
    })
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
      ...noFood,
    })

    expect(Object.keys(files).sort()).toEqual([
      'food-data.json',
      'food-library.csv',
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
    const files = buildTakeoutFiles({ categories, gearItems, lists, allItems: [], ...noFood })
    const listFiles = Object.keys(files).filter((k) => k.startsWith('lists/'))
    expect(listFiles).toEqual(['lists/trip.csv', 'lists/trip-2.csv', 'lists/trip-3.csv'])
  })

  it('falls back to "list" when a name slugifies to empty, still disambiguating', () => {
    const lists = [
      makeList({ id: 'l-1', name: '!!!' }),
      makeList({ id: 'l-2', name: '---' }),
    ]
    const files = buildTakeoutFiles({ categories, gearItems, lists, allItems: [], ...noFood })
    const listFiles = Object.keys(files).filter((k) => k.startsWith('lists/'))
    expect(listFiles).toEqual(['lists/list.csv', 'lists/list-2.csv'])
  })

  it('emits a header-only CSV for a list with no items', () => {
    const lists = [makeList({ id: 'l-1', name: 'Empty' })]
    const files = buildTakeoutFiles({ categories, gearItems, lists, allItems: [], ...noFood })
    expect(files['lists/empty.csv']).toBe(listItemsToCsv([], categories))
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
        { id: 'loc-b', name: 'Side pocket', sortOrder: 1 },
        { id: 'loc-a', name: 'Side pocket', sortOrder: 0 },
        { id: 'loc-empty', name: 'Lid', sortOrder: 2 },
      ]],
    ])

    const files = buildTakeoutFiles({
      categories,
      gearItems,
      lists,
      allItems: [assigned, unassigned],
      ...noFood,
      packingLocationsByListId,
    })
    const packing = JSON.parse(files['packing.json'] ?? '') as {
      version: number
      lists: Array<{
        list: { id: string; name: string }
        locations: Array<{ id: string; name: string; sortOrder: number }>
        items: Array<{
          listItemId: string
          gearItem: { id: string; name: string }
          packingLocationId: string | null
        }>
      }>
    }

    expect(packing.version).toBe(1)
    expect(packing.lists[0]?.list).toEqual({ id: 'l-1', name: 'JMT section' })
    expect(packing.lists[0]?.locations.map((location) => location.id)).toEqual([
      'loc-a', 'loc-b', 'loc-empty',
    ])
    expect(packing.lists[0]?.locations.filter((location) => location.name === 'Side pocket'))
      .toHaveLength(2)

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
  })
})

describe('exportTimestamp', () => {
  it('formats local time as YYYY-MM-DDTHH-MM-SS with zero-padding', () => {
    // Month is 0-indexed: 6 => July. Single-digit parts must pad.
    expect(exportTimestamp(new Date(2026, 6, 9, 4, 5, 3))).toBe('2026-07-09T04-05-03')
  })
})
