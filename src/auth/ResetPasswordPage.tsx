import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { MIN_PASSWORD_LENGTH } from '../../shared/auth'
import { authClient } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'
import { AuthCard, ErrorText, FIELD, LABEL, PRIMARY_BUTTON, TEXT_LINK } from './auth-ui'

// Landing page for the emailed reset link: the server validates the raw
// token and redirects here with ?token=..., or with ?error=... when the
// link is invalid/expired.
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const linkError = searchParams.get('error')

  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (linkError || !token) {
    return (
      <AuthCard title="Link expired">
        <p className="text-sm text-gray-700">
          This password reset link is invalid or has expired.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          <Link className={TEXT_LINK} to="/forgot-password">
            Request a new link
          </Link>
        </p>
      </AuthCard>
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // The no-token case renders the "Link expired" branch and never this
    // form; the guard re-narrows for TypeScript inside the closure.
    if (pending || !token) return
    setError(null)
    // The form is noValidate, so the input's minLength is advisory only -
    // enforce the shared minimum here so a short password is caught before
    // the round-trip (the server rejects it too).
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    setPending(true)
    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (resetError) {
        setError(
          authErrorMessage(resetError, "Couldn't reset the password. Please try again."),
        )
        return
      }
      setDone(true)
    } catch {
      setError("Couldn't reset the password. Please try again.")
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <AuthCard title="Password updated">
        <p className="text-sm text-gray-700">
          Your password has been reset. You can sign in with it now.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          <Link className={TEXT_LINK} to="/sign-in">
            Go to sign in
          </Link>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label className={LABEL} htmlFor="password">
            New password
          </label>
          <input
            id="password"
            className={FIELD}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <p className="mt-1 text-xs text-gray-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>
        <ErrorText message={error} />
        <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
          {pending ? 'Saving...' : 'Reset password'}
        </button>
      </form>
    </AuthCard>
  )
}
