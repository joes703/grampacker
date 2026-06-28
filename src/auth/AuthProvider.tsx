import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type AuthContextValue = {
  session: Session | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue>({ session: null, loading: true })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Tracks the active user id across auth events so we drop the in-memory
  // React Query cache when the user actually changes. `undefined` means
  // "not yet seeded" (mount); a concrete id or null means we've seen at
  // least one auth result. A transition FROM undefined never clears (the
  // cache belongs to whoever we're booting as).
  const lastUserIdRef = useRef<string | null | undefined>(undefined)
  const queryClient = useQueryClient()

  useEffect(() => {
    let ignored = false

    // On identity change (including sign-out, where nextUserId is null),
    // drop the in-memory React Query cache BEFORE callers commit the new
    // session to state. Most query keys (['gear-items'], ['lists'],
    // ['list-items', id], ...) are NOT user-scoped, and the global 30s
    // staleTime means a query re-mounting right after an account switch
    // would otherwise be served the previous user's data from memory
    // without a refetch. queryClient.clear() drops every cached query and
    // observer; the next mount starts cold under the new identity.
    //
    // First call after mount (prev === undefined) just seeds the ref (no
    // clear - that would throw away the boot user's warm cache).
    // Same-identity calls are no-ops.
    function reconcileUserId(nextUserId: string | null) {
      const prev = lastUserIdRef.current
      if (prev === undefined) {
        lastUserIdRef.current = nextUserId
        return
      }
      if (prev === nextUserId) return
      queryClient.clear()
      lastUserIdRef.current = nextUserId
    }

    async function loadInitialSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (ignored) return
        reconcileUserId(session?.user.id ?? null)
        if (ignored) return
        setSession(session)
      } catch {
        // getSession failed to resolve a session (e.g. a transient network
        // failure on cold load). Treat it as signed-out; a later auth event
        // reconciles if a session becomes available.
        if (ignored) return
        reconcileUserId(null)
        if (ignored) return
        setSession(null)
      } finally {
        if (!ignored) setLoading(false)
      }
    }
    void loadInitialSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (ignored) return
      reconcileUserId(nextSession?.user.id ?? null)
      if (ignored) return
      setSession(nextSession)
    })

    return () => {
      ignored = true
      subscription.unsubscribe()
    }
    // queryClient is a stable instance from QueryClientProvider; listed to
    // satisfy exhaustive-deps without re-running the effect.
  }, [queryClient])

  const value = useMemo(() => ({ session, loading }), [session, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
