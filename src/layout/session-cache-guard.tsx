import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { authClient } from '../lib/auth-client'
import { clearLastListPath } from '../lib/last-list-path'

// Makes one invariant true in one place: the app may not render one account's
// data to another. Wraps the whole app at the root (App.tsx), so it observes
// every session transition regardless of which route is showing AND sits
// between the session and the mounted tree it must be able to discard.
//
// WHY A FULL-DOCUMENT TEARDOWN, NOT A CACHE CLEAR
// -----------------------------------------------
// The QueryClient is a module singleton, so signing out never discards it on
// its own. The obvious fix - queryClient.clear() on a session change - does NOT
// work, and this is the crux:
//
//   - clear() empties the cache but does not tell already-mounted query
//     observers to drop the rows they have ALREADY rendered. On an A -> B
//     account switch RequireSession never unmounts (both sessions are truthy),
//     so the authenticated tree keeps showing A's data with an empty cache
//     behind it and no refetch in flight.
//   - clear() does not cancel in-flight mutations. Their optimistic-rollback
//     onError handlers call setQueryData(previous) AFTER the wipe, re-inserting
//     the signed-out account's data into the "cleared" cache.
//
// A real document teardown has neither hole: it discards mounted observers, the
// cache, the session atom, and any pending mutation together. That is exactly
// what the DELIBERATE exits already do (useSignOut, DeleteAccountSection,
// magic-link all window.location their way out). This guard is the same teardown
// for the AMBIENT cases those exits cannot reach:
//
//   - cross-tab: better-auth broadcasts a sign-out via a localStorage `storage`
//     event; a second tab refetches, its session 401s to null, and it would
//     otherwise only client-route to /sign-in with its singleton cache intact.
//   - account switch: a focus refetch (or magic-link redemption elsewhere) can
//     publish account B into a tab still showing A, with no user action here.
//   - expiry: the session simply goes away.
//
// Keying on the user id catches all of them with no per-exit checklist to keep
// in sync. We navigate to '/' rather than /sign-in so both a switch (B lands on
// B's home) and a sign-out (RequireSession then sends null on to /sign-in) are
// served by one target.
//
// WHY SUPPRESS CHILDREN SYNCHRONOUSLY, NOT JUST NAVIGATE IN AN EFFECT
// ------------------------------------------------------------------
// window.location.assign is asynchronous - the browser schedules the navigation
// and keeps running. If we only fired it from an effect, React would first
// COMMIT the render that observed account B, and on an A -> B switch that render
// is the mounted authenticated tree still holding A's cached rows: A's data
// paints under B for at least one frame before the document is replaced. That
// painted frame IS the confidentiality violation this guard exists to prevent.
// So the moment we observe an established account change to a different-or-absent
// one we stop rendering children in the SAME render (return null below), which
// discards the mounted tree before it can be committed, and only then trigger
// the document teardown from a layout effect.
export function SessionCacheGuard({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession()
  const userId = session?.user.id ?? null

  // The last account this guard has observed, and whether a cross-account change
  // has put us into teardown. Both are React state, adjusted DURING render (the
  // documented "store info from previous renders" pattern) rather than in an
  // effect, so the switch render can suppress children before anything commits.
  // lastUserId starts at the first observed id, so the initial render - a load
  // that is already authenticated, or the anonymous first paint - is never a
  // transition.
  const [lastUserId, setLastUserId] = useState<string | null>(userId)
  const [tearingDown, setTearingDown] = useState(false)

  if (userId !== lastUserId) {
    setLastUserId(userId)
    // Only an ESTABLISHED account (lastUserId !== null) changing to a
    // different-or-absent one is a teardown. First observation of a session
    // (lastUserId === null: sign-in, or a load that starts authenticated) and
    // same-user refetches are not. better-auth only nulls session data on a 401
    // (genuine sign-out or expiry), never on a network blip, so this cannot
    // spuriously fire mid-session.
    if (lastUserId !== null) setTearingDown(true)
  }

  // Whether THIS document ever held a session. Gates the bfcache reload below so
  // an anonymous page (notably the magic-link page, which keeps its one-shot
  // token in memory) is never reloaded out from under itself. A LAYOUT effect,
  // not a passive one: a document can be frozen into bfcache the instant a
  // navigation commits, and a passive effect that had not yet run would leave
  // this ref false in the frozen heap - so a later restore would skip a reload
  // it needed. useLayoutEffect runs synchronously with the commit, before the
  // browser can paint or freeze, closing that window. (Not a render-time write:
  // the ref must only flip for a committed render, not a discarded one.)
  const wasAuthenticated = useRef(false)
  useLayoutEffect(() => {
    if (userId !== null) wasAuthenticated.current = true
  }, [userId])

  // The teardown itself: discards the mounted tree (already suppressed below),
  // the singleton cache, the session atom, and any pending mutation together by
  // replacing the document. A layout effect so it is scheduled as early as
  // possible after the suppressing render commits. clearLastListPath first
  // because a reload does not clear localStorage, and the per-account pointer
  // must not survive into the next account in this browser.
  useLayoutEffect(() => {
    if (!tearingDown) return
    clearLastListPath()
    window.location.assign('/')
  }, [tearingDown])

  // bfcache. A full-document navigation away from an authenticated page can
  // leave that page in the Back/Forward cache with its entire JS heap frozen -
  // cache, session atom and all. Pressing Back restores it verbatim, which no
  // in-app state check can observe; `pageshow` with persisted === true is the
  // one signal that a restore happened. Reload only if this document was ever
  // authenticated: reloading a restored anonymous page would, on the magic-link
  // page, throw away the token it scrubbed from the URL and strand the user on
  // "Broken link". Reload itself is an ordinary load (persisted === false), so
  // there is no loop.
  //
  // Registered in a LAYOUT effect for the same reason as the ref above: the
  // listener must be attached before the document can be frozen into bfcache, or
  // a restore's `pageshow` would fire with no handler to catch it.
  useLayoutEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted && wasAuthenticated.current) window.location.reload()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // Once a cross-account change is observed, render nothing until the document
  // teardown lands. This unmounts the authenticated tree (and every row it has
  // rendered from the singleton cache) in the SAME commit that saw the switch,
  // so A's data is never painted under B in the window before assign('/') runs.
  if (tearingDown) return null
  return children
}
