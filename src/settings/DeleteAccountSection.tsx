import { useEffect, useRef, useState } from 'react'
import { authClient, passkeysSupported } from '../lib/auth-client'
import { authErrorMessage } from '../auth/auth-errors'
import { ReauthPrompt, useReauth, type ReauthOutcome } from '../auth/use-reauth'
import { clearLastListPath } from '../lib/last-list-path'
import FormLabel from '../components/FormLabel'
import { DELETE_ACCOUNT_USER_HEADER } from '../../shared/auth'

// The word the user must type to arm the delete. Compared case-insensitively
// (trimmed) - the friction is in typing the word at all, not in matching case.
const CONFIRM_WORD = 'delete'

// Danger-zone control: permanent, irreversible account deletion. The ON DELETE
// CASCADE off user.id wipes every trace of the user's data (gear, categories,
// lists, list items, packing data, and
// passkeys). There is no undo and no email round-trip.
//
// Two gates, and neither is a password, because there isn't one:
//   1. Type-to-confirm - guards against the fat-finger.
//   2. A FRESH session - guards against the attacker. better-auth's delete-user
//      route enforces this itself when no password is supplied: a session older
//      than freshAge gets 400 SESSION_EXPIRED. Re-authenticating means running a
//      sign-in ceremony again, which mints a new (fresh) session.
//
// So a stolen cookie from a long-lived session cannot delete the account, which
// is the property the old password prompt was really buying.
//
// Every delete names the account the user confirmed (DELETE_ACCOUNT_USER_HEADER),
// and the server refuses if the session now belongs to someone else. The
// session can change under us: re-authenticating with a passkey for another
// account signs that account in, and so does a sign-in in another tab.
export default function DeleteAccountSection() {
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Whether to offer "Use a passkey". Only an account with a passkey can use
  // one; for any other account the browser may offer a passkey that belongs to
  // someone else.
  const [canUsePasskey, setCanUsePasskey] = useState(false)

  // Synchronous in-flight guard: the button is disabled while busy, but a form
  // is still submittable via Enter, and busy is render-derived (lags a
  // synchronous double-submit). This blocks the second submit in the same tick
  // so deleteUser can't fire twice. Shared with the hook so the reauth flows
  // and this form's submit also block each other.
  const submitting = useRef(false)

  const { data: session } = authClient.useSession()
  const confirmed = confirm.trim().toLowerCase() === CONFIRM_WORD

  // The parked action is the user id the user CONFIRMED on submit. A replay
  // after re-authentication sends this id, never the current session's, which
  // may be another account by then.
  const reauth = useReauth<string>({
    run: runDelete,
    email: session?.user.email,
    setBusy,
    setError,
    submitting,
  })

  useEffect(() => {
    if (reauth.pending === null || !passkeysSupported()) return
    let canceled = false
    authClient.passkey
      .listUserPasskeys()
      .then(({ data }) => {
        if (!canceled) setCanUsePasskey((data ?? []).length > 0)
      })
      // A failed load only hides the passkey option. The email link below
      // works for every account, so there is nothing to report.
      .catch(() => {})
    return () => {
      canceled = true
    }
  }, [reauth.pending])

  // Teardown for a deleted account. The hard reload discards in-memory
  // React Query cache and the session atom, but NOT localStorage, so clear
  // the persisted last-list path (both current and legacy keys) first -
  // otherwise the deleted account's list UUID survives into the next
  // session in this browser and RootRedirect would send a future account
  // into the dead list route. Then hard-navigate to a fresh /sign-in.
  function tearDownAndRedirect() {
    clearLastListPath()
    window.location.assign('/sign-in')
  }

  // Runs the delete. Returns 'reauth' when the server refuses for a stale
  // session, so the caller can prompt and replay.
  async function runDelete(userId: string): Promise<ReauthOutcome> {
    try {
      // No password in the body - that omission is what selects better-auth's
      // freshness path over its (now impossible) credential check.
      const { error: deleteError } = await authClient.deleteUser({
        fetchOptions: { headers: { [DELETE_ACCOUNT_USER_HEADER]: userId } },
      })
      if (deleteError) {
        // 400 SESSION_EXPIRED: the session is too old to authorize this.
        // (Distinct from the passkey gate's 403 SESSION_NOT_FRESH - better-auth
        // reports the same concept two ways, and both have to be handled.)
        if (deleteError.code === 'SESSION_EXPIRED') return 'reauth'
        setError(
          authErrorMessage(deleteError, "Couldn't delete your account. Please try again."),
        )
        return 'done'
      }
      // The account and all its data are gone server-side and the session
      // cookie is cleared. A full-document navigation (window.location, NOT a
      // client-side route change) IS the teardown: it tears down the whole SPA,
      // discarding the entire in-memory React Query cache and the better-auth
      // session atom in one step, so no deleted-account data can linger in this
      // tab. /sign-in then loads fresh with no session. Other open tabs fall
      // over on their next request (a 401), which is an acceptable trade for not
      // hand-maintaining a cross-tab teardown channel.
      tearDownAndRedirect()
      return 'done'
    } catch {
      // Indeterminate: better-auth normally returns { error } rather than
      // rejecting, so a throw here means a client/network failure - and the
      // request may have committed the (irreversible) deletion before the
      // response was lost. Bias to the same hard reload: if the account is gone
      // this is correct, and if it somehow survived, the reload just re-lands
      // through the normal session redirect - either way no stale account data
      // is left in memory.
      tearDownAndRedirect()
      return 'done'
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting.current) return
    setError(null)
    // Enter can submit even while the button is disabled; re-check the gate
    // here so a stray Enter can never fire an unconfirmed deletion.
    if (!confirmed) return
    const userId = session?.user.id
    if (!userId) {
      setError("Couldn't tell which account is signed in. Reload the page and try again.")
      return
    }

    submitting.current = true
    try {
      // If the passkey chosen during a later re-authentication belonged to
      // another account, the replay still names this userId: the server
      // refuses and the error says nothing was deleted. SessionCacheGuard
      // then reloads the app for the account that is now signed in.
      await reauth.request(userId)
    } finally {
      // Reached only when we did not navigate; a successful delete tears this
      // component down before this runs.
      submitting.current = false
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="max-w-md space-y-3">
      <p className="text-sm text-gray-600">
        Permanently delete your account and everything in it - gear, lists,
        and passkeys. This cannot be undone.
      </p>
      <div>
        <FormLabel htmlFor="del-confirm">
          Type <span className="font-semibold">delete</span> to confirm
        </FormLabel>
        <input
          id="del-confirm"
          type="text"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}

      {reauth.pending !== null ? (
        <ReauthPrompt
          tone="danger"
          message="You've been signed in a while. Confirm it is you before deleting your account."
          linkSent={reauth.linkSent}
          email={session?.user.email}
          showPasskey={canUsePasskey}
          busy={busy}
          onPasskey={() => void reauth.reauthWithPasskey()}
          onEmail={() => void reauth.reauthWithEmail()}
        />
      ) : (
        <button
          type="submit"
          disabled={busy || !confirmed}
          className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? 'Deleting...' : 'Delete account'}
        </button>
      )}
    </form>
  )
}
