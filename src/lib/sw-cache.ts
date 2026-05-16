// Runtime-cache plumbing for the Workbox service worker. The SW is
// configured in `vite.config.ts` to runtime-cache successful GETs against
// `/rest/v1/*` (PostgREST reads) under the cache named here. That cache is
// URL-keyed, not auth-keyed, so a multi-account device could otherwise
// serve user A's stale JSON to user B for up to the cache TTL while the
// revalidate fetches user B's response. RLS still gates anything the
// server returns, but the cached payload is whatever the server returned
// at the previous user's request time.
//
// Mitigation: AuthProvider calls `clearSupabaseRestCache()` whenever the
// active user changes (sign-out or different user signs in within the
// same tab). The precache (app shell) is a different cache name and is
// not touched here; offline pack mode lives in localStorage and is not
// touched either. See vite.config.ts (cacheName 'supabase-rest') and
// SECURITY.md "Accepted residual risks" for the surrounding model.

export const SUPABASE_REST_CACHE_NAME = 'supabase-rest'

export async function clearSupabaseRestCache(): Promise<void> {
  // `caches` is a window/global API on browsers that support service
  // workers. In SSR contexts (none in this codebase today) or in test
  // setups without the API, no-op silently — the cache can't exist if
  // the API isn't there.
  if (typeof caches === 'undefined') return
  try {
    await caches.delete(SUPABASE_REST_CACHE_NAME)
  } catch {
    // Cache Storage API can reject with SecurityError in private-mode
    // contexts. Failing to clear isn't dangerous on its own (the next
    // network response will overwrite the stale entries), and surfacing
    // an unhandled rejection to a sign-out path would be a worse UX
    // than the residual staleness it might cause.
  }
}
