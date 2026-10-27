// Which rows belong to an ORDINARY section of a list - a category, or a
// packing location - as opposed to the trailing Worn section.
//
// One rule, one place, now MODE-SCOPED. In the Category arrangement and the
// public share, worn rows stay inside their category: worn is a weight flag,
// not an organizing principle, and flipping it must not move the row (UX
// audit 2026-10). In PACK mode worn gear is a genuinely separate pile - you
// lay it out to wear, you do not pack it - so pack still extracts it into
// the trailing Worn section.
//
// Renderer (PackSection) and reorder planner MUST agree on this per mode.
// They once disagreed - the planner kept worn rows in List view on a false
// belief about what the section showed - and an ordinary drag silently
// rewrote worn rows' document ranks (audit F1). Both ask here, with their
// mode, so they cannot drift apart again.
//
// Deliberately narrow: row-visibility rules shared by renderer and planner
// only. Category matching and container rows are separate rules with their
// own owners.
export function isOrdinarySectionRow(
  item: { isWorn: boolean },
  packMode: boolean,
): boolean {
  return packMode ? !item.isWorn : true
}

// Pack-mode visibility: the AND of the two row filters, for gear and food
// alike. The same both-or-neither rule as worn membership above: a row a
// filter hides must be neither rendered (PackSection) nor a reorder source
// or neighbor (the planners compute sort slots from the rows the user can
// actually see, so counting an invisible row would drop the dragged row
// somewhere other than where it was released). Three call sites used to each
// spell this expression out, with a comment asking to keep them in step.
export function passesPackFilters(
  row: { isPacked: boolean; isReady: boolean },
  {
    showUnpackedOnly,
    showUnreadyOnly,
  }: { showUnpackedOnly: boolean; showUnreadyOnly: boolean },
): boolean {
  return (!showUnpackedOnly || !row.isPacked) && (!showUnreadyOnly || !row.isReady)
}
