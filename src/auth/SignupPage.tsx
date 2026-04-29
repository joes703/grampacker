import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { useDocumentTitle } from '../lib/use-document-title'
import { useAuth } from './AuthProvider'

export default function SignupPage() {
  useDocumentTitle('Sign up')
  // Reactively bounce already-authenticated users — see LoginPage for the
  // motivating cross-tab cold-load case.
  const { session, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)

  if (authLoading) return null
  if (session) return <Navigate to="/lists" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8 || password.length > 128) {
      setError('Password must be 8–128 characters.')
      return
    }

    setLoading(true)
    const { error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) {
      setError('Registration could not be completed. Please try different details.')
      setLoading(false)
      return
    }

    setLoading(false)
    setSubmittedEmail(email)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        {submittedEmail ? (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-4">Check your email</h1>
            <p className="text-sm text-gray-700 mb-2">
              We sent a confirmation link to <span className="font-medium text-gray-900">{submittedEmail}</span>.
            </p>
            <p className="text-sm text-gray-700 mb-6">
              Click the link in the email to activate your account.
            </p>
            <p className="text-sm text-gray-600">
              Wrong email?{' '}
              <button
                type="button"
                onClick={() => setSubmittedEmail(null)}
                className="text-blue-600 hover:underline"
              >
                Back to signup
              </button>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-6">Create account</h1>
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
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">8–128 characters</p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-gray-600">
              Already have an account?{' '}
              <Link to="/login" className="text-blue-600 hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}