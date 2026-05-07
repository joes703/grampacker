import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import AppShell from './layout/AppShell'

// Auth pages and SharePage are reachable only by unauthed visitors and
// never load alongside the authed app. Lazy-loading defers their bundles
// until first navigation. AppShell stays eager (post-login destination
// for every authed user — lazy would just add a chunk hop).
const LoginPage = lazy(() => import('./auth/LoginPage'))
const SignupPage = lazy(() => import('./auth/SignupPage'))
const ForgotPasswordPage = lazy(() => import('./auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./auth/ResetPasswordPage'))
const SharePage = lazy(() => import('./lists/SharePage'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return null
  return session ? <>{children}</> : <Navigate to="/login" replace />
}

export default function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/r/:slug" element={<SharePage />} />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <AppShell />
            </PrivateRoute>
          }
        />
      </Routes>
    </Suspense>
  )
}
