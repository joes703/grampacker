import { useEffect, useRef, useState } from 'react'
import { authClient, passkeysSupported } from '../lib/auth-client'
import { authErrorMessage } from '../auth/auth-errors'
import { ErrorText } from '../auth/auth-ui'
import { authenticatorName } from '../lib/passkey-authenticator-names'

type PasskeyRow = {
  id: string
  name?: string | null
  aaguid?: string | null
  createdAt?: Date | string
}

function createdLabel(createdAt: PasskeyRow['createdAt']): string {
  if (!createdAt) return ''
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

// Inline rename input, same idiom as the list rename rows: select-on-open,
// Enter submits, Escape cancels, blur submits.
function RenameInput({
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
}: {
  draft: string
  onDraftChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      autoFocus
      type="text"
      value={draft}
      aria-label="Passkey name"
      onChange={(e) => onDraftChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={onSubmit}
      className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
    />
  )
}

export default function PasskeySection() {
  const [rows, setRows] = useState<PasskeyRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  // Bump to refetch the list (after add/remove/rename).
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

  // Clearing `renaming` before any await keeps the Enter+blur double-fire
  // (Enter submits, the state swap blurs the input) a no-op on re-entry.
  async function submitRename() {
    if (!renaming) return
    const row = rows?.find((r) => r.id === renaming.id)
    const trimmed = renaming.draft.trim()
    setRenaming(null)
    if (busy || !row || !trimmed) return
    // Submitting the label unchanged is a cancel, not a write - the input
    // is prefilled with the display label (which may be the provider name,
    // not a stored name), and blur submits.
    const display = row.name || authenticatorName(row.aaguid) || ''
    if (trimmed === display) return
    setBusy(true)
    setError(null)
    try {
      const { error: renameError } = await authClient.passkey.updatePasskey({
        id: row.id,
        name: trimmed,
      })
      if (renameError) {
        setError(authErrorMessage(renameError, "Couldn't rename the passkey."))
        return
      }
      setReloadKey((k) => k + 1)
    } catch {
      setError("Couldn't rename the passkey.")
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
        {rows?.map((row) => {
          // Label precedence: user-chosen name, then the authenticator the
          // AAGUID identifies (1Password, Google Password Manager, ...),
          // then the generic fallback. When a custom name wins, the
          // authenticator moves into the detail line so provenance stays
          // visible.
          const provider = authenticatorName(row.aaguid)
          const detail = [
            row.name && provider ? provider : null,
            createdLabel(row.createdAt) ? `added ${createdLabel(row.createdAt)}` : null,
          ]
            .filter(Boolean)
            .join(' - ')
          return (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2"
            >
              {renaming?.id === row.id ? (
                <RenameInput
                  draft={renaming.draft}
                  onDraftChange={(v) => setRenaming({ id: row.id, draft: v })}
                  onSubmit={() => void submitRename()}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <>
                  <div className="min-w-0 text-sm text-gray-900">
                    <span className="font-medium">
                      {row.name || provider || 'Passkey'}
                    </span>
                    {detail && (
                      <span className="ml-2 text-xs text-gray-500">{detail}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      className="text-sm font-medium text-gray-600 hover:underline disabled:opacity-50"
                      onClick={() =>
                        setRenaming({
                          id: row.id,
                          draft: row.name || provider || '',
                        })
                      }
                      disabled={busy}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="text-sm font-medium text-rose-700 hover:underline disabled:opacity-50"
                      onClick={() => void handleDelete(row.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
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
