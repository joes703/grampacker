import { describe, expect, it } from 'vitest'
import { buildFoodJson, FOOD_JSON_VERSION } from './food-json'
import type { List } from '../types'
import type { ListFoodResponse } from '../../../shared/food'

const list = (id: string, name: string) =>
  ({
    id,
    name,
    description: null,
    slug: id,
    isShared: false,
    isDraft: true,
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }) satisfies List

describe('buildFoodJson', () => {
  it('serializes a carried item ONCE with its slots as references', () => {
    // The export is the one place a reader could recompute the weight
    // themselves. Repeating a shared bag per slot would tell them 2500 g.
    const food: ListFoodResponse = {
      dayCount: 5,
      slots: [1, 2, 3, 4, 5].map((d) => ({
        id: `l${d}`,
        dayNumber: d,
        meal: 'lunch' as const,
      })),
      items: [
        {
          id: 'i1',
          name: 'Trail mix',
          weightGrams: 500,
          quantity: 1, isPerMeal: false, unitCount: 1,
          sortOrder: 0,
          isPacked: false,
          isReady: false,
          packingLocationId: null,
          packSortOrder: 0,
          slotIds: ['l1', 'l2', 'l3', 'l4', 'l5'],
        },
      ],
    }
    const json = buildFoodJson({
      lists: [list('a', 'Trip')],
      foodByListId: new Map([['a', food]]),
    })

    expect(json.version).toBe(FOOD_JSON_VERSION)
    expect(json.lists).toHaveLength(1)
    expect(json.lists[0]!.items).toHaveLength(1)
    expect(json.lists[0]!.items[0]!.slotIds).toHaveLength(5)
    const total = json.lists[0]!.items.reduce(
      (g, i) => g + i.weightGrams * i.unitCount,
      0,
    )
    expect(total).toBe(500)
  })

  it('exports per-meal authored quantity and carried units without duplicating the item', () => {
    const json = buildFoodJson({
      lists: [list('a', 'Trip')],
      foodByListId: new Map([['a', {
        dayCount: 3,
        slots: [1, 2, 3].map((dayNumber) => ({ id: `s${dayNumber}`, dayNumber, meal: 'dinner' as const })),
        items: [{
          id: 'ramen', name: 'Ramen', weightGrams: 85,
          quantity: 2, isPerMeal: true, unitCount: 6, sortOrder: 0,
          isPacked: false, isReady: false, packingLocationId: null, packSortOrder: 0,
          slotIds: ['s1', 's2', 's3'],
        }],
      }]]),
    })
    expect(json.lists[0]?.items).toEqual([{
      id: 'ramen', name: 'Ramen', weightGrams: 85,
      quantity: 2, isPerMeal: true, unitCount: 6,
      slotIds: ['s1', 's2', 's3'],
    }])
  })

  it('carries no plan-completeness flag on a slot', () => {
    // v3 dropped `needed`. The Skip feature it belonged to is gone, so there is
    // no distinction left to export: an unscheduled meal is simply a meal with
    // no items pointing at it.
    const json = buildFoodJson({
      lists: [list('a', 'Trip')],
      foodByListId: new Map([
        [
          'a',
          {
            dayCount: 1,
            slots: [{ id: 's1', dayNumber: 1, meal: 'breakfast' as const }],
            items: [],
          },
        ],
      ]),
    })
    expect(Object.keys(json.lists[0]!.slots[0]!).sort()).toEqual([
      'dayNumber',
      'id',
      'meal',
    ])
  })

  it('omits lists with no food at all', () => {
    const json = buildFoodJson({
      lists: [list('a', 'Empty')],
      foodByListId: new Map([['a', { dayCount: 0, slots: [], items: [] }]]),
    })
    expect(json.lists).toHaveLength(0)
  })
})
