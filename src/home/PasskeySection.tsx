import { useEffect, useState } from 'react'
import { authClient, passkeysSupported } from '../lib/auth-client'
import { authErrorMessage } from '../auth/auth-errors'
import { ErrorText } from '../auth/auth-ui'

type PasskeyRow = {
  id: string
  name?: string | null
  createdAt?: Date | string
}

function createdLabel(createdAt: PasskeyRow['createdAt']): string {
  if (!createdAt) return ''
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

export default function PasskeySection() {
  const [rows, setRows] = useState<PasskeyRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bump to refetch the list (after add/remove).
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    authClient.passkey
      .listUserPasskeys()
      .then(({ data, error: listError }) => {
        if (cancelled) return
        if (listError) {
          setError(authErrorMessage(listError, "Couldn't load your passkeys."))
          return
        }
        setRows(data ?? [])
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your passkeys.")
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  async function handleAdd() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.passkey.addPasskey()
      if (result?.error) {
        setError(authErrorMessage(result.error, "Couldn't add the passkey."))
        return
      }
      setReloadKey((k) => k + 1)
    } catch {
      // Most common path: the user dismissed the browser's passkey prompt.
      setError('Passkey setup was cancelled or failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { error: deleteError } = await authClient.passkey.deletePasskey({ id })
      if (deleteError) {
        setError(authErrorMessage(deleteError, "Couldn't remove the passkey."))
        return
      }
      setReloadKey((k) => k + 1)
    } catch {
      setError("Couldn't remove the passkey.")
    } finally {
      setBusy(false)
    }
  }

  if (!passkeysSupported()) return null

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-gray-900">Passkeys</h2>
      <p className="mt-1 text-sm text-gray-600">
        Sign in without a password using your device's screen lock or security
        key.
      </p>
      <div className="mt-3 space-y-2">
        {rows === null && !error && (
          <p className="text-sm text-gray-500">Loading...</p>
        )}
        {rows?.length === 0 && (
          <p className="text-sm text-gray-500">No passkeys yet.</p>
        )}
        {rows?.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2"
          >
            <div className="text-sm text-gray-900">
              {row.name || 'Passkey'}
              {createdLabel(row.createdAt) && (
                <span className="ml-2 text-xs text-gray-500">
                  added {createdLabel(row.createdAt)}
                </span>
              )}
            </div>
            <button
              type="button"
              className="text-sm font-medium text-rose-700 hover:underline disabled:opacity-50"
              onClick={() => void handleDelete(row.id)}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        ))}
        <ErrorText message={error} />
        <button
          type="button"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          onClick={() => void handleAdd()}
          disabled={busy}
        >
          {busy ? 'Working...' : 'Add a passkey'}
        </button>
      </div>
    </section>
  )
}
