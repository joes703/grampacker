// Three views of a list. Organize used to be a peer view where you
// built packing locations and dragged gear into them, while Pack was where you
// checked things off - so arranging and packing meant switching views for
// every correction. Pack absorbed Organize: it is the location-organized
// checklist, and you rearrange in place.
//
// The old /organize URLs still resolve (bookmarks, home-screen shortcuts) -
// they derive to 'pack' here and ListDetailPage rewrites the address bar, so
// the merge is invisible to anyone returning to an old link. A stored
// last-list path is never one of them: its validator accepts only the bare,
// /pack and /food shapes (src/lib/last-list-path.ts).
//
// Food joined as a peer view 2026-08. It is a WEIGHT ESTIMATE with a schedule
// attached - what you carry, and which meals you eat it at - not a meal
// planner. There are no dietary needs, preferences or restrictions here, and
// an earlier version of this comment claimed all three; none of them has ever
// existed in this build.
export type ListDetailMode = 'edit' | 'pack' | 'food'

// The human-facing names. NOTE: ListViewNav holds its own VIEWS array with
// the same strings - changing one and not the other leaves the tab and the
// document title disagreeing.
//
// 'edit' is called Category because the label should say how the rows are
// ARRANGED, which is the only thing that changes between it and Pack. The
// mode key and the URL both stay 'edit'/'/lists/:id' so no bookmark, stored
// last-list path or legacy /organize redirect has to move.
const LIST_VIEW_LABELS: Record<ListDetailMode, string> = {
  edit: 'Category',
  pack: 'Pack',
  food: 'Food',
}

// React Router matches routes case-insensitively and tolerates trailing
// slashes, so any URL the router resolves to this page must be recognized in
// the same spelling-tolerant way by EVERY predicate below - /lists/<id>/FOOD
// landing on 'edit' would render the List view under a food URL, and
// /lists/<id>/organize/ recognized as Pack but not as legacy would render
// Pack while leaving the retired address in place (which is what happened
// while ListDetailPage kept its own exact-match copy of these checks).
// Percent-encoded spellings of the static segments are outside this: the
// router decodes them, these comparisons do not.
function normalizeListPath(pathname: string): string {
  return pathname.replace(/\/+$/, '').toLowerCase()
}

/** The retired Organize URLs, in both shapes that ever shipped. */
export function isLegacyOrganizePath(pathname: string, listId: string): boolean {
  const base = `/lists/${listId.toLowerCase()}`
  const normalized = normalizeListPath(pathname)
  return normalized === `${base}/organize` || normalized === `${base}/pack/organize`
}

/**
 * The retired URL spellings this page still honors. ListDetailPage rewrites
 * any of them to /pack, and deriveListMode answers 'pack' for all of them -
 * one predicate for both, so the address bar and the rendered view cannot
 * disagree again. The converse does not hold: the canonical /pack derives to
 * Pack and is not legacy.
 */
export function isLegacyListPath(pathname: string, listId: string): boolean {
  return isLegacyOrganizePath(pathname, listId)
}

export function deriveListMode(pathname: string, listId: string): ListDetailMode {
  // Organize resolves to Pack rather than to a dead route: the view it named
  // is now part of Pack, so that is where an old link should land.
  if (isLegacyListPath(pathname, listId)) return 'pack'
  const base = `/lists/${listId.toLowerCase()}`
  const normalized = normalizeListPath(pathname)
  if (normalized === `${base}/food`) return 'food'
  if (normalized === `${base}/pack`) return 'pack'
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
