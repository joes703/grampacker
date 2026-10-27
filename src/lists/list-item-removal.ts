import { type QueryClient } from '@tanstack/react-query'
import { queries } from '../lib/queries/options'
import type { PackingLocation } from '../lib/types'

// When does removing gear from a list need to ask first?
//
// The rule turns on WHAT is being removed, not on how much had been typed
// into it. A DIRTY-STATE confirm (ask only when the row carries a quantity, a
// worn or consumable flag, a pack tick) looks random from the outside.
//
//   An ordinary item -> remove it, no dialog. The gear stays in the library,
//     so the row is one tap to re-add.
//   A container      -> ask first. Removing a piece of gear that is being
//     USED AS a packing container also removes that container, and everything
//     inside it moves to Unassigned. That is the intended behavior - a
//     container that is gear cannot outlive the gear - but it is a bigger
//     change than the row you clicked, so it gets named before it happens.
//
// That relationship lives ONLY on the location row: a list item records where
// it sits, never what it contains. So the answer needs the packing-locations
// query, which is why ListDetailPage subscribes to it in both views rather
// than only in Pack - removal is reachable from everywhere.

function findBackedLocation(
  itemId: string,
  locations: PackingLocation[],
): PackingLocation | null {
  return locations.find((location) => location.containerListItemId === itemId) ?? null
}

export type RemovalPlan =
  | { kind: 'remove' }
  | { kind: 'confirm'; location: PackingLocation | null }

// Decide how a removal must proceed. A plain function rather than a hook so
// the rule is testable without mounting the page.
//
// fetchQuery, NOT ensureQueryData. ensureQueryData returns whatever is cached
// the moment it is defined - stale, or left over from a failed refetch - and
// its revalidateIfStale option only starts a background prefetch while still
// handing back the old value. A tab holding a stale result would keep
// answering "not a container" after another device promoted a row to one, and
// the dialog would never appear. fetchQuery honors staleTime: a fresh cache
// returns with no request, so the everyday removal stays instant; stale or
// absent fetches; a failure throws rather than silently resolving.
//
// `location: null` is the fail-safe: the lookup failed, so we cannot say
// whether this row is a container. Asking without naming one is better than
// assuming the answer that skips the dialog.
export async function resolveRemovalPlan(
  qc: QueryClient,
  listId: string,
  itemId: string,
): Promise<RemovalPlan> {
  let locations: PackingLocation[]
  try {
    locations = await qc.fetchQuery(queries.packingLocations(listId))
  } catch {
    return { kind: 'confirm', location: null }
  }
  const backedLocation = findBackedLocation(itemId, locations)
  return backedLocation
    ? { kind: 'confirm', location: backedLocation }
    : { kind: 'remove' }
}
