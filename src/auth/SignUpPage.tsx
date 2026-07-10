import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { MIN_PASSWORD_LENGTH } from '../../shared/auth'
import { authClient } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'
import { AuthCard, ErrorText, FIELD, LABEL, PRIMARY_BUTTON, TEXT_LINK } from './auth-ui'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
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
      // Verification links land on /sign-in: on success the new session
      // redirects to home; on a bad link the error banner offers a resend.
      // Deliberately no name collection: grampacker doesn't need or want it
      // (data-minimization call, 2026-07-09). better-auth's sign-up schema
      // requires the key but accepts an empty string (z.string(), no min
      // length), and nothing in the app reads user.name.
      const { error: signUpError } = await authClient.signUp.email({
        email,
        password,
        name: '',
        callbackURL: '/sign-in',
      })
      if (signUpError) {
        setError(authErrorMessage(signUpError, 'Sign-up failed. Please try again.'))
        return
      }
      setSent(true)
    } catch {
      setError('Sign-up failed. Please try again.')
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <p className="text-sm text-gray-700">
          We sent a verification link to <span className="font-medium">{email}</span>.
          Click it to activate your account.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          <Link className={TEXT_LINK} to="/sign-in">
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Create your account">
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
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <p className="mt-1 text-xs text-gray-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>
        <ErrorText message={error} />
        <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
          {pending ? 'Creating account...' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-600">
        Already have an account?{' '}
        <Link className={TEXT_LINK} to="/sign-in">
          Sign in
        </Link>
      </p>
    </AuthCard>
  )
}
