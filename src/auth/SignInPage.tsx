import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { authClient, passkeysSupported } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'
import { AuthCard, ErrorText, FIELD, LABEL, PRIMARY_BUTTON, TEXT_LINK } from './auth-ui'

export default function SignInPage() {
  const navigate = useNavigate()
  // A failed verification link redirects here with ?error=... (the
  // successful one signs the user in, so RedirectIfSession sends them home).
  const [searchParams] = useSearchParams()
  const badVerifyLink = searchParams.get('error') !== null

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [passkeyPending, setPasskeyPending] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const { error: signInError } = await authClient.signIn.email({ email, password })
      if (signInError) {
        if (signInError.code === 'EMAIL_NOT_VERIFIED') {
          // The account exists but is inert until the emailed link is
          // clicked. Offer a resend. (Matched by code, not status:
          // better-auth uses 403 for other refusals too.)
          setNeedsVerification(true)
          return
        }
        setError(authErrorMessage(signInError, 'Sign-in failed. Please try again.'))
        return
      }
      void navigate('/')
    } catch {
      setError('Sign-in failed. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function handlePasskeySignIn() {
    if (passkeyPending) return
    setPasskeyPending(true)
    setError(null)
    try {
      const result = await authClient.signIn.passkey()
      if (result?.error) {
        setError(authErrorMessage(result.error, 'Passkey sign-in failed.'))
        return
      }
      void navigate('/')
    } catch {
      // Most common path: the user dismissed the browser's passkey prompt.
      setError('Passkey sign-in was cancelled or failed.')
    } finally {
      setPasskeyPending(false)
    }
  }

  async function handleResend() {
    if (resendState === 'sending') return
    setResendState('sending')
    setError(null)
    try {
      const { error: resendError } = await authClient.sendVerificationEmail({
        email,
        callbackURL: '/sign-in',
      })
      if (resendError) {
        setError(authErrorMessage(resendError, "Couldn't send the email. Please try again."))
        setResendState('idle')
        return
      }
      setResendState('sent')
    } catch {
      setError("Couldn't send the email. Please try again.")
      setResendState('idle')
    }
  }

  if (needsVerification) {
    return (
      <AuthCard title="Verify your email">
        <p className="text-sm text-gray-700">
          Your account isn't verified yet. Check{' '}
          <span className="font-medium">{email}</span> for the verification link.
        </p>
        <div className="mt-4 space-y-3">
          <ErrorText message={error} />
          {resendState === 'sent' ? (
            <p className="text-sm text-emerald-700">Verification email sent.</p>
          ) : (
            <button
              type="button"
              className={PRIMARY_BUTTON}
              onClick={() => void handleResend()}
              disabled={resendState === 'sending'}
            >
              {resendState === 'sending' ? 'Sending...' : 'Resend verification email'}
            </button>
          )}
          <p className="text-sm text-gray-600">
            <button
              type="button"
              className={TEXT_LINK}
              onClick={() => {
                setNeedsVerification(false)
                setResendState('idle')
                setError(null)
              }}
            >
              Back to sign in
            </button>
          </p>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Sign in">
      {badVerifyLink && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          That verification link is invalid or expired. Sign in to receive a new
          one.
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label className={LABEL} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className={FIELD}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className={FIELD}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <ErrorText message={error} />
        <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      {passkeysSupported() && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-gray-400">
            <div className="h-px flex-1 bg-gray-200" />
            or
            <div className="h-px flex-1 bg-gray-200" />
          </div>
          <button
            type="button"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handlePasskeySignIn()}
            disabled={passkeyPending}
          >
            {passkeyPending ? 'Waiting for passkey...' : 'Sign in with a passkey'}
          </button>
        </>
      )}
      <div className="mt-4 space-y-1 text-sm text-gray-600">
        <p>
          No account?{' '}
          <Link className={TEXT_LINK} to="/sign-up">
            Create one
          </Link>
        </p>
        <p>
          <Link className={TEXT_LINK} to="/forgot-password">
            Forgot your password?
          </Link>
        </p>
      </div>
    </AuthCard>
  )
}
