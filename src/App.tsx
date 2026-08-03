import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { shouldRetryQuery } from './lib/api'
import { authClient } from './lib/auth-client'
import { mutationErrorHandler } from './lib/mutation-error-handler'
import { hasSeenSession, rememberSession } from './lib/session-hint'
import { MAGIC_LINK_PATH } from '../shared/auth'
import SignInPage from './auth/SignInPage'
import MagicLinkPage from './auth/MagicLinkPage'
import ToastViewport from './components/Toast'
import ChunkErrorBoundary from './components/ChunkErrorBoundary'
import AppLoading from './components/AppLoading'
import { SessionCacheGuard } from './layout/session-cache-guard'

// The two anonymous surfaces are split out of the main bundle, because until
// now both of them shipped the whole authenticated app to people who could not
// use a byte of it:
//
//   AuthenticatedApp - the signed-in area. It renders INSIDE RequireSession,
//     which is the point: a signed-out visitor with no hint (see below) never
//     requests it at all.
//
//   SharePage - /r/:slug, the public read-only list view. Anonymous by design
//     and the busiest anonymous surface there is (it is what a share link
//     opens), so it has no business carrying the app it is not part of.
//
// "One chunk" is the intent, not quite the emitted graph: the authenticated
// area resolves to the AuthenticatedApp chunk PLUS the shared chunk it has in
// common with SharePage (CategoryGroup and the list-rendering subtree). Both are
// fetched in the same wave - Vite emits the static deps of a dynamic import as
// preloads alongside it - so it costs bytes, not a round-trip. What it is NOT is
// one chunk per page: see AuthenticatedApp.tsx for that trade.
const importAuthenticatedApp = () => import('./AuthenticatedApp')
const AuthenticatedApp = lazy(importAuthenticatedApp)
const SharePage = lazy(() => import('./lists/SharePage'))

// Loading AuthenticatedApp inside the session gate is what keeps it away from
// anonymous visitors, but taken alone it would make every signed-in visitor pay
// for that: entry bundle -> ask the server who you are -> only THEN start
// downloading the app. Three serial steps where there used to be two, so the
// split would have been a straight trade of their latency for someone else's
// bytes.
//
// So: if this browser has ever held a session, start the download NOW, in
// parallel with the session check, and let RequireSession catch up. It is fired
// at module scope deliberately - an effect would run a paint too late, which is
// the whole thing we are trying to buy back.
//
// This is not a prefetch-on-idle (that would hand the bytes right back to the
// visitor the split is for). A browser with no hint - a genuinely new visitor,
// the one PERF-02 is about - never asks for this chunk. A browser that HAS the
// hint but is signed out (someone who signed out, or whose session expired)
// fetches a chunk RequireSession then declines to render: a wasted download, and
// the deliberate price of the hint.
//
// The catch is not decoration. A warm-up whose promise rejects is an
// unhandledrejection, and this one CAN reject - a tab open across a deploy asks
// for a chunk hash that no longer exists. Swallow it here: if the chunk is
// actually needed, React.lazy imports it again and ChunkErrorBoundary is what
// handles the failure, in one place, with a reload.
if (hasSeenSession()) {
  void importAuthenticatedApp().catch(() => {})
}

// Query defaults ported from the old app: 30s staleTime keeps rapid
// navigation off the network, a single retry smooths transient blips
// without hammering a down server, and focus refetch stays off (the data
// is single-user; nothing changes behind your back). Note that this last one
// governs TANSTACK's focus refetch only - better-auth runs its own on the
// session, deliberately left on, and it is one of the paths that recovers a
// session check that failed for a reason other than a 401. The
// MutationCache.onError handler is extracted to
// src/lib/mutation-error-handler.ts so the same function powers both
// production and the unit tests (a copy in the test would only test
// the copy). See that module's doc comment for the full rationale.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
  },
  mutationCache: new MutationCache({ onError: mutationErrorHandler }),
})

// Gate rule: never unmount children on a PENDING session. The auth client
// refetches the session after every auth mutation, and replacing the page
// during that refetch would unmount it mid-flow and wipe its local state
// (e.g. the sign-up "check your email" card). Show the stable loading surface
// only on the initial load, where there is no data yet.
function RequireSession({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()

  // The only place a real session is ever confirmed, so it is the only honest
  // place to record the hint that warms the chunk on the NEXT load. Every way
  // in lands here: passkey and magic link both navigate into the gated area
  // once they have a session.
  useEffect(() => {
    if (session) rememberSession()
  }, [session])

  if (isPending && !session) return <AppLoading fullScreen />
  if (!session) return <Navigate to="/sign-in" replace />
  return children
}

// Signed-in users have no business on the auth forms; this is also what
// lands a freshly verified user at `/` (the verification link's
// callbackURL is /sign-in and verifying creates a session), where
// RootRedirect sends them on to their most-recent list. Renders the form
// during the initial session fetch (anon is the common case) rather than
// unmounting it on every refetch.
function RedirectIfSession({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession()
  if (session) return <Navigate to="/" replace />
  return children
}

// Exported so the route table can be tested against a real router (see
// app-routes.test.tsx). App itself pins BrowserRouter, which reads the real
// URL bar and cannot be pointed at a path; splitting the table out is what lets
// a test drive it through MemoryRouter with the ACTUAL react-router matching
// rather than a mock of it. That matters more than usual here: this table
// carries the lazy boundary, and it moved every authenticated path from a flat
// route list to relative paths under a splat.
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          <RedirectIfSession>
            <SignInPage />
          </RedirectIfSession>
        }
      />
      {/* There is no sign-up page any more: requesting a magic link for an
          unknown address creates the account when it is redeemed, so one
          surface serves both. Old bookmarks and any stale link land on it. */}
      <Route path="/sign-up" element={<Navigate to="/sign-in" replace />} />
      {/* Where magic-link emails land. NOT wrapped in RedirectIfSession: a
          user who is already signed in on this device may be redeeming a
          link to switch accounts, and bouncing them home would silently
          burn the token they clicked. The page verifies only on a click. */}
      <Route path={MAGIC_LINK_PATH} element={<MagicLinkPage />} />
      {/* Public share view: anonymous by design (the server gates on
          is_shared), and deliberately outside AppShell - viewers get
          the read-only document, not the app chrome. Signed-in users
          opening someone's link see the same public view. */}
      <Route
        path="/r/:slug"
        element={
          <Suspense fallback={<AppLoading fullScreen />}>
            <SharePage />
          </Suspense>
        }
      />
      {/* Everything else is behind the session gate, including the old "*"
          catch-all (it lives in AuthenticatedApp now). The static paths above
          still win: react-router ranks by specificity, not by source order, so
          a splat never shadows them.

          The session and lazy boundaries share the same full-viewport loading
          landmark, so handing off between those two serial gates does not flash
          a second shape. */}
      <Route
        path="/*"
        element={
          <RequireSession>
            <Suspense fallback={<AppLoading fullScreen />}>
              <AuthenticatedApp />
            </Suspense>
          </RequireSession>
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <ChunkErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* Owns the "one account's data may not render to another" invariant
            for the whole app. It WRAPS the router (not a sibling) on purpose:
            on any ambient account change/sign-out it must be able to suppress
            the mounted tree synchronously - before A's cached rows commit under
            B - and only then tear the document down. It also reloads a
            bfcache-restored authenticated document. See its doc comment for why
            a cache clear is not enough and why suppression must be synchronous. */}
        <SessionCacheGuard>
          <BrowserRouter>
            <AppRoutes />
            <ToastViewport />
          </BrowserRouter>
        </SessionCacheGuard>
      </QueryClientProvider>
    </ChunkErrorBoundary>
  )
}
