import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { authClient } from '../lib/auth-client'
import { clearToasts } from '../lib/toast'

// Shared sign-out action for any surface with a sign-out control. Lands on
// /sign-in even when the signOut call rejects: the session cookie may
// already be gone (expired, cleared server-side), and in that state the
// sign-in page is the correct destination either way.
export function useSignOut() {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const signOut = useCallback(async () => {
    if (signingOut) return
    setSigningOut(true)
    // Before the call, not after, and on both paths below: the toast store is
    // module-level and its viewport sits above the authenticated routes, so a
    // live toast survives sign-out. Toasts can now carry an ACTION (Undo a
    // removal), and an action left on screen across a session boundary would
    // fire a write against the list of the user who just left.
    clearToasts()
    try {
      await authClient.signOut()
      void navigate('/sign-in')
    } catch {
      void navigate('/sign-in')
    } finally {
      setSigningOut(false)
    }
  }, [navigate, signingOut])

  return { signingOut, signOut }
}
