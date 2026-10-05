import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { PackingLocation } from '../lib/types'

const h = vi.hoisted(() => ({
  queryKeys: { packingLocations: (id: string) => ['packing-locations', id] as const },
  fetchPackingLocations: vi.fn<(listId: string) => Promise<PackingLocation[]>>(),
}))

vi.mock('../lib/queries', () => ({
  queryKeys: h.queryKeys,
  fetchPackingLocations: h.fetchPackingLocations,
}))

import { resolveRemovalPlan } from './list-item-removal'

const LIST_ID = 'list-1'
const container: PackingLocation = {
  id: 'loc-canister',
  name: 'Bear canister',
  sortOrder: 1,
  containerListItemId: 'li-canister',
}
const plainLocation: PackingLocation = {
  id: 'loc-main',
  name: 'Main pack',
  sortOrder: 0,
  containerListItemId: null,
}

function client(staleTime = 0) {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime } } })
}

afterEach(() => {
  vi.clearAllMocks()
})

// Removing gear from a list asks in exactly one case: the gear is being USED
// AS a packing container, so removing it removes that container too and moves
// its contents to Unassigned. That is the intended outcome, but it is a bigger
// change than the row that was clicked, so it is named before it happens.
//
// The predicate underneath is the whole rule, and "sometimes asks" is exactly
// the kind of behavior that rots silently - hence the direction tests below.

describe('resolveRemovalPlan', () => {
  beforeEach(() => {
    h.fetchPackingLocations.mockResolvedValue([plainLocation, container])
  })

  it('removes an ordinary item without asking', async () => {
    await expect(resolveRemovalPlan(client(), LIST_ID, 'li-tarp'))
      .resolves.toEqual({ kind: 'remove' })
  })

  it('asks before removing a container, and names it', async () => {
    // The match is on the location's containerListItemId, never its id:
    // packingLocationId (where an item sits) and containerListItemId (what an
    // item contains) point opposite ways. Confusing them would put the dialog
    // in front of every packed item.
    //
    // Nothing is cached here, the window where rows are on screen and
    // removable before the locations query has loaded. Fetching is what turns
    // "we do not know" into the right answer instead of a silent "no".
    await expect(resolveRemovalPlan(client(), LIST_ID, 'li-canister'))
      .resolves.toEqual({ kind: 'confirm', location: container })
  })

  it('asks rather than assuming when the lookup fails', async () => {
    // If we cannot establish whether this row is a container we must not pick
    // the answer that skips the dialog. It asks WITHOUT naming a container,
    // because we never saw one.
    h.fetchPackingLocations.mockRejectedValue(new Error('offline'))
    await expect(resolveRemovalPlan(client(), LIST_ID, 'li-tarp'))
      .resolves.toEqual({ kind: 'confirm', location: null })
  })

  it('refetches a STALE cached result instead of trusting it', async () => {
    // The reason this fetches at all. ensureQueryData hands back whatever is
    // cached the moment it is defined, so a tab holding a stale result would
    // keep answering "not a container" after another device promoted the row
    // to one - and the dialog would never appear.
    const qc = client()
    qc.setQueryData(['packing-locations', LIST_ID], [])

    await expect(resolveRemovalPlan(qc, LIST_ID, 'li-canister'))
      .resolves.toEqual({ kind: 'confirm', location: container })
    expect(h.fetchPackingLocations).toHaveBeenCalled()
  })

  it('trusts a cached result that is still fresh, with no request', async () => {
    // The other half of the trade: an everyday removal must not pay for a
    // round-trip when the page already holds current data.
    const qc = client(30_000)
    qc.setQueryData(['packing-locations', LIST_ID], [plainLocation])

    await expect(resolveRemovalPlan(qc, LIST_ID, 'li-tarp'))
      .resolves.toEqual({ kind: 'remove' })
    expect(h.fetchPackingLocations).not.toHaveBeenCalled()
  })
})
