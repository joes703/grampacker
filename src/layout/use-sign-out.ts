import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { authClient } from '../lib/auth-client'

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
    try {
      await authClient.signOut()
      navigate('/sign-in')
    } catch {
      navigate('/sign-in')
    } finally {
      setSigningOut(false)
    }
  }, [navigate, signingOut])

  return { signingOut, signOut }
}
