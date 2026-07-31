// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { groupListItemsByLocation } from './grouping'
import { useStableWornItems } from './use-stable-worn-items'
import type { ListItemWithGear, PackingLocation } from './types'

afterEach(cleanup)

function item(id: string, locationId: string | null, isWorn: boolean): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: locationId,
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

describe('useStableWornItems with location groups', () => {
  const locations: PackingLocation[] = [{
    id: 'loc-1', name: 'Main pack', sortOrder: 0, containerListItemId: null,
  }]
  const wornAssigned = item('worn-assigned', 'loc-1', true)
  const wornUnassigned = item('worn-unassigned', null, true)
  const normal = item('normal', 'loc-1', false)
  const grouped = groupListItemsByLocation([wornAssigned, wornUnassigned, normal], locations)

  it('extracts worn rows when enabled', () => {
    const { result } = renderHook(() => useStableWornItems(grouped, true))
    expect(result.current.map((entry) => entry.id)).toEqual([
      'worn-assigned',
      'worn-unassigned',
    ])
  })

  it('extracts nothing when disabled, leaving rows in their location groups', () => {
    const { result } = renderHook(() => useStableWornItems(grouped, false))
    expect(result.current).toEqual([])
    expect(grouped[0]?.items.map((entry) => entry.id)).toEqual(['worn-assigned', 'normal'])
    expect(grouped.at(-1)?.items.map((entry) => entry.id)).toEqual(['worn-unassigned'])
  })
})
