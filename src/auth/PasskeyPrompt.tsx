import { useState } from 'react'
import Modal from '../components/Modal'
import { authClient } from '../lib/auth-client'
import { authErrorMessage, isReauthRequired } from './auth-errors'
import { ErrorText, PRIMARY_BUTTON } from './auth-ui'

// Offered once per browser, right after a sign-in by link
// (link-sign-in-prompt.ts decides when). A person with no passkey on this
// device needs their mailbox for every sign-in here.
//
// The session was just created, so it is fresh and adding a passkey needs no
// re-authentication. If it somehow is not, Settings has the full re-auth
// flow; this dialog does not copy it.
export default function PasskeyPrompt({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.passkey.addPasskey()
      if (result?.error) {
        setError(
          isReauthRequired(result.error)
            ? "Couldn't add the passkey here. Add one in Settings."
            : authErrorMessage(result.error, "Couldn't add the passkey."),
        )
        return
      }
      onClose()
    } catch {
      // Usually the person closed the browser's passkey dialog.
      setError('Passkey setup was canceled or failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Sign in faster next time"
      header
      preventDismiss={busy}
      className="w-full max-w-sm"
    >
      <div className="space-y-4 px-5 pb-5 pt-2">
        <p className="text-sm text-gray-700">
          Add a passkey to this device. Next time, you can sign in with your
          fingerprint, face or PIN instead of a sign-in link.
        </p>
        <ErrorText message={error} />
        <div className="space-y-2">
          <button type="button" className={PRIMARY_BUTTON} onClick={() => void add()} disabled={busy}>
            {busy ? 'Adding...' : 'Add a passkey'}
          </button>
          <button
            type="button"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            onClick={onClose}
            disabled={busy}
          >
            Not now
          </button>
        </div>
        <p className="text-xs text-gray-500">You can add or remove passkeys in Settings.</p>
      </div>
    </Modal>
  )
}
