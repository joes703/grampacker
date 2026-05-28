import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearSupabaseRestCache } from '../lib/sw-cache'

const OFFLINE_SESSION_KEY = 'grampacker:last-auth-session'
// Supabase owns sb-<project>-auth-token and may clear it during refresh
// failures. Keep a separate last-known-good copy so an offline reload can
// still render cached app data until the next online auth round-trip decides
// whether the session is truly invalid.

type AuthContextValue = {
  session: Session | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue>({ session: null, loading: true })

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine
}

function readOfflineSession(): Session | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(OFFLINE_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Session>
    return typeof parsed.access_token === 'string' && typeof parsed.refresh_token === 'string'
      ? (parsed as Session)
      : null
  } catch {
    return null
  }
}

function writeOfflineSession(session: Session) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(session))
}

function clearOfflineSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(OFFLINE_SESSION_KEY)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Tracks the active user id across auth events so we can flush the
  // Workbox runtime REST cache when the user actually changes. `undefined`
  // means "not yet seeded" (mount); a concrete user id or null means we've
  // seen at least one auth result. Transitions FROM undefined never clear
  // (the cache content belongs to whichever user we're booting as). See
  // src/lib/sw-cache.ts and vite.config.ts for the surrounding model.
  const lastUserIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    let ignored = false

    // Reconcile the active user id and, on identity change, wipe the
    // URL-keyed SW REST cache BEFORE callers commit the new session
    // to React state. The cache clear runs even when offline: the
    // workbox `supabase-rest` runtime cache holds row JSON
    // KEY'd BY URL (auth lives in the Authorization header, not the
    // URL), so a different user signing in inside the same tab
    // would otherwise be served the previous user's cached data —
    // either while offline (reads land on the SW) or on reconnect
    // (React Query's refetchOnReconnect races StaleWhileRevalidate
    // and the cached response wins). Awaiting the clear here gates
    // every downstream `setSession` so no useQuery scoped to the
    // new user's id can mount until the cache is gone. caches.delete
    // is a local operation; the latency cost is a few ms.
    //
    // First call after mount (prev === undefined) just seeds the ref;
    // the cache content belongs to whoever we're booting as. Same-
    // identity calls are no-ops.
    async function reconcileUserId(nextUserId: string | null) {
      const prev = lastUserIdRef.current
      if (prev === undefined) {
        lastUserIdRef.current = nextUserId
        return
      }
      if (prev === nextUserId) return
      try {
        await clearSupabaseRestCache()
      } catch {
        // helper is silent-on-failure internally; if it threw despite
        // that, still advance the ref so a steady-state same-identity
        // event afterwards doesn't re-fire the clear in an infinite
        // loop.
      }
      lastUserIdRef.current = nextUserId
    }

    async function loadInitialSession() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (ignored) return
        if (session) {
          writeOfflineSession(session)
          await reconcileUserId(session.user.id)
          if (ignored) return
          setSession(session)
        } else if (error && !isOnline()) {
          const offline = readOfflineSession()
          await reconcileUserId(offline?.user.id ?? null)
          if (ignored) return
          setSession(offline)
        } else {
          clearOfflineSession()
          await reconcileUserId(null)
          if (ignored) return
          setSession(null)
        }
      } catch {
        if (ignored) return
        if (!isOnline()) {
          const offline = readOfflineSession()
          await reconcileUserId(offline?.user.id ?? null)
          if (!ignored) setSession(offline)
        }
      } finally {
        if (!ignored) setLoading(false)
      }
    }
    void loadInitialSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (ignored) return
      if (session) {
        writeOfflineSession(session)
        await reconcileUserId(session.user.id)
        if (ignored) return
        setSession(session)
        return
      }

      if (!isOnline()) {
        // Offline null-session events are treated as transient refresh
        // failures. A real sign-out or invalid refresh token will be
        // reconciled by the next online auth event/getSession result.
        // Skip reconcileUserId here so the previous online user id stays
        // recorded; flipping it to null offline would cause a spurious
        // cache clear on the next online auth event.
        return
      }

      clearOfflineSession()
      await reconcileUserId(null)
      if (ignored) return
      setSession(null)
    })

    // Defense-in-depth for the offline-user-switch case. If supabase
    // doesn't fire a fresh auth event after reconnect (e.g. the new
    // user's token is still valid), the 'online' edge re-runs
    // reconciliation against the current session. The primary clear
    // already happens at the offline auth event (above) since the
    // online guard was removed; this is belt-and-braces for cases
    // where that event was somehow missed.
    async function onWindowOnline() {
      if (ignored) return
      try {
        const { data: { session: current } } = await supabase.auth.getSession()
        if (ignored) return
        await reconcileUserId(current?.user?.id ?? null)
      } catch {
        // next auth event will reconcile
      }
    }
    window.addEventListener('online', onWindowOnline)

    return () => {
      ignored = true
      subscription.unsubscribe()
      window.removeEventListener('online', onWindowOnline)
    }
  }, [])

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
