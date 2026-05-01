import { Routes, Route, Navigate } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import LoginPage from './auth/LoginPage'
import SignupPage from './auth/SignupPage'
import AppShell from './layout/AppShell'
import AboutPage from './about/AboutPage'
import SharePage from './lists/SharePage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return null
  return session ? <>{children}</> : <Navigate to="/login" replace />
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<SignupPage />} />
      <Route path="/r/:slug" element={<SharePage />} />
      {/* Public — readable without a session. AboutPage owns its own
          chrome (auth-aware mini-header) since it sits outside AppShell. */}
      <Route path="/about" element={<AboutPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <AppShell />
          </PrivateRoute>
        }
      />
    </Routes>
  )
}
