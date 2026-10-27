import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { authClient } from '../lib/auth-client'
import { queries } from '../lib/queries/options'
import { readLastListPath } from '../lib/last-list-path'
import type { List } from '../lib/types'
import AppLoading from '../components/AppLoading'

// Authenticated landing for `/`. There is no home page: pick the most-
// recently-touched list and redirect there. Transplanted from the old
// app (src/layout/RootRedirect.tsx); the last-list-path helper and its
// write/self-heal sites were ported ahead of this, so both paths below
// have warm inputs.
//
// Fast path: if localStorage has a cached last-visited list path, redirect
// to it immediately without waiting for fetchLists. The path includes
// `/pack` or `/food` when the user was last in that mode, so a cold start
// lands them back in the same workspace. Server-side misses (deleted list,
// or a stale value from the old app under the same domain) hit the
// destination page's not-found branch, which clears the cache when the
// failing route matches the cached id - so a poisoned cache self-heals on
// the next visit. readLastListPath already rejects anything that isn't a
// strict `/lists/<uuid>` with an optional exact mode segment.
//
// Slow path: no cached path (first login, cleared storage, or a stored
// value that failed strict validation). Fall back to fetchLists +
// max-by-updatedAt.
//
// Empty/error path: zero lists (a brand-new verified account) OR a failed
// fetch. Either way there is no list to land on, so fall through to
// /lists, which owns the lists query and its own loading/empty/error UI.
// Crucially we only hold on the loading surface while the fetch is GENUINELY
// in flight (isLoading) - doing so on error too would strand `/` with no way
// forward.
//
// Owner-scoped: the cached path is only followed when the CURRENT session owns
// it (readLastListPath gates on the stored owner id). A pointer left by a
// different account - a magic-link switch, or a browser whose prior cookie
// lapsed before the next person signed in - is treated as a miss, so B is never
// routed into A's list URL. This runs inside RequireSession, so a session is
// present; useSession is read here only to supply the owner id.
//
// Hooks-order note: the cached-path check is read at render top, but
// useQuery is called unconditionally with `enabled: !cachedPath` so the
// hook order stays stable across renders (returning before useQuery would
// flip the hook count).
export default function RootRedirect() {
  const { data: session } = authClient.useSession()
  const cachedPath = readLastListPath(session?.user.id)

  const { data: lists, isLoading } = useQuery({
    ...queries.lists(),
    enabled: !cachedPath,
  })

  if (cachedPath) return <Navigate to={cachedPath} replace />

  // Hold the render only while the fetch is in flight. On error the query
  // settles with isLoading=false and lists=undefined, so we fall through
  // to the /lists redirect below rather than rendering a blank page.
  if (isLoading) return <AppLoading label="Loading your lists..." />

  // fetchLists orders by sortOrder then name; pick the most-recently-
  // touched list by max-by-updatedAt. localeCompare on the ISO-8601
  // timestamps is lexicographic-equivalent to chronological. Single-pass
  // reduce avoids the spread+sort allocation; intent reads as "find max"
  // rather than "sort everything and take first." `lists` is undefined on
  // a failed fetch, so optional-chain to null and let /lists surface it.
  const mostRecent =
    lists?.reduce<List | null>(
      (best, l) => (best === null || l.updatedAt.localeCompare(best.updatedAt) > 0 ? l : best),
      null,
    ) ?? null
  if (!mostRecent) return <Navigate to="/lists" replace />
  return <Navigate to={`/lists/${mostRecent.id}`} replace />
}
