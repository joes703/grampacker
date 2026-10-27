import type { ListItemWithGear } from './types'

// The worn rows for the trailing Worn section, in DOCUMENT order, in Pack view
// as much as List.
//
// Walking `grouped` collects worn rows bucket by bucket, so without the sort
// two worn items in different groups would follow their GROUPS. Pack rank is
// not used either: worn rows sit outside the packing tree and cannot be
// dragged, so it is a number the user cannot control. They keep that rank -
// it reserves their slot for when they stop being worn - but this does not
// read it.
export function wornItemsInDocumentOrder(
  grouped: { items: ListItemWithGear[] }[],
): ListItemWithGear[] {
  return grouped
    .flatMap((group) => group.items.filter((item) => item.isWorn))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
