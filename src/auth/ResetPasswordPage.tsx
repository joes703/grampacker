import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { useDocumentTitle } from '../lib/use-document-title'

// Landing page for password recovery email links. The user clicks the link
// in their inbox, Supabase verifies the recovery token, and redirects here
// with one of two URL shapes depending on the project's auth flow type:
//
//   PKCE (default in recent supabase-js):
//     /reset-password?code=<recovery-code>
//     → exchange via supabase.auth.exchangeCodeForSession(code)
//
//   Implicit (older):
//     /reset-password#access_token=...&refresh_token=...&type=recovery
//     → supabase-js auto-processes via detectSessionInUrl: true (default);
//       getSession() then returns the recovery session.
//
// Errors append ?error_description= for expired / used / invalid tokens.
//
// We deliberately do NOT bounce already-authenticated users from this page
// (unlike LoginPage / ForgotPasswordPage) — a recovery-flow user IS
// authenticated by the time the password form renders, and bouncing them
// would force them through /forgot-password again.

type State =
  | { kind: 'verifying' }
  | { kind: 'ready' }
  | { kind: 'updating' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

const INVALID_LINK_MESSAGE =
  'This reset link is invalid or expired. Please request a new one.'

export default function ResetPasswordPage() {
  useDocumentTitle('Set new password')
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'verifying' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  // Verify the recovery token (or session) on mount. Three branches:
  //   1. ?error_description= → Supabase rejected the token before redirect.
  //   2. ?code= → PKCE flow; exchange for a session.
  //   3. Else → implicit flow may have already established a session via
  //      detectSessionInUrl; check getSession().
  useEffect(() => {
    let cancelled = false
    async function verify() {
      const url = new URL(window.location.href)
      const errorDescription = url.searchParams.get('error_description')
      if (errorDescription) {
        if (!cancelled) setState({ kind: 'error', message: INVALID_LINK_MESSAGE })
        return
      }

      const code = url.searchParams.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (cancelled) return
        if (error) {
          setState({ kind: 'error', message: INVALID_LINK_MESSAGE })
          return
        }
        setState({ kind: 'ready' })
        return
      }

      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) setState({ kind: 'ready' })
      else setState({ kind: 'error', message: INVALID_LINK_MESSAGE })
    }
    void verify()
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-redirect after success — short delay so the user sees the
  // confirmation message before navigation.
  useEffect(() => {
    if (state.kind !== 'success') return
    const handle = setTimeout(() => navigate('/lists', { replace: true }), 1500)
    return () => clearTimeout(handle)
  }, [state, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setFormError('Passwords do not match.')
      return
    }
    setState({ kind: 'updating' })
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      // Supabase password-policy errors (too short, etc.) are user-actionable;
      // surface verbatim. Drop back to ready so the user can try again.
      setFormError(error.message)
      setState({ kind: 'ready' })
      return
    }
    setState({ kind: 'success' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">Set new password</h1>
        {state.kind === 'verifying' && (
          <p className="text-sm text-gray-500">Verifying link…</p>
        )}
        {state.kind === 'error' && (
          <>
            <p className="text-sm text-red-600 mb-4">{state.message}</p>
            <p className="text-center text-sm text-gray-600">
              <Link to="/forgot-password" className="text-blue-600 hover:underline">
                Request a new reset link
              </Link>
            </p>
          </>
        )}
        {state.kind === 'success' && (
          <p className="text-sm text-green-600">Password updated. Redirecting…</p>
        )}
        {(state.kind === 'ready' || state.kind === 'updating') && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="rp-new" className="block text-sm font-medium text-gray-700 mb-1">
                New password
              </label>
              <input
                id="rp-new"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="rp-confirm" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm new password
              </label>
              <input
                id="rp-confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button
              type="submit"
              disabled={state.kind === 'updating' || !password || !confirm}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {state.kind === 'updating' ? 'Updating…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
