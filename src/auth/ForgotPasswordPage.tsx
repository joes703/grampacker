import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { useDocumentTitle } from '../lib/use-document-title'
import { useAuth } from './AuthProvider'

// Signed-out password recovery. The user enters their email; if an account
// exists, Supabase sends a recovery link to /reset-password. We always show
// the same success message regardless of whether resetPasswordForEmail
// succeeded or returned an error — anti-enumeration: a different message
// would reveal whether an email is registered.
export default function ForgotPasswordPage() {
  useDocumentTitle('Reset password')
  const { session, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  // Bounce already-authenticated users — they should use the in-app
  // change-password flow, not the recovery flow. Matches LoginPage's
  // pattern.
  if (authLoading) return null
  if (session) return <Navigate to="/lists" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Fire and forget — Supabase's response is intentionally not surfaced
    // to the user. Whether the email exists or not, the same success
    // message appears. The redirectTo URL must be in the project's Auth
    // → URL Configuration → Redirect URLs allowlist; otherwise Supabase
    // ignores it and falls back to the site URL.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    setSubmitted(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">Reset password</h1>
        {submitted ? (
          <>
            <p className="text-sm text-gray-700">
              If an account exists for <span className="font-medium">{email}</span>, we&apos;ve sent a reset link. Check your inbox (and spam folder) — the link expires after a short while.
            </p>
            <p className="mt-6 text-center text-sm text-gray-600">
              <Link to="/login" className="text-blue-600 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-4">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="fp-email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="fp-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-gray-600">
              <Link to="/login" className="text-blue-600 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
