import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { queryKeys, fetchLists } from '../lib/queries'

// Authenticated landing for `/`. Picks the most-recently-updated list and
// redirects there. New users with zero lists fall through to /lists, which
// already renders ListsEmptyState. Reuses the shared fetchLists cache so
// this redirect doesn't duplicate query state — the destination page reads
// the same key.
export default function RootRedirect() {
  const { session } = useAuth()
  // PrivateRoute keeps session non-null in the steady state; '' fallback is
  // for the brief in-flight signout window. The owner-scoped fetchLists
  // returns empty for an empty user_id rather than the unfiltered union.
  const userId = session?.user.id ?? ''

  const { data: lists, isLoading } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
  })

  if (isLoading || !lists) return null

  // fetchLists orders by sort_order then name; resort here by updated_at
  // descending so the most-recently-touched list wins. localeCompare on the
  // ISO-8601 timestamps is lexicographic-equivalent to chronological. Empty
  // lists falls through to /lists, which already renders ListsEmptyState.
  const [mostRecent] = [...lists].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  if (!mostRecent) return <Navigate to="/lists" replace />
  return <Navigate to={`/lists/${mostRecent.id}`} replace />
}
