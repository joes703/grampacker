import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { useDocumentTitle } from '../lib/use-document-title'
import { useAuth } from './AuthProvider'
import AboutLink from '../components/AboutLink'

export default function LoginPage() {
  useDocumentTitle('Sign in')
  const navigate = useNavigate()
  // Reactively bounce already-authenticated users so a tab whose session
  // arrives via cross-tab sync (or any other post-mount source) doesn't
  // strand on the form. Matches PrivateRoute's loading semantics:
  // render nothing until the initial getSession() resolves.
  const { session, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (authLoading) return null
  if (session) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        setError('Please confirm your email address before signing in. Check your inbox.')
      } else {
        setError('Invalid email or password.')
      }
    } else {
      navigate('/')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="mb-6">
          <p className="text-2xl font-semibold text-gray-900">Grampacker</p>
          <p className="mt-2 text-sm text-gray-600">
            A simple gear list and pack weight tracker for backpacking trips.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Works on web and mobile, includes a packing mode, and works offline.
          </p>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-6">Sign in</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-1 text-right">
              <Link to="/forgot-password" className="text-xs text-blue-600 hover:underline">
                Forgot password?
              </Link>
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-600">
          No account?{' '}
          <Link to="/register" className="text-blue-600 hover:underline">
            Create one
          </Link>
        </p>
      </div>

      <AboutLink className="mt-6 text-xs text-gray-500 hover:text-gray-700" />
    </div>
  )
}
