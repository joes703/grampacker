import { useEffect, useRef, useState } from 'react'
import { authClient, passkeysSupported } from '../lib/auth-client'
import { authErrorMessage } from '../auth/auth-errors'
import { ErrorText } from '../auth/auth-ui'
import { authenticatorName } from '../lib/passkey-authenticator-names'
import FormLabel from '../components/FormLabel'
import { ApiError, apiFetchVoid } from '../lib/api'

type PasskeyRow = {
  id: string
  name?: string | null
  aaguid?: string | null
  createdAt?: Date | string
}

// Every passkey mutation needs a server-side fresh-auth proof: a valid
// session alone must not be able to plant a credential (SECURITY.md). The
// server grants a 10-minute window from POST /api/me/reauth; we assume a
// SHORTER one so we prompt before the server would reject, rather than after.
// This clock is only an optimization - the server is the authority, and a 403
// REAUTH_REQUIRED at any point re-opens the prompt.
const FRESH_AUTH_ASSUMED_MS = 9 * 60 * 1000

// A passkey mutation, captured so it can be replayed after the user confirms
// their password. Actions are data, not closures, so the retry path is
// obvious and testable.
type PasskeyAction =
  | { kind: 'add' }
  | { kind: 'delete'; id: string }
  | { kind: 'rename'; id: string; name: string }

// The gate's refusal (server/middleware/fresh-auth.ts). better-auth's client
// error type does not declare `code`, though it passes the field through, so
// narrow it here rather than trusting the declared shape. Both the status AND
// the code are checked: better-auth has its own reasons to answer 403 (a
// failed origin check, say), and those must not masquerade as "ask for the
// password again".
function isReauthRequired(error: { status: number }): boolean {
  return (
    error.status === 403 &&
    (error as { code?: unknown }).code === 'REAUTH_REQUIRED'
  )
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
  // Synchronous re-entrancy guard for submitRename: Enter and blur can both
  // fire against the same render, whose closure still sees renaming !== null
  // and busy === false (state updates only land on re-render). A ref flips
  // synchronously, so the second delivery bails before the network call.
  const submittingRename = useRef(false)
  // Bump to refetch the list (after add/remove/rename).
  const [reloadKey, setReloadKey] = useState(0)
  // The mutation waiting on a password confirmation, and the password being
  // typed for it. Non-null pending == the prompt is open.
  const [pending, setPending] = useState<PasskeyAction | null>(null)
  const [password, setPassword] = useState('')
  const submittingReauth = useRef(false)
  // When we believe the server's fresh-auth window closes. Never persisted:
  // a reload should re-prompt, and the server decides regardless.
  const freshUntil = useRef(0)

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

  // Runs a mutation against better-auth. Returns 'reauth' when the server
  // refuses for want of a fresh-auth proof, so the caller can prompt and
  // replay - every other outcome is terminal and already reported.
  async function runAction(action: PasskeyAction): Promise<'done' | 'reauth'> {
    const failure = {
      add: "Couldn't add the passkey.",
      delete: "Couldn't remove the passkey.",
      rename: "Couldn't rename the passkey.",
    }[action.kind]

    try {
      const result =
        action.kind === 'add'
          ? await authClient.passkey.addPasskey()
          : action.kind === 'delete'
            ? await authClient.passkey.deletePasskey({ id: action.id })
            : await authClient.passkey.updatePasskey({
                id: action.id,
                name: action.name,
              })

      if (result?.error) {
        // The gate rejected us: the window lapsed mid-flight, or another tab
        // signed out. Drop our optimistic clock and let the caller prompt.
        if (isReauthRequired(result.error)) {
          freshUntil.current = 0
          return 'reauth'
        }
        setError(authErrorMessage(result.error, failure))
        return 'done'
      }
      setReloadKey((k) => k + 1)
      return 'done'
    } catch {
      // For 'add', the overwhelmingly common path here is the user dismissing
      // the browser's passkey prompt - not a failure worth alarming about.
      setError(
        action.kind === 'add' ? 'Passkey setup was cancelled or failed.' : failure,
      )
      return 'done'
    }
  }

  // The single door for every passkey mutation. If we believe the fresh-auth
  // window is open, go straight through; otherwise park the action and ask
  // for the password first.
  async function requestAction(action: PasskeyAction) {
    if (busy || pending) return
    setError(null)

    if (Date.now() >= freshUntil.current) {
      setPending(action)
      return
    }

    setBusy(true)
    try {
      if ((await runAction(action)) === 'reauth') setPending(action)
    } finally {
      setBusy(false)
    }
  }

  // Confirms the password, then replays the action that needed it.
  async function submitReauth(e: React.FormEvent) {
    e.preventDefault()
    const action = pending
    if (!action || submittingReauth.current || !password) return

    submittingReauth.current = true
    setBusy(true)
    setError(null)
    try {
      await apiFetchVoid('/me/reauth', { method: 'POST', body: { password } })
      freshUntil.current = Date.now() + FRESH_AUTH_ASSUMED_MS
      setPassword('')
      setPending(null)
      // If the server rejects even now, something changed underneath us
      // (signed out elsewhere). Re-prompt rather than swallow it.
      if ((await runAction(action)) === 'reauth') setPending(action)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'Password is incorrect.'
          : err instanceof ApiError && err.status === 429
            ? 'Too many attempts. Try again in a few minutes.'
            : "Couldn't confirm your password.",
      )
    } finally {
      submittingReauth.current = false
      setBusy(false)
    }
  }

  function cancelReauth() {
    setPending(null)
    setPassword('')
    setError(null)
  }

  async function submitRename() {
    if (!renaming || submittingRename.current) return
    submittingRename.current = true
    const row = rows?.find((r) => r.id === renaming.id)
    const trimmed = renaming.draft.trim()
    setRenaming(null)
    if (busy || !row || !trimmed) {
      submittingRename.current = false
      return
    }
    // Submitting the label unchanged is a cancel, not a write - the input
    // is prefilled with the display label (which may be the provider name,
    // not a stored name), and blur submits.
    const display = row.name || authenticatorName(row.aaguid) || ''
    if (trimmed === display) {
      submittingRename.current = false
      return
    }
    try {
      // Rename is a mutation like any other, so it goes through the same gate.
      // The rule is deliberately flat - "every passkey mutation requires fresh
      // auth" - because a rule with exceptions is one nobody can audit.
      await requestAction({ kind: 'rename', id: row.id, name: trimmed })
    } finally {
      submittingRename.current = false
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
                      onClick={() => void requestAction({ kind: 'delete', id: row.id })}
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
        {pending ? (
          // Confirming the password mints a short-lived server-side proof;
          // the parked mutation replays as soon as it lands. Adding, removing
          // and renaming all pass through here - a hijacked session must not
          // be able to plant a credential on its own.
          <form onSubmit={(e) => void submitReauth(e)} className="space-y-2">
            <p className="text-sm text-gray-600">
              {pending.kind === 'add'
                ? 'Confirm your password to add a passkey.'
                : pending.kind === 'delete'
                  ? 'Confirm your password to remove this passkey.'
                  : 'Confirm your password to rename this passkey.'}
            </p>
            <FormLabel htmlFor="reauth-password">Password</FormLabel>
            <input
              id="reauth-password"
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={busy || !password}
              >
                {busy ? 'Confirming...' : 'Confirm'}
              </button>
              <button
                type="button"
                className="text-sm font-medium text-gray-600 hover:underline"
                onClick={cancelReauth}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void requestAction({ kind: 'add' })}
            disabled={busy}
          >
            {busy ? 'Working...' : 'Add a passkey'}
          </button>
        )}
      </div>
    </section>
  )
}
