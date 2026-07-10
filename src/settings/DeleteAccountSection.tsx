import { useRef, useState } from 'react'
import { authClient } from '../lib/auth-client'
import { authErrorMessage } from '../auth/auth-errors'
import FormLabel from '../components/FormLabel'

// The word the user must type to arm the delete. Compared case-insensitively
// (trimmed) - the friction is in typing the word at all, not in matching case.
const CONFIRM_WORD = 'delete'

// Danger-zone control: permanent, irreversible account deletion. better-auth's
// deleteUser (server: user.deleteUser.enabled) verifies the password and
// removes the account; the ON DELETE CASCADE off user.id wipes every trace of
// the user's data (gear, categories, lists, list items, passkeys). There is no
// undo and no email round-trip, so this form gates on BOTH the current
// password AND an explicit type-to-confirm before it will fire.
export default function DeleteAccountSection() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Synchronous in-flight guard: the button is disabled while busy, but a form
  // is still submittable via Enter, and busy is render-derived (lags a
  // synchronous double-submit). This blocks the second submit in the same tick
  // so deleteUser can't fire twice (mirrors ChangePasswordForm).
  const submitting = useRef(false)

  const confirmed = confirm.trim().toLowerCase() === CONFIRM_WORD
  const canSubmit = password.length > 0 && confirmed

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting.current) return
    setError(null)
    // Enter can submit even while the button is disabled; re-check the gates
    // here so a stray Enter can never fire an unconfirmed deletion.
    if (!canSubmit) return

    submitting.current = true
    setBusy(true)
    try {
      const { error } = await authClient.deleteUser({ password })
      if (error) {
        // A wrong password comes back as INVALID_PASSWORD; name it precisely.
        // Everything else defers to the shared mapper (429 copy + server
        // message fallback).
        setError(
          error.code === 'INVALID_PASSWORD'
            ? 'Password is incorrect.'
            : authErrorMessage(error, "Couldn't delete your account. Please try again."),
        )
        return
      }
      // The account and all its data are gone server-side and the session
      // cookie is cleared. A full-document navigation (window.location, NOT a
      // client-side route change) IS the teardown: it tears down the whole SPA,
      // discarding the entire in-memory React Query cache and the better-auth
      // session atom in one step, so no deleted-account data can linger in this
      // tab. /sign-in then loads fresh with no session. Other open tabs fall
      // over on their next request (a 401), which is an acceptable trade for not
      // hand-maintaining a cross-tab teardown channel.
      window.location.assign('/sign-in')
    } catch {
      // Indeterminate: better-auth normally returns { error } rather than
      // rejecting, so a throw here means a client/network failure - and the
      // request may have committed the (irreversible) deletion before the
      // response was lost. Bias to the same hard reload: if the account is gone
      // this is correct, and if it somehow survived, the reload just re-lands
      // through the normal session redirect - either way no stale account data
      // is left in memory.
      window.location.assign('/sign-in')
    } finally {
      // Reached only when we did not navigate (the { error } return above); a
      // successful reload tears this component down before this runs.
      setBusy(false)
      submitting.current = false
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-3">
      <p className="text-sm text-gray-600">
        Permanently delete your account and everything in it - gear, lists, and
        passkeys. This cannot be undone.
      </p>
      <div>
        <FormLabel htmlFor="del-password">Current password</FormLabel>
        <input
          id="del-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
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
      <button
        type="submit"
        disabled={busy || !canSubmit}
        className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? 'Deleting...' : 'Delete account'}
      </button>
    </form>
  )
}
