import { useRef, useState } from 'react'
import { authClient, passkeysSupported } from '../lib/auth-client'
import InlineRenameInput from '../components/InlineRenameInput'
import { authErrorMessage } from '../auth/auth-errors'
import { ErrorText } from '../auth/auth-ui'
import { ReauthPrompt, useReauth, type ReauthOutcome } from '../auth/use-reauth'
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
// sign-in ceremony (the deny-by-default hooks.before gate in server/auth.ts).
// Renaming does not; it is a display label.
//
// Two refusal codes mean the same thing, and both must be caught:
//   - 403 SESSION_NOT_FRESH - the current dialect: the auth.ts gate and
//     better-auth's own freshSessionMiddleware (which the passkey plugin
//     mounts on the two REGISTER endpoints) both speak it.
//   - 403 REAUTH_REQUIRED   - an older server code. The server no longer
//     sends it; it is still accepted so a tab and a server on different
//     versions still prompt instead of stranding.
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


export default function PasskeySection() {
  // better-auth's own query: it refetches after add, delete and rename.
  const passkeys = authClient.useListPasskeys()
  const rows: PasskeyRow[] | null = passkeys.data ?? null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  // Synchronous re-entrancy guard for submitRename: Enter and blur can both
  // fire against the same render, whose closure still sees renaming !== null
  // and busy === false (state updates only land on re-render). A ref flips
  // synchronously, so the second delivery bails before the network call.
  const submittingRename = useRef(false)
  const { data: session } = authClient.useSession()

  // Parks a refused gated mutation and replays it after the user
  // re-authenticates (src/auth/use-reauth.tsx owns the machine).
  const reauth = useReauth<PasskeyAction>({
    run: runAction,
    email: session?.user.email,
    setBusy,
    setError,
  })

  // Runs a mutation against better-auth. Returns 'reauth' when the server
  // refuses for want of a fresh-auth proof, so the caller can prompt and
  // replay - every other outcome is terminal and already reported.
  async function runAction(action: PasskeyAction): Promise<ReauthOutcome> {
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
      return 'done'
    } catch {
      // For 'add', the overwhelmingly common path here is the user dismissing
      // the browser's passkey prompt - not a failure worth alarming about.
      setError(
        action.kind === 'add' ? 'Passkey setup was canceled or failed.' : failure,
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
    if (busy || reauth.pending) return
    await reauth.request(action)
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
      }
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
      <p className="text-sm text-gray-600">
        This browser doesn't support passkeys. You can still sign in with an
        email link, and add a passkey later from a browser that does.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {session?.user.email && (
        <p className="text-sm text-gray-600">Signed in as {session.user.email}.</p>
      )}
      <div className="space-y-2">
        {passkeys.isPending && <p className="text-sm text-gray-500">Loading...</p>}
        {passkeys.error && (
          <ErrorText message={authErrorMessage(passkeys.error, "Couldn't load your passkeys.")} />
        )}
        {/* Not decoration: with no passkey, every sign-in costs an inbox
            round-trip, and losing the mailbox loses the account. */}
        {rows?.length === 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No passkeys yet. Without one, every sign-in needs an email link.
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
                <InlineRenameInput
                  value={renaming.draft}
                  onChange={(v) => setRenaming({ id: row.id, draft: v })}
                  onSubmit={() => void submitRename()}
                  onCancel={() => setRenaming(null)}
                  ariaLabel="Passkey name"
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
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
        {reauth.pending ? (
          // The session is too old to change which credentials can sign in.
          // Re-authenticating mints a new session, which IS a fresh one, and the
          // parked mutation replays the moment it lands.
          //
          // A user with no passkey cannot re-assert one, and that is exactly
          // the user who most needs to add their first - so the passkey button
          // appears only when there is a passkey to use, and the email link
          // keeps the zero-passkey case from being a dead end.
          <ReauthPrompt
            tone="neutral"
            message={
              reauth.pending.kind === 'add'
                ? 'Confirm it is you to add a passkey.'
                : 'Confirm it is you to remove this passkey.'
            }
            linkSent={reauth.linkSent}
            email={session?.user.email}
            showPasskey={!!rows && rows.length > 0}
            busy={busy}
            onPasskey={() => void reauth.reauthWithPasskey()}
            onEmail={() => void reauth.reauthWithEmail()}
            onCancel={reauth.cancel}
          />
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
    </div>
  )
}
