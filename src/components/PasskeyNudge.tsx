import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Fingerprint } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useOnline } from '../lib/use-online'
import { isPasskeySupported } from '../lib/passkey'
import { queryKeys } from '../lib/queries'
import { supabase } from '../lib/supabase'

const PENDING_KEY = 'grampacker:passkey-nudge-pending'
const dismissedKey = (userId: string) => `grampacker:passkey-nudge-dismissed:${userId}`

// The nudge is a ONE-SHOT signal: LoginPage sets a sessionStorage flag on a
// successful email/password sign-in, and the authenticated shell consumes it
// exactly once. We memoize the consume at module scope so StrictMode's
// double-invoked render/initializer (and any remount) can't read-then-miss
// the flag or remove it twice — the first caller wins, everyone else gets
// the cached verdict. The memo lives for the page load; a real new sign-in
// is a fresh page (or at least a fresh LoginPage write we re-evaluate
// against the cached verdict), which is acceptable for a one-time prompt.
let consumedPending: boolean | null = null
function consumePasskeyNudgePending(): boolean {
  if (consumedPending !== null) return consumedPending
  let pending = false
  try {
    pending = sessionStorage.getItem(PENDING_KEY) === '1'
    if (pending) sessionStorage.removeItem(PENDING_KEY)
  } catch {
    pending = false
  }
  consumedPending = pending
  return pending
}

// Called by LoginPage on a successful email/password sign-in so the shell
// shows the nudge once. Passkey sign-in deliberately does NOT call this —
// someone who just used a passkey has no reason to be nudged to add one.
//
// Resets the module-level consume memo so a SECOND sign-in within the same
// page load (e.g. sign out, then sign back in without a full reload) is
// evaluated fresh. Without this, consumePasskeyNudgePending() would return
// the first sign-in's cached verdict and the shell would ignore the new flag.
export function markPasskeyNudgePending() {
  try {
    sessionStorage.setItem(PENDING_KEY, '1')
    consumedPending = null
  } catch {
    // best-effort: if sessionStorage is unavailable the nudge simply
    // doesn't appear, which is a harmless degradation.
  }
}

function isDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(dismissedKey(userId)) === '1'
  } catch {
    return false
  }
}

// Records that this user no longer wants the passkey nudge. Exported so the
// Settings "Add a passkey" success path can mark it dismissed too: once they
// have a passkey, never nudge again.
export function dismissPasskeyNudge(userId: string) {
  try {
    localStorage.setItem(dismissedKey(userId), '1')
  } catch {
    // best-effort; a private-mode write failure just means we may nudge
    // again next sign-in, which is harmless.
  }
}

// Compact, non-modal strip shown once just after an email/password sign-in,
// offering to set up a passkey. Renders nothing unless ALL hold: the
// one-shot flag was set this sign-in, the browser supports passkeys, the
// user is signed in and online, they haven't dismissed it for this account,
// and they currently have zero passkeys. "Add passkey" deep-links to
// Settings (we never launch the WebAuthn ceremony from here); "Not now"
// dismisses it permanently for this account.
export default function PasskeyNudge() {
  const { session } = useAuth()
  const online = useOnline()
  const navigate = useNavigate()
  const userId = session?.user.id
  const [pending] = useState(consumePasskeyNudgePending)
  const [hidden, setHidden] = useState(false)

  const eligible =
    pending &&
    !hidden &&
    !!userId &&
    online &&
    isPasskeySupported() &&
    !isDismissed(userId)

  // Only nudge users who have no passkey yet. Shares the Settings query key
  // so the two surfaces hit one cached list, and stays disabled (no network)
  // until every cheaper precondition has already passed.
  const { data: passkeys } = useQuery({
    queryKey: queryKeys.passkeys(userId ?? ''),
    enabled: eligible,
    queryFn: async () => {
      const { data, error } = await supabase.auth.passkey.list()
      if (error) throw error
      return data ?? []
    },
  })

  // Hold render until the list resolves so the strip never flashes for a
  // user who turns out to already have a passkey.
  if (!eligible || passkeys === undefined || passkeys.length > 0) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 print:hidden">
      <Fingerprint size={16} aria-hidden="true" className="shrink-0" />
      <span className="font-medium">Sign in faster next time with a passkey.</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            // Hide for this session only — do NOT persist dismissal here, so
            // a user who bails out of Settings without adding one is nudged
            // again next sign-in. Settings marks it dismissed on success.
            setHidden(true)
            navigate('/settings#passkeys')
          }}
          className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          Add passkey
        </button>
        <button
          type="button"
          onClick={() => {
            if (userId) dismissPasskeyNudge(userId)
            setHidden(true)
          }}
          className="rounded-lg border border-blue-300 bg-white px-3 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
