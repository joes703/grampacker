import { useCallback, useState } from 'react'
import { authClient } from '../lib/auth-client'
import { clearLastListPath } from '../lib/last-list-path'

// Shared sign-out action for any surface with a sign-out control.
//
// The teardown is a FULL-DOCUMENT navigation, not a client-side route change,
// and that choice is the point of this hook. The QueryClient is a module
// singleton (App.tsx), so a react-router navigate to /sign-in leaves the whole
// SPA alive: every cached query (lists, list items, gear, food, categories,
// packing locations) stays in memory, along with better-auth's session atom.
// The next person to sign in on this browser then gets the previous account's
// rows rendered from cache while their own fetch is still in flight. Reloading
// the document discards all of it in one step, with no hand-maintained list of
// caches to clear that a future feature could silently fall out of. This is
// the same teardown DeleteAccountSection uses, for the same reason.
//
// localStorage survives a reload, so the per-account entry has to go
// explicitly: the last-list path holds the signed-out account's list UUID, and
// RootRedirect's fast path would send the next user straight into it. The
// weight-unit and seen-session keys are device preferences rather than account
// data, so they stay.
//
// We land on /sign-in even when signOut rejects: the session cookie may
// already be gone (expired, cleared server-side), and in that state the
// sign-in page is the correct destination either way. The failure path needs
// the teardown most of all, since it is the one that leaves a populated cache
// behind.
export function useSignOut() {
  const [signingOut, setSigningOut] = useState(false)

  const signOut = useCallback(async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await authClient.signOut()
    } catch {
      // Deliberately swallowed - tear down and redirect regardless.
    }
    clearLastListPath()
    // No setSigningOut(false): assign() only SCHEDULES the navigation, so this
    // component keeps rendering until the document unloads. Leaving the flag
    // set keeps the button disabled across that window rather than re-arming a
    // control whose work is already done.
    window.location.assign('/sign-in')
  }, [signingOut])

  return { signingOut, signOut }
}
