// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { PackingLocation } from '../lib/types'
import { clearToasts, renderHookWithClient, shownToasts, testQueryClient } from '../test/mutation-hook-harness'

const h = vi.hoisted(() => ({
  deletePackingLocation: vi.fn<(listId: string, id: string) => Promise<void>>(),
}))

vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  ...h,
}))

import { promotedContainerSortOrder, usePackingLocationActions } from './use-packing-location-actions'

afterEach(() => {
  clearToasts()
  vi.clearAllMocks()
})

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

describe('removeLocation', () => {
  // The confirm has closed and the rollback moves rows back out of Unassigned,
  // so a failure is easy to miss: it gets exactly one toast.
  it('restores the location and shows one toast when the delete fails', async () => {
    h.deletePackingLocation.mockRejectedValueOnce(new Error('boom'))
    const bag = location(0)
    const qc = testQueryClient()
    qc.setQueryData<PackingLocation[]>(['packing-locations', 'list-1'], [bag])
    const result = renderHookWithClient(qc, () => usePackingLocationActions('list-1', [bag]))

    result.current.removeLocation.mutate(bag.id)
    await waitFor(() => expect(result.current.removeLocation.isError).toBe(true))

    expect(qc.getQueryData(['packing-locations', 'list-1'])).toEqual([bag])
    expect(shownToasts()).toEqual([
      {
        message: "Couldn't confirm that packing location was deleted. Refresh to check before trying again.",
        type: 'error',
      },
    ])
  })
})
