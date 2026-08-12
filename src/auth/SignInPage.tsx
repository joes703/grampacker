import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { authClient, passkeysSupported } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'
import { AuthCard, ErrorText, FIELD, LABEL, PRIMARY_BUTTON, TEXT_LINK } from './auth-ui'

// The ONE auth surface. There is no separate sign-up page: requesting a link
// for an unknown address creates the account when it is redeemed, so "sign in"
// and "sign up" are the same request and splitting them would be a lie about
// what the server does.
export default function SignInPage() {
  const navigate = useNavigate()
  // A magic link that failed to verify bounces here with ?error=... (a good one
  // signs the user in, and RedirectIfSession sends them home).
  const [searchParams] = useSearchParams()
  const badLink = searchParams.get('error') !== null

  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passkeyPending, setPasskeyPending] = useState(false)

  async function handleSendLink(event: FormEvent) {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const { error: sendError } = await authClient.signIn.magicLink({ email })
      if (sendError) {
        setError(authErrorMessage(sendError, "Couldn't send the link. Please try again."))
        return
      }
      setSent(true)
    } catch {
      setError("Couldn't send the link. Please try again.")
    } finally {
      setSending(false)
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
      setError('Passkey sign-in was canceled or failed.')
    } finally {
      setPasskeyPending(false)
    }
  }

  // Deliberately says "if you have an account" rather than confirming one
  // exists: the send endpoint answers the same way for a known and an unknown
  // address, and this copy must not undo that by turning the UI into an
  // account-enumeration oracle.
  if (sent) {
    return (
      <AuthCard title="Check your email">
        <p className="text-sm text-gray-700">
          If <span className="font-medium">{email}</span> has an account, a
          sign-in link is on its way. It works once and expires in 5 minutes.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          <button
            type="button"
            className={TEXT_LINK}
            onClick={() => {
              setSent(false)
              setError(null)
            }}
          >
            Use a different email
          </button>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Sign in">
      {badLink && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          That sign-in link is invalid, already used, or expired. Request a new
          one.
        </p>
      )}

      {/* Passkey first: it is the primary credential, and for anyone who has one
          it is a single tap with no inbox round-trip. */}
      {passkeysSupported() && (
        <>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            onClick={() => void handlePasskeySignIn()}
            disabled={passkeyPending}
          >
            {passkeyPending ? 'Waiting for passkey...' : 'Sign in with a passkey'}
          </button>
          {/* gray-500, not gray-400: at 12px this is normal-weight text, so it owes
              4.5:1 (the relaxed 3:1 floor starts at 24px, or 18.7px bold - not
              here). Computed from the colors Tailwind 4 actually emits, which are
              oklch, not the v3 hexes: gray-400 resolves to #99a1af = 2.60:1 against
              white, exactly the ratio Lighthouse failed it on; gray-500 resolves to
              #6a7282 = 4.84:1. The divider RULES stay gray-200: they carry no
              information (the word "or" does), so they are decoration and owe
              nothing. */}
          <div className="my-4 flex items-center gap-3 text-xs text-gray-500">
            <div className="h-px flex-1 bg-gray-200" />
            or
            <div className="h-px flex-1 bg-gray-200" />
          </div>
        </>
      )}

      <form onSubmit={(e) => void handleSendLink(e)} className="space-y-4" noValidate>
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
        <button
          type="submit"
          className={
            passkeysSupported()
              ? 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50'
              : PRIMARY_BUTTON
          }
          disabled={sending || !email}
        >
          {sending ? 'Sending...' : 'Email me a sign-in link'}
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-600">
        New here? Use the email link - your account is created when you open it,
        and you can add a passkey straight after.
      </p>
    </AuthCard>
  )
}
