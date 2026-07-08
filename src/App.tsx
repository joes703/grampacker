import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { authClient } from './lib/auth-client'
import SignInPage from './auth/SignInPage'
import SignUpPage from './auth/SignUpPage'
import ForgotPasswordPage from './auth/ForgotPasswordPage'
import ResetPasswordPage from './auth/ResetPasswordPage'
import HomePage from './home/HomePage'

// Query defaults ported from the old app: 30s staleTime keeps rapid
// navigation off the network, a single retry smooths transient blips
// without hammering a down server, and focus refetch stays off (the data
// is single-user; nothing changes behind your back). The global mutation
// error handler (meta.errorToast) arrives with the Toast system in the
// UI transplant.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: (failureCount) => failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Gate rule: never unmount children on a PENDING session. The auth client
// refetches the session after every auth mutation, and an isPending ->
// null render would unmount the page mid-flow and wipe its local state
// (e.g. the sign-up "check your email" card). Blank only the initial
// load, where there is no data yet.
function RequireSession({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  if (isPending && !session) return null
  if (!session) return <Navigate to="/sign-in" replace />
  return children
}

// Signed-in users have no business on the auth forms; this is also what
// lands a freshly verified user on home (the verification link's
// callbackURL is /sign-in and verifying creates a session). Renders the
// form during the initial session fetch (anon is the common case) rather
// than unmounting it on every refetch.
function RedirectIfSession({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession()
  if (session) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <RequireSession>
                <HomePage />
              </RequireSession>
            }
          />
          <Route
            path="/sign-in"
            element={
              <RedirectIfSession>
                <SignInPage />
              </RedirectIfSession>
            }
          />
          <Route
            path="/sign-up"
            element={
              <RedirectIfSession>
                <SignUpPage />
              </RedirectIfSession>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <RedirectIfSession>
                <ForgotPasswordPage />
              </RedirectIfSession>
            }
          />
          {/* Not session-gated in either direction: a signed-in user clicking
              a reset link should still be able to set a new password. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
