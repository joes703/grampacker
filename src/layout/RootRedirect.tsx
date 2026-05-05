import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { queryKeys, fetchLists } from '../lib/queries'
import { readLastListId } from '../lib/last-list-id'

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
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const cachedId = readLastListId()

  const { data: lists, isLoading } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
    enabled: !cachedId,
  })

  if (cachedId) return <Navigate to={`/lists/${cachedId}`} replace />

  if (isLoading || !lists) return null

  // fetchLists orders by sort_order then name; resort here by updated_at
  // descending so the most-recently-touched list wins. localeCompare on
  // the ISO-8601 timestamps is lexicographic-equivalent to chronological.
  const [mostRecent] = [...lists].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  if (!mostRecent) return <Navigate to="/lists" replace />
  return <Navigate to={`/lists/${mostRecent.id}`} replace />
}
