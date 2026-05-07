import { useState } from 'react'
import type { CategoryGroup } from './grouping'
import type { ListItemWithGear } from './types'

/**
 * Flatten worn items across grouped categories with structural stability.
 *
 * Why this exists: when list.group_worn is enabled, the trailing Worn section
 * renders a CategoryGroup keyed on a worn-items array. The naive shape
 * (`useMemo(() => grouped.flatMap(g => g.items.filter(i => i.is_worn)),
 * [grouped, enabled])`) mints a fresh array on every list-items mutation
 * — even pack-mode is_packed toggles that don't change worn membership —
 * which defeats React.memo on the Worn CategoryGroup.
 *
 * Phase 5 stability layer: groupListItemsByCategory now reuses item
 * REFERENCES across mutations whose render-affecting fields are unchanged,
 * so we can compare the new flattened array against the cached one with
 * referential equality at each index. When references match, return the
 * cached array.
 *
 * setState-during-render is the same pattern used by useGroupedListItems —
 * guarded by the early return when `next` is structurally equal to cache.
 */
export function useStableWornItems(
  grouped: CategoryGroup<ListItemWithGear>[],
  enabled: boolean,
): ListItemWithGear[] {
  const [cached, setCached] = useState<ListItemWithGear[]>([])

  if (!enabled) {
    if (cached.length === 0) return cached
    const empty: ListItemWithGear[] = []
    setCached(empty)
    return empty
  }

  const next: ListItemWithGear[] = []
  for (const g of grouped) {
    for (const item of g.items) {
      if (item.is_worn) next.push(item)
    }
  }

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
