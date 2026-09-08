import { useState } from 'react'
import type { ListItemWithGear } from './types'

/**
 * Flatten worn items across grouped categories with structural stability.
 *
 * Why this exists: the trailing Worn section renders a CategoryGroup keyed on
 * a worn-items array. The naive shape
 * (`useMemo(() => grouped.flatMap(g => g.items.filter(i => i.isWorn)),
 * [grouped])`) mints a fresh array on every list-items mutation
 * — even pack-mode isPacked toggles that don't change worn membership —
 * which defeats React.memo on the Worn CategoryGroup.
 *
 * Stability layer: groupListItemsByCategory reuses item REFERENCES across
 * mutations whose render-affecting fields are unchanged, so we can compare
 * the new flattened array against the cached one with referential equality
 * at each index. When references match, return the cached array.
 *
 * setState-during-render is the same pattern used by useGroupedListItems —
 * guarded by the early return when `next` is structurally equal to cache.
 */
export function useStableWornItems(
  grouped: { items: ListItemWithGear[] }[],
): ListItemWithGear[] {
  const [cached, setCached] = useState<ListItemWithGear[]>([])

  const next: ListItemWithGear[] = []
  for (const g of grouped) {
    for (const item of g.items) {
      if (item.isWorn) next.push(item)
    }
  }
  // DOCUMENT order, always - in Pack view as much as List.
  //
  // Two reasons. First, walking `grouped` collects worn rows bucket by bucket,
  // so without this the section's order is really the GROUP order with worn
  // rows swept up behind it - two worn items in different categories sort by
  // their categories, not by themselves. Second, worn rows are excluded from
  // the packing tree and cannot be dragged, so ordering them by pack rank
  // would sort them on a number the user has no way to control. They keep that
  // rank - it reserves their slot for when they stop being worn - but it is
  // not what this section reads.
  next.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  if (next.length === cached.length) {
    let same = true
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== cached[i]) {
        same = false
        break
      }
    }
    if (same) return cached
  }

  setCached(next)
  return next
}
