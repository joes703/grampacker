import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { authClient } from '../lib/auth-client'
import { authErrorMessage } from './auth-errors'

// The shared re-authentication machine behind the fresh-session gates.
//
// Some mutations need a FRESH session - one minted by a recent sign-in
// ceremony (adding or removing a passkey, deleting the account). The client
// never keeps its own freshness clock: it just TRIES, and when the server
// refuses for want of a fresh proof, the caller's `run` returns 'reauth'.
// The action is then PARKED (it is data, not a closure, so the retry path is
// obvious and testable), the user proves it is them, and the parked action
// replays.
//
// Two ways to prove it, because one of them is not always available: a user
// with no passkey cannot re-assert one, so the same email link that signs
// them in is always offered. Signing in again mints a NEW session, and a new
// session is a fresh one - that is the whole mechanism, and it is a strictly
// stronger proof than the old "type your password" prompt.
//
// What stays with each caller, on purpose: the gated request itself, its
// refusal codes (better-auth spells "stale session" differently per
// endpoint), any request decoration (the delete's confirmed-account header),
// and the error reporting for every terminal outcome. `run` returns 'reauth'
// ONLY for a refusal that re-authenticating can cure; everything else it
// reports itself and answers 'done'.

export type ReauthOutcome = 'done' | 'reauth'

type Options<A> = {
  // Runs the gated mutation. See the contract above.
  run: (action: A) => Promise<ReauthOutcome>
  // Where the fallback sign-in link goes: the signed-in user's email.
  email: string | undefined
  // Busy and error state stay owned by the section - both sections share
  // them with neighboring flows the hook knows nothing about.
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  // Optional shared in-flight guard: pass the section's own ref when its own
  // entry point must block (and be blocked by) the reauth flows in the same
  // tick - the delete form's submit shares one so deleteUser can never fire
  // twice. Without it the hook keeps a private ref for the reauth flows.
  submitting?: RefObject<boolean>
}

export function useReauth<A extends NonNullable<unknown>>({
  run,
  email,
  setBusy,
  setError,
  submitting: sharedSubmitting,
}: Options<A>) {
  // The mutation parked behind re-authentication. Non-null == the prompt is up.
  const [pending, setPending] = useState<A | null>(null)
  // Set once a sign-in link has been sent, so the prompt stops offering to
  // send another and tells the user where to look instead.
  const [linkSent, setLinkSent] = useState(false)
  // Synchronous re-entrancy guard: a disabled button does not stop a form's
  // Enter submit, and busy is render-derived (it lags a synchronous double
  // delivery). The ref flips in the same tick, so the second delivery bails
  // before any network call.
  const ownSubmitting = useRef(false)
  const submitting = sharedSubmitting ?? ownSubmitting

  // Try the action; park it when the server wants a fresh session first.
  async function request(action: A) {
    setError(null)
    setBusy(true)
    try {
      if ((await run(action)) === 'reauth') setPending(action)
    } finally {
      setBusy(false)
    }
  }

  // Re-authenticate with a passkey, then replay the parked action. If the
  // server STILL refuses, something changed underneath us (signed out
  // elsewhere): re-park rather than swallow it.
  async function reauthWithPasskey() {
    const action = pending
    if (action === null || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.signIn.passkey()
      if (result?.error) {
        setError(authErrorMessage(result.error, "Couldn't confirm it was you."))
        return
      }
      setPending(null)
      if ((await run(action)) === 'reauth') setPending(action)
    } catch {
      setError('Passkey confirmation was canceled or failed.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  // The fallback that keeps every account reachable: the same email link
  // that signs the user in. It does not replay the action - the link lands
  // in a new session, and the user tries again from there.
  async function reauthWithEmail() {
    if (!email || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const { error: sendError } = await authClient.signIn.magicLink({ email })
      if (sendError) {
        setError(authErrorMessage(sendError, "Couldn't send the link."))
        return
      }
      setLinkSent(true)
    } catch {
      setError("Couldn't send the link.")
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  function cancel() {
    setPending(null)
    setLinkSent(false)
    setError(null)
  }

  return {
    pending,
    linkSent,
    request,
    reauthWithPasskey,
    reauthWithEmail,
    cancel,
  }
}

// The two prompt themes. 'neutral' is the passkey section's gray box with a
// blue primary action; 'danger' is the delete section's red warning box.
const PROMPT_TONES = {
  neutral: {
    container: 'space-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2',
    message: 'text-sm text-gray-700',
    linkSent: 'text-sm text-gray-600',
    passkeyButton:
      'rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50',
  },
  danger: {
    container: 'space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2',
    message: 'text-sm text-red-800',
    linkSent: 'text-sm text-gray-700',
    passkeyButton:
      'rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50',
  },
} as const

type PromptProps = {
  tone: keyof typeof PROMPT_TONES
  message: ReactNode
  linkSent: boolean
  email: string | undefined
  // Offer "Use a passkey" only when THIS account can use one: for any other
  // account the browser may offer a passkey that belongs to someone else.
  // Each section decides from the data it already has.
  showPasskey: boolean
  busy: boolean
  onPasskey: () => void
  onEmail: () => void
  // Omitted where the prompt must stay up (the delete flow has no way back
  // short of leaving the page).
  onCancel?: () => void
}

export function ReauthPrompt({
  tone,
  message,
  linkSent,
  email,
  showPasskey,
  busy,
  onPasskey,
  onEmail,
  onCancel,
}: PromptProps) {
  const t = PROMPT_TONES[tone]
  return (
    <div className={t.container}>
      <p className={t.message}>{message}</p>
      {linkSent ? (
        <p className={t.linkSent}>
          Sign-in link sent to {email}. Open it, then try again.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {showPasskey && (
            <button
              type="button"
              className={t.passkeyButton}
              onClick={onPasskey}
              disabled={busy}
            >
              {busy ? 'Confirming...' : 'Use a passkey'}
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            onClick={onEmail}
            disabled={busy}
          >
            Email me a link
          </button>
          {onCancel && (
            <button
              type="button"
              className="text-sm font-medium text-gray-600 hover:underline"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}
