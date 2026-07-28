import { useCallback } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  addListItem,
  fetchPackingLocations,
  queryKeys,
  updateListItem,
  type ListItemPatch,
} from '../lib/queries'
import { useLatestRef } from '../lib/use-latest-ref'
import { showToast } from '../lib/toast'
import type { ListItemWithGear, PackingLocation } from '../lib/types'

// Removing gear from a list, and putting it back.
//
// The old rule was a DIRTY-STATE confirm: a red dialog appeared only when the
// membership row carried state the user had entered. Defensible on paper,
// unreadable in practice - from the outside, removal confirmed at random. The
// rule now has one question behind it:
//
//   Does this removal destroy anything BEYOND the row itself?
//
//   No  -> remove immediately, offer Undo. This is almost every removal.
//   Yes -> confirm first, because Undo cannot put it back.
//
// Exactly one case answers yes. A list item can BACK a packing location
// ("use as container"), and packing_locations.container_list_item_id is
// ON DELETE CASCADE, so deleting that row deletes the location too - and
// list_items.packing_location_id is ON DELETE SET NULL, so everything inside
// falls out to Unassigned. Rebuilding that graph would take a re-add, a field
// patch, a location create and one patch per orphaned child: four kinds of
// write across up to 300 rows with no shared transaction. A partial failure
// would leave a worse mess than the delete did, and AGENTS.md is explicit
// that partial writes are bugs. So that case asks first, and the dialog says
// what it is about to do rather than warning in the abstract.
//
// What Undo restores: the membership row and every field the user set on it
// (quantity, worn/consumable, packed/ready, packing location). What it does
// NOT restore is sortOrder - the server assigns one on create, so the row
// returns at the end of its section. That is the same trade the old confirm
// made (it asked, but could not have preserved the position either); it is
// called out here because it is the one visible seam.

export type ListItemRemoval = {
  gearItemId: string
  name: string
  /** Fields worth restoring, or null when the row was pristine. */
  patch: ListItemPatch | null
}

// Does this row carry state a removal would silently discard?
//
// Once the gate for the confirm dialog, now the gate for Undo's restore
// PATCH: a pristine row needs only the re-add, so we skip a second request
// that would write nothing. Every field stays pinned individually in the
// tests - add a field to the membership row without adding it here and Undo
// starts dropping it on the floor.
//
// sortOrder is excluded deliberately; see the note above.
export function hasListItemEdits(item: ListItemWithGear): boolean {
  return (
    item.quantity !== 1 ||
    item.isWorn ||
    item.isConsumable ||
    item.isPacked ||
    item.isReady ||
    item.packingLocationId !== null
  )
}

// The snapshot Undo replays. Taken BEFORE the delete, because afterwards the
// row is gone from the cache and the server both.
export function snapshotListItem(item: ListItemWithGear): ListItemRemoval {
  return {
    gearItemId: item.gearItemId,
    name: item.gearItem.name,
    patch: hasListItemEdits(item)
      ? {
          quantity: item.quantity,
          isWorn: item.isWorn,
          isConsumable: item.isConsumable,
          isPacked: item.isPacked,
          isReady: item.isReady,
          packingLocationId: item.packingLocationId,
        }
      : null,
  }
}

// Is this row the backing item of a packing location? That relationship lives
// ONLY on the location row - a list item records where it sits, never what it
// contains - so it can only be answered from the locations query. Which is
// why ListDetailPage keeps that query enabled in edit mode too, not just in
// pack mode: removal is reachable from every view.
export function findBackedLocation(
  itemId: string,
  locations: PackingLocation[],
): PackingLocation | null {
  return locations.find((location) => location.containerListItemId === itemId) ?? null
}

// Decide how a removal must proceed. Exported and pure-ish (its only side
// effect is the fetch) so the rule can be tested without mounting the page.
//
// fetchQuery, NOT ensureQueryData. ensureQueryData returns whatever is cached
// the moment it is defined - stale, or left over from a failed refetch - and
// its revalidateIfStale option only starts a background prefetch while still
// handing back the old value. A tab holding a stale empty result would keep
// answering "not a container" after another device promoted the row to one,
// and cascade it away unwarned. fetchQuery honors staleTime: fresh cache
// returns with no request (so the everyday path stays instant), stale or
// absent fetches, and a failure throws rather than silently resolving.
//
// Throwing is meaningful here: if we cannot establish the answer we must not
// assume the safe-looking one, so the caller turns a rejection into a confirm.
export type RemovalPlan =
  | { kind: 'undo' }
  | { kind: 'confirm'; location: PackingLocation | null }

export async function resolveRemovalPlan(
  qc: QueryClient,
  listId: string,
  itemId: string,
): Promise<RemovalPlan> {
  let locations: PackingLocation[]
  try {
    locations = await qc.fetchQuery({
      queryKey: queryKeys.packingLocations(listId),
      queryFn: () => fetchPackingLocations(listId),
    })
  } catch {
    // Could not prove the row is safe to remove silently, so ask - without
    // claiming a container we never saw.
    return { kind: 'confirm', location: null }
  }
  const backedLocation = findBackedLocation(itemId, locations)
  return backedLocation
    ? { kind: 'confirm', location: backedLocation }
    : { kind: 'undo' }
}

// `removeItem` is the page's delete mutation, passed as a plain callback so
// this hook does not have to restate TanStack's generics. It is read through
// a ref, so the caller need not memoize it.
export function useListItemRemoval(
  listId: string,
  removeItem: (itemId: string, onRemoved: () => void) => void,
) {
  const qc = useQueryClient()
  const removeItemRef = useLatestRef(removeItem)

  // Restores through a real mutation, never the raw request helpers: those
  // are plain fetch wrappers with no cache behavior at all, so a successful
  // Undo would leave the row absent from ['list-items'] until something else
  // happened to refetch it.
  //
  // NOT optimistic. There is no row to patch back into place until the server
  // mints one, and the id it returns is new, so a placeholder would have to
  // be reconciled against it. Undo is deliberate and low-frequency; a
  // round-trip is the honest cost.
  //
  // Both cache keys are invalidated. ['list-items'] is obvious. Packing
  // locations matter because a restored row can carry a packingLocationId,
  // and because the delete that preceded it may itself have cascaded a
  // location away - the pre-existing hole this closes.
  const undoRemoval = useMutation({
    mutationFn: async ({ gearItemId, patch }: ListItemRemoval) => {
      // Ordered: the row must exist before its fields can be patched onto it.
      const restored = await addListItem(listId, gearItemId)
      if (!patch) return { fieldsRestored: true }
      try {
        await updateListItem(listId, restored.id, patch)
        return { fieldsRestored: true }
      } catch {
        // The row IS back, just pristine. That is a different outcome from
        // "Undo failed" and gets different wording - reporting it as a
        // failure would send the user looking for a row that is on screen.
        return { fieldsRestored: false }
      }
    },
    // Feedback lives on the MUTATION, not on per-call mutate callbacks.
    //
    // An Undo toast outlives the page that created it: switching lists
    // unmounts this hook (ListDetailPage is keyed by list id), and TanStack
    // does not run per-call `mutate` callbacks once the calling observer has
    // unsubscribed - only the mutation's own do. Putting the toasts here is
    // what keeps a restore that lands after navigation from failing silently.
    // The toast store is module-level, so showing one from an unmounted
    // hook's callback is fine.
    onSuccess: ({ fieldsRestored }, removal) => {
      if (!fieldsRestored) {
        // The row IS back, just pristine. Different outcome, different
        // wording - reporting it as a failure would send the user looking
        // for a row that is on screen.
        showToast(
          `"${removal.name}" is back, but its quantity and flags couldn't be restored.`,
          { type: 'error' },
        )
      }
    },
    onError: (_error, removal) => {
      // Every reason this fails is real and outside our control: the gear was
      // deleted from inventory in the meantime, or another client refilled
      // the 300-item cap. Say so and CONSUME the rejection - useMutation
      // absorbs it, so nothing escapes as an unhandled promise.
      showToast(`Couldn't put "${removal.name}" back. Try adding it again.`, {
        type: 'error',
      })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
      void qc.invalidateQueries({ queryKey: queryKeys.packingLocations(listId) })
    },
  })

  // No in-flight guard, deliberately. There used to be one shared boolean
  // here, and it was wrong in both directions: the toast already dismisses
  // itself BEFORE invoking its action (Toast.tsx), so the same Undo cannot
  // fire twice, while a hook-wide flag meant undoing one removal silently
  // discarded the Undo click on a DIFFERENT removal whose request overlapped
  // it. Remove two items, undo both quickly, and the second one stayed
  // deleted. Independent removals are independent restores.
  const requestUndo = useCallback((removal: ListItemRemoval) => {
    undoRemoval.mutate(removal)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- undoRemoval is a TanStack mutation result; .mutate is stable, the wrapper is not
  }, [])

  // The ordinary path: delete now, offer Undo once the server has confirmed.
  // The toast waits for success on purpose - offering to undo a removal that
  // did not happen would be a lie, and the optimistic row has already snapped
  // back by then.
  const removeWithUndo = useCallback((item: ListItemWithGear) => {
    const removal = snapshotListItem(item)
    removeItemRef.current(item.id, () => {
      showToast(`Removed "${removal.name}"`, {
        action: { label: 'Undo', onAction: () => requestUndo(removal) },
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- removeItemRef is a ref (always stable); requestUndo is stable
  }, [])

  return { removeWithUndo }
}
