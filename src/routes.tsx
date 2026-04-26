import { Routes, Route, Navigate } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import LoginPage from './auth/LoginPage'
import SignupPage from './auth/SignupPage'
import AppShell from './layout/AppShell'

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
