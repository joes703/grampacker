import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { authClient } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'
import { AuthCard, ErrorText, FIELD, LABEL, PRIMARY_BUTTON, TEXT_LINK } from './auth-ui'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const { error: resetError } = await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      })
      if (resetError) {
        setError(authErrorMessage(resetError, "Couldn't send the email. Please try again."))
        return
      }
      setSent(true)
    } catch {
      setError("Couldn't send the email. Please try again.")
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <p className="text-sm text-gray-700">
          If an account exists for <span className="font-medium">{email}</span>,
          we sent a password reset link.
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
    <AuthCard title="Reset your password">
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
        <ErrorText message={error} />
        <button type="submit" className={PRIMARY_BUTTON} disabled={pending}>
          {pending ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-600">
        <Link className={TEXT_LINK} to="/sign-in">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  )
}
