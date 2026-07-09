// Pure successor chooser for the delete-current-list flow.
//
// When the user deletes the list they're currently viewing, the optimistic
// delete strips the row from the cache and ListDetailPage falls onto the
// "List not found" terminal state. DesktopListsPanel (and any future
// surface that deletes from inside the workspace) picks a sensible landing
// spot BEFORE issuing the mutation so the user lands somewhere useful.
//
// Resolution rule (deleting the currently open list):
//   1. next visible list in current sort order
//   2. previous visible list in current sort order
//   3. /lists (the no-lists fallback)
//
// Deleting a non-current list returns null so the caller stays put.
//
// TODO: when desktop list management fully replaces the card page, the
// no-lists desktop fallback should become an in-workspace empty state
// (right-rail panel) instead of bouncing to /lists. The /lists card page
// is currently the only surface that renders the "create your first list"
// empty UI, so /lists is the right destination until that lands.
export function pickListAfterDelete<T extends { id: string }>(
  lists: readonly T[],
  deletedId: string,
  currentListId: string,
): string | null {
  if (deletedId !== currentListId) return null
  const idx = lists.findIndex((l) => l.id === deletedId)
  // idx === -1: the deleted row is already absent from the snapshot the
  // caller passed in. Treat the same as "no successor available" so the
  // caller hits the /lists fallback rather than navigating to a stale id.
  const next = idx >= 0 ? lists[idx + 1] : undefined
  const prev = idx > 0 ? lists[idx - 1] : undefined
  const successor = next ?? prev
  if (successor) return `/lists/${successor.id}`
  return '/lists'
}
