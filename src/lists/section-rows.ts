// Which rows belong to an ORDINARY section of a list - a category, or a
// packing location - as opposed to the trailing Worn section.
//
// One rule, one place. Worn gear renders only in the Worn section, in every
// view, and is never part of the sequence a drag rearranges. Two consumers
// used to each spell this out: CategoryGroup (what a section renders) and
// the reorder planner (what a drag permutes over). They disagreed - the
// planner kept worn rows in List view on a false belief about what the
// section showed - and an ordinary drag silently rewrote worn rows' document
// ranks (audit F1). Both now ask here, so they cannot drift apart again.
//
// Deliberately narrow: row-visibility rules shared by renderer and planner
// only. Category matching and container rows are separate rules with their
// own owners.
export function isOrdinarySectionRow(item: { isWorn: boolean }): boolean {
  return !item.isWorn
}

// Pack-mode visibility: the AND of the two row filters, for gear and food
// alike. The same both-or-neither rule as worn membership above: a row a
// filter hides must be neither rendered (CategoryGroup) nor a reorder source
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
