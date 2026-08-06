// Three views of a list. Organize used to be a peer view where you
// built packing locations and dragged gear into them, while Pack was where you
// checked things off - so arranging and packing meant switching views for
// every correction. Pack absorbed Organize: it is the location-organized
// checklist, and you rearrange in place.
//
// The old /organize URLs still resolve (bookmarks, home-screen shortcuts, a
// stored last-list path) - they derive to 'pack' here and ListDetailPage
// rewrites the address bar, so the merge is invisible to anyone returning to
// an old link.
//
// Food joined as a peer view 2026-08: food planning got its own surface to
// track dietary needs, preferences, restrictions, and meal planning separate
// from gear. See docs/food-view-design.md.
export type ListDetailMode = 'edit' | 'pack' | 'food'

const LIST_VIEW_LABELS: Record<ListDetailMode, string> = {
  edit: 'List',
  pack: 'Pack',
  food: 'Food',
}

/** The retired Organize URLs, in both shapes that ever shipped. */
export function isLegacyOrganizePath(pathname: string, listId: string): boolean {
  const base = `/lists/${listId}`
  return pathname === `${base}/organize` || pathname === `${base}/pack/organize`
}

export function deriveListMode(
  pathname: string,
  search: string,
  listId: string,
): ListDetailMode {
  const base = `/lists/${listId}`
  // Organize resolves to Pack rather than to a dead route: the view it named
  // is now part of Pack, so that is where an old link should land.
  if (isLegacyOrganizePath(pathname, listId)) return 'pack'
  if (pathname === `${base}/food`) return 'food'
  const legacyPackMode =
    pathname === base && new URLSearchParams(search).get('mode') === 'pack'
  if (pathname === `${base}/pack` || legacyPackMode) return 'pack'
  return 'edit'
}

export function persistedListPath(listId: string, mode: ListDetailMode): string {
  const base = `/lists/${listId}`
  if (mode === 'pack') return `${base}/pack`
  if (mode === 'food') return `${base}/food`
  return base
}

export function listDocumentTitle(name: string, mode: ListDetailMode): string {
  return `${name} - ${LIST_VIEW_LABELS[mode]}`
}
