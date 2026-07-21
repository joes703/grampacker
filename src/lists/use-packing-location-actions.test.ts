import { describe, expect, it } from 'vitest'
import type { PackingLocation } from '../lib/types'
import { promotedContainerSortOrder } from './use-packing-location-actions'

function location(sortOrder: number): PackingLocation {
  return {
    id: `loc-${sortOrder}`,
    name: `Location ${sortOrder}`,
    sortOrder,
    containerListItemId: null,
  }
}

describe('promotedContainerSortOrder', () => {
  it('starts an empty list at zero', () => {
    expect(promotedContainerSortOrder([])).toBe(0)
  })

  it('places a newly promoted container before every existing location', () => {
    expect(promotedContainerSortOrder([
      location(4),
      location(-2),
      location(1),
    ])).toBe(-3)
  })
})
