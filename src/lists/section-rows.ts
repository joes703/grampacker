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
// Deliberately narrow: this is worn membership only. Pack-mode filters,
// category matching and container rows are separate rules with their own
// owners.
export function isOrdinarySectionRow(item: { isWorn: boolean }): boolean {
  return !item.isWorn
}
