import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { useDocumentTitle } from '../lib/use-document-title'
import FormLabel from '../components/FormLabel'
import PrimaryButton from '../components/PrimaryButton'

// Landing page for password recovery email links. The user clicks the link
// in their inbox, Supabase verifies the recovery token, and redirects here
// with `?code=<recovery-code>` (PKCE flow, the project's default). The
// page exchanges the code for a session, then renders the new-password
// form. Errors append `?error_description=` for expired / used / invalid
// tokens.
//
// Recovery-only: a successful PKCE code exchange is the ONLY way to reach
// the password form. An existing authenticated session without a recovery
// code redirects to /settings (where the in-app change-password flow
// lives, with its own current-password challenge). Without this guard, a
// signed-in user could navigate directly to /reset-password and change
// their password without re-auth, bypassing the in-app flow's
// current-password proof. Codex audit finding 4.

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

  // Verify the recovery context on mount. Three branches:
  //   1. ?error_description= → Supabase rejected the token before redirect.
  //   2. ?code= → PKCE flow; exchange for a session.
  //   3. Neither → no recovery context. Signed-in users redirect to
  //      /settings (in-app change flow); signed-out users see the invalid-
  //      link state with a path back to /forgot-password.
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

      // No recovery code in the URL. The page is recovery-only: a normal
      // existing session doesn't qualify as proof. Redirect signed-in users
      // to /settings (in-app change-password flow with current-password
      // proof); show the invalid-link state to signed-out users.
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) navigate('/settings', { replace: true })
      else setState({ kind: 'error', message: INVALID_LINK_MESSAGE })
    }
    void verify()
    return () => {
      cancelled = true
    }
  }, [navigate])

  // Auto-redirect after success — short delay so the user sees the
  // confirmation message before navigation.
  useEffect(() => {
    if (state.kind !== 'success') return
    const handle = setTimeout(() => navigate('/', { replace: true }), 1500)
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
      // Genericize: Supabase's verbatim error.message can leak account-
      // state probes or policy details that aren't user-actionable here.
      // Client-side length check above already covers the only actionable
      // case (too short). Anything else is "try again or request a new
      // link", which the user can do from this same page.
      setFormError('Could not update password. Please try again, or request a new reset link.')
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
              <FormLabel htmlFor="rp-new">
                New password
              </FormLabel>
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
              <FormLabel htmlFor="rp-confirm">
                Confirm new password
              </FormLabel>
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
            <PrimaryButton
              type="submit"
              disabled={state.kind === 'updating' || !password || !confirm}
              fullWidth
            >
              {state.kind === 'updating' ? 'Updating…' : 'Set new password'}
            </PrimaryButton>
          </form>
        )}
      </div>
    </div>
  )
}
