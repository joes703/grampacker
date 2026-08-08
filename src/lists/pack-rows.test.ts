import { describe, expect, it } from 'vitest'
import type { FoodItemResponse } from '../../shared/food'
import type { ListItemWithGear } from '../lib/types'
import {
  assignUnionPackRankSlots,
  comparePackRows,
  nextUnionPackRankFor,
  packRowName,
  unionPackRows,
  type PackRow,
} from './pack-rows'

function gear(id: string, rank: number, locationId: string | null = null): ListItemWithGear {
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
    packSortOrder: rank,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      name: `Gear ${id}`,
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

function food(id: string, rank: number, locationId: string | null = null): FoodItemResponse {
  return {
    id,
    name: `Food ${id}`,
    weightGrams: 100,
    quantity: 1,
    sortOrder: 0,
    isPacked: false,
    isReady: false,
    packingLocationId: locationId,
    packSortOrder: rank,
    slotIds: [],
  }
}

const ids = (rows: PackRow[]) =>
  rows.map((row) => (row.kind === 'gear' ? row.gear.id : row.food.id))

describe('unionPackRows', () => {
  it('interleaves gear and food by rank', () => {
    const rows = unionPackRows([gear('a', 0), gear('c', 4)], [food('b', 2)])
    expect(ids(rows)).toEqual(['a', 'b', 'c'])
  })

  it('breaks a cross-table rank tie gear-first, then by id', () => {
    // Per-table unique indexes cannot rule ties out ACROSS tables (0022's
    // backfill even guarantees them on day one), so display order must be
    // deterministic: rank, then gear before food, then id.
    const rows = unionPackRows([gear('g', 0)], [food('f', 0)])
    expect(ids(rows)).toEqual(['g', 'f'])
    expect(comparePackRows(rows[0]!, rows[1]!)).toBeLessThan(0)
  })
})

describe('assignUnionPackRankSlots', () => {
  it('permutes existing ranks across the union and splits the payload halves', () => {
    // Move the food row to the front: it takes the gear row's rank 0.
    // Display order is [a(0), x(3), b(5)]; reorder to [x, a, b].
    const rows = unionPackRows([gear('a', 0), gear('b', 5)], [food('x', 3)])
    const updates = assignUnionPackRankSlots([rows[1]!, rows[0]!, rows[2]!])
    expect(updates).toEqual({
      items: [
        { id: 'a', packSortOrder: 3 },
        { id: 'b', packSortOrder: 5 },
      ],
      foodItems: [{ id: 'x', packSortOrder: 0 }],
    })
  })
})

describe('assignUnionPackRankSlots with a cross-table tie', () => {
  it('densifies instead of permuting, avoiding reserved ranks', () => {
    // gear and food tied at 0 (degraded-interval signature), plus a worn row
    // parked at rank 1 that is NOT in the array and must keep its slot.
    const rows = unionPackRows([gear('g', 0)], [food('f', 0)])
    const updates = assignUnionPackRankSlots(rows, new Set([1]))
    // Dense slots skipping the reserved 1: 0 and 2. The tie is healed.
    expect(updates).toEqual({
      items: [{ id: 'g', packSortOrder: 0 }],
      foodItems: [{ id: 'f', packSortOrder: 2 }],
    })
  })

  it('still permutes exactly when no tie exists', () => {
    const rows = unionPackRows([gear('a', 3)], [food('x', 9)])
    const updates = assignUnionPackRankSlots([rows[1]!, rows[0]!])
    expect(updates).toEqual({
      items: [{ id: 'a', packSortOrder: 9 }],
      foodItems: [{ id: 'x', packSortOrder: 3 }],
    })
  })
})

describe('nextUnionPackRankFor', () => {
  it('is one past the union maximum of the destination cohort', () => {
    const gearRows = [gear('a', 2, 'bag'), gear('b', 9, null)]
    const foodRows = [food('x', 7, 'bag'), food('y', 1, null)]
    // The bag's max is the FOOD row's 7, not gear's 2.
    expect(nextUnionPackRankFor(gearRows, foodRows, 'bag')).toBe(8)
    // Unassigned's max is the GEAR row's 9.
    expect(nextUnionPackRankFor(gearRows, foodRows, null)).toBe(10)
    // An empty cohort starts at 0.
    expect(nextUnionPackRankFor([], [], 'empty')).toBe(0)
  })
})

describe('packRowName', () => {
  it('reads through either kind', () => {
    expect(packRowName({ kind: 'gear', gear: gear('a', 0) })).toBe('Gear a')
    expect(packRowName({ kind: 'food', food: food('x', 0) })).toBe('Food x')
  })
})
