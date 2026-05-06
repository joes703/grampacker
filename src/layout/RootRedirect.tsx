import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useRequireSession } from '../auth/use-require-session'
import { queryKeys, fetchLists } from '../lib/queries'
import { readLastListId } from '../lib/last-list-id'
import type { List } from '../lib/types'

// Authenticated landing for `/`. Picks the most-recently-touched list and
// redirects there.
//
// Fast path (M4): if localStorage has a cached last-visited list_id,
// redirect to it immediately without waiting for fetchLists. The
// destination page's queries start in parallel with what would have
// been the fetchLists round-trip on the cold path. Server-side misses
// (deleted list, different user under a stale cache) hit the
// destination's existing not-found branch, which clears the cache when
// the failing route matches the cached id — so a poisoned cache
// self-heals on the next visit.
//
// Slow path: no cached id (first login, cleared storage). Fall back to
// fetchLists + sort-by-updated_at, identical to prior behavior.
//
// Empty path: zero lists. Falls through to /lists which renders
// ListsEmptyState.
//
// Hooks-order note: the cached-id check is read at render top, but
// `useQuery` is called unconditionally with `enabled: !cachedId` so the
// hook order stays consistent under React's rules-of-hooks. Returning
// before useQuery would have flipped hook count between renders.
export default function RootRedirect() {
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''

  const cachedId = readLastListId()

  const { data: lists, isLoading } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
    enabled: !cachedId,
  })

  if (cachedId) return <Navigate to={`/lists/${cachedId}`} replace />

  if (isLoading || !lists) return null

  // fetchLists orders by sort_order then name; pick the most-recently-
  // touched list by max-by-updated_at. localeCompare on the ISO-8601
  // timestamps is lexicographic-equivalent to chronological.
  // Single-pass reduce avoids the spread+sort allocation; intent reads
  // as "find max" rather than "sort everything and take first."
  const mostRecent = lists.reduce<List | null>(
    (best, l) => (best === null || l.updated_at.localeCompare(best.updated_at) > 0 ? l : best),
    null,
  )
  if (!mostRecent) return <Navigate to="/lists" replace />
  return <Navigate to={`/lists/${mostRecent.id}`} replace />
}
