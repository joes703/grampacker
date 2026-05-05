import { useState } from 'react'
import { groupListItemsByCategory, type CategoryGroup } from './grouping'
import type { Category, ListItemWithGear } from './types'

/**
 * Stable wrapper around groupListItemsByCategory that lets the function
 * reuse per-group references (and the top-level array reference) across
 * renders when nothing changed. The top-level identity invariant in
 * groupListItemsByCategory is load-bearing here — when no group changed,
 * `next === cached`, the setState call below is skipped, and we avoid the
 * setState-during-render → re-render → setState-during-render infinite
 * loop that would otherwise fire.
 *
 * Why setState-during-render and not useRef + render-time write: React 19's
 * react-hooks/refs rule rejects synchronous ref writes during render
 * (Phase 4 follow-up fixed exactly this in ListDetailPage). Storing
 * information from previous renders via setState during render IS
 * explicitly allowed by React when guarded against loops — see
 * https://react.dev/reference/react/useState#storing-information-from-previous-renders
 */
export function useGroupedListItems(
  items: ListItemWithGear[],
  categories: Category[],
): CategoryGroup<ListItemWithGear>[] {
  const [cached, setCached] = useState<CategoryGroup<ListItemWithGear>[]>(() =>
    groupListItemsByCategory(items, categories),
  )
  const next = groupListItemsByCategory(items, categories, cached)
  if (next !== cached) {
    setCached(next)
  }
  return next
}
