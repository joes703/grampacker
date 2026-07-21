import { describe, expect, it } from 'vitest'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { buildOrganizeGroups } from './organize-groups'

const locations: PackingLocation[] = [
  { id: 'loc-main', name: 'Main pack', sortOrder: 0 },
]

function item(id: string, packingLocationId: string | null, isWorn = false): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId,
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

describe('buildOrganizeGroups', () => {
  it('filters worn items before both rendering and location counts', () => {
    const groups = buildOrganizeGroups([
      item('visible', 'loc-main'),
      item('worn', 'loc-main', true),
    ], locations)

    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(['visible'])
  })

  it('always appends Unassigned, even when it is empty', () => {
    const groups = buildOrganizeGroups([item('assigned', 'loc-main')], locations)

    expect(groups.at(-1)?.location).toBeNull()
    expect(groups.at(-1)?.items).toEqual([])
  })

  it('routes an orphaned assignment to Unassigned after optimistic location deletion', () => {
    const groups = buildOrganizeGroups([item('orphan', 'loc-deleted')], locations)

    expect(groups.at(-1)?.items.map((entry) => entry.id)).toEqual(['orphan'])
  })
})
