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

// A gated passkey mutation, captured so it can be replayed once the user has
// re-authenticated. Actions are data, not closures, so the retry path is
// obvious and testable.
type PasskeyAction = { kind: 'add' } | { kind: 'delete'; id: string }

// Adding or removing a passkey needs a FRESH session - one created by a recent
// sign-in ceremony (server/middleware/fresh-auth.ts). Renaming does not; it is
// a display label.
//
// Two different refusals mean the same thing, and both must be caught:
//   - 403 REAUTH_REQUIRED  - our own gate, on delete-passkey.
//   - 403 SESSION_NOT_FRESH - better-auth's freshSessionMiddleware, which the
//     passkey plugin mounts on the two REGISTER endpoints itself.
// Missing the second would strand "Add a passkey" on a raw error message with
// no way forward. The status alone is not enough to key on: better-auth answers
// 403 for other reasons (a failed origin check), and those must not masquerade
// as "just re-authenticate".
//
// better-auth's client error type does not declare `code` even though it passes
// the field through, so it is narrowed here rather than trusted.
function isReauthRequired(error: { status: number }): boolean {
  const code = (error as { code?: unknown }).code
  return (
    error.status === 403 &&
    (code === 'REAUTH_REQUIRED' || code === 'SESSION_NOT_FRESH')
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
  // The mutation parked behind re-authentication. Non-null == the prompt is up.
  const [pending, setPending] = useState<PasskeyAction | null>(null)
  const submittingReauth = useRef(false)
  // Set once a recovery link has been sent, so the prompt stops offering to
  // send another and tells the user where to look instead.
  const [linkSent, setLinkSent] = useState(false)

  const { data: session } = authClient.useSession()

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
    const failure =
      action.kind === 'add'
        ? "Couldn't add the passkey."
        : "Couldn't remove the passkey."

    try {
      const result =
        action.kind === 'add'
          ? await authClient.passkey.addPasskey()
          : await authClient.passkey.deletePasskey({ id: action.id })

      if (result?.error) {
        // Stale session. Park the action and ask the user to prove it is them.
        if (isReauthRequired(result.error)) return 'reauth'
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

  // The single door for the GATED mutations (add, remove). Rename does not come
  // through here.
  //
  // We just TRY, and prompt only if the server refuses. There is no client-side
  // freshness clock: the session's age is the server's business, and a second
  // copy of that rule here could only drift out of step with it. This is safe to
  // do optimistically because better-auth fetches the register options from the
  // server BEFORE it opens the browser's passkey dialog - so a stale session is
  // refused without the user ever seeing a biometric prompt that was doomed.
  async function requestAction(action: PasskeyAction) {
    if (busy || pending) return
    setError(null)
    setBusy(true)
    try {
      if ((await runAction(action)) === 'reauth') setPending(action)
    } finally {
      setBusy(false)
    }
  }

  // Re-authenticate with a passkey, then replay the parked action.
  //
  // Signing in again mints a NEW session, and a new session is a fresh one -
  // that is the whole mechanism. It replaces the old "type your password"
  // prompt with a strictly stronger proof: a WebAuthn assertion with user
  // verification, which proves the human, not just possession of a secret.
  async function reauthWithPasskey() {
    const action = pending
    if (!action || submittingReauth.current) return

    submittingReauth.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.signIn.passkey()
      if (result?.error) {
        setError(authErrorMessage(result.error, "Couldn't confirm it was you."))
        return
      }
      setPending(null)
      // If the server still refuses, something changed underneath us (signed
      // out elsewhere). Re-park rather than swallow it.
      if ((await runAction(action)) === 'reauth') setPending(action)
    } catch {
      setError('Passkey confirmation was cancelled or failed.')
    } finally {
      submittingReauth.current = false
      setBusy(false)
    }
  }

  // The fallback, and the reason a user with NO passkey is never stuck: you
  // cannot re-assert a credential you do not have. Someone who signed in by
  // email days ago, never enrolled a passkey, and now wants to - their session
  // is stale, and a passkey prompt would be a door with no key. So offer the
  // same email link that got them here.
  async function reauthWithEmail() {
    const email = session?.user.email
    if (!email || submittingReauth.current) return

    submittingReauth.current = true
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
      submittingReauth.current = false
      setBusy(false)
    }
  }

  function cancelReauth() {
    setPending(null)
    setLinkSent(false)
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
    setBusy(true)
    setError(null)
    try {
      // No fresh-auth prompt here, unlike add and remove: a rename changes the
      // label on a credential, never which credentials can sign in.
      const result = await authClient.passkey.updatePasskey({
        id: row.id,
        name: trimmed,
      })
      if (result?.error) {
        setError(authErrorMessage(result.error, "Couldn't rename the passkey."))
        return
      }
      setReloadKey((k) => k + 1)
    } catch {
      setError("Couldn't rename the passkey.")
    } finally {
      submittingRename.current = false
      setBusy(false)
    }
  }

  // No WebAuthn in this browser. Say so rather than rendering nothing: the
  // account is not broken - email links still work - but the user cannot manage
  // credentials here, and a blank space would not explain why.
  if (!passkeysSupported()) {
    return (
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-gray-900">Passkeys</h2>
        <p className="mt-1 text-sm text-gray-600">
          This browser doesn't support passkeys. You can still sign in with an
          email link, and add a passkey later from a browser that does.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-gray-900">Passkeys</h2>
      <p className="mt-1 text-sm text-gray-600">
        Your passkeys are how you sign in{session?.user.email ? ` as ${session.user.email}` : ''}.
        Each one lives on a single device, so add one per device you use.
      </p>
      <div className="mt-3 space-y-2">
        {rows === null && !error && (
          <p className="text-sm text-gray-500">Loading...</p>
        )}
        {/* Not decoration: with no passkey, every sign-in costs an inbox
            round-trip, and losing the mailbox loses the account. */}
        {rows?.length === 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No passkeys yet. Add one and you can sign in with your screen lock
            instead of waiting for an email each time.
          </p>
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
          // The session is too old to change which credentials can sign in.
          // Re-authenticating mints a new session, which IS a fresh one, and the
          // parked mutation replays the moment it lands.
          //
          // Two ways out, because one of them is not always available: a user
          // with no passkey cannot re-assert one, and that is exactly the user
          // who most needs to add their first. The email link is what keeps that
          // case from being a dead end.
          <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-sm text-gray-700">
              {pending.kind === 'add'
                ? 'Confirm it is you to add a passkey.'
                : 'Confirm it is you to remove this passkey.'}
            </p>
            {linkSent ? (
              <p className="text-sm text-gray-600">
                Sign-in link sent to {session?.user.email}. Open it, then try
                again.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {rows && rows.length > 0 && (
                  <button
                    type="button"
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    onClick={() => void reauthWithPasskey()}
                    disabled={busy}
                  >
                    {busy ? 'Confirming...' : 'Use a passkey'}
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => void reauthWithEmail()}
                  disabled={busy}
                >
                  Email me a link
                </button>
                <button
                  type="button"
                  className="text-sm font-medium text-gray-600 hover:underline"
                  onClick={cancelReauth}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
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
