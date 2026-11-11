import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { authClient, passkeysSupported } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'
import { forgetLinkSignIn } from './link-sign-in-prompt'
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

  // Arriving here means no link sign-in finished in this tab (a good link
  // lands on '/'). Forget a started one, so a later passkey sign-in here is
  // not taken for a link sign-in (link-sign-in-prompt.ts).
  useEffect(() => {
    forgetLinkSignIn()
  }, [])

  async function handleSendLink(event: FormEvent) {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const { error: sendError } = await authClient.signIn.magicLink({ email })
      if (sendError) {
        // The browser passes a@b and the server does not. The email is the only
        // field this call sends, so its validation error is about the email.
        setError(
          sendError.code === 'VALIDATION_ERROR'
            ? 'Enter a valid email address.'
            : authErrorMessage(sendError, "Couldn't confirm the link was sent. Check your email before trying again."),
        )
        return
      }
      setSent(true)
    } catch {
      setError("Couldn't confirm the link was sent. Check your email before trying again.")
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

  // One copy for every address, known or unknown, so this screen cannot be
  // turned into an account-enumeration oracle. The unconditional claim is
  // also simply true here: signup is redemption, so an unknown address gets
  // a working link too. Do not add "if you have an account": an unknown
  // address also gets a link, and the link creates the account.
  if (sent) {
    return (
      <AuthCard title="Check your email">
        <p className="text-sm text-gray-700">
          We sent a sign-in link to{' '}
          <span className="font-medium">{email}</span>. Open the link in this
          browser to sign in on this device. The link works one time and
          expires after 5 minutes.
        </p>
        <p className="mt-3 text-sm text-gray-600">
          If you do not see the email, check your spam folder.
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
    <AuthCard title="Sign in or create an account" about={<AboutGrampacker />}>
      {badLink && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This sign-in link does not work anymore. Each link works one time,
          for 5 minutes. Enter your email address to get a new link.
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

      <form onSubmit={(e) => void handleSendLink(e)} className="space-y-4">
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

      <HowSignInWorks />
    </AuthCard>
  )
}

// The page's description of the app, for a visitor who arrives without
// knowing what it is. Literal statements of what the app does: no idioms,
// for readers whose first language is not English.
function AboutGrampacker() {
  return (
    <>
      <p>
        Enter your gear and its weight, and grampacker shows the total weight
        of your pack.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>Base weight, worn weight and consumable weight, shown separately</li>
        <li>
          Pack mode: items sorted by where they go in your pack, with a Ready
          checkbox and a Packed checkbox for each item
        </li>
        <li>Packing lists you can print</li>
        <li>Read-only links to share a list, for example to ask for a shakedown</li>
        <li>Food planning by day and meal</li>
      </ul>
    </>
  )
}

// Beside the form because the model is unusual: no password, the first
// sign-in link creates the account, and a passkey only reaches the devices
// it syncs to. "Fingerprint, face or PIN" follows the FIDO Alliance's
// research: many people do not know the term "screen lock".
function HowSignInWorks() {
  return (
    <section className="mt-5 space-y-2 border-t border-gray-200 pt-4 text-sm text-gray-600">
      <h3 className="font-medium text-gray-800">How sign-in works</h3>
      <p>
        grampacker does not use passwords. To create an account, enter your
        email address. We send you a link. Open the link to sign in.
      </p>
      <p>
        After you sign in, add a passkey in Settings. Then you can sign in with
        your fingerprint, face or PIN, the same way you unlock your phone or
        computer.
      </p>
      <p>
        On a new device, you can use the same passkey if your passkeys sync to
        that device, for example with iCloud Keychain, Google Password Manager
        or 1Password. If they do not sync, get a sign-in link by email. Then
        add a passkey on that device.
      </p>
    </section>
  )
}
