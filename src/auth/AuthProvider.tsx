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

  function reconcileUserId(nextUserId: string | null) {
    const prev = lastUserIdRef.current
    if (prev === undefined) {
      // First reconciliation since mount. The SW cache content
      // belongs to whichever user we're booting as; just seed the ref.
      lastUserIdRef.current = nextUserId
      return
    }
    if (prev === nextUserId) return
    // Identity changed (sign-out, sign-in as a different user, or a
    // stale session reconciliation). Clear the URL-keyed REST cache so
    // no row JSON from the previous user can be served to the next one.
    // Fire-and-forget; failures are silent inside the helper.
    //
    // If we're offline, the cache clear must wait until reconnect: a
    // local clear is technically possible (caches.delete is offline-
    // safe), but wiping the only data the user can still see while
    // disconnected degrades UX to "no data" until a real network
    // response lands. Crucially, do NOT advance lastUserIdRef in the
    // offline branch — the next online auth event (or the 'online'
    // edge listener below) must still see prev !== next so it fires
    // the clear. Advancing the ref here was the bug: it masked the
    // identity change and the cache served the prior user's rows
    // after reconnect.
    if (!isOnline()) return
    lastUserIdRef.current = nextUserId
    void clearSupabaseRestCache()
  }

  useEffect(() => {
    let ignored = false

    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (ignored) return
        if (session) {
          writeOfflineSession(session)
          setSession(session)
          reconcileUserId(session.user.id)
        } else if (error && !isOnline()) {
          const offline = readOfflineSession()
          setSession(offline)
          reconcileUserId(offline?.user.id ?? null)
        } else {
          clearOfflineSession()
          setSession(null)
          reconcileUserId(null)
        }
        setLoading(false)
      })
      .catch(() => {
        if (ignored) return
        if (!isOnline()) {
          const offline = readOfflineSession()
          setSession(offline)
          reconcileUserId(offline?.user.id ?? null)
        }
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (ignored) return
      if (session) {
        writeOfflineSession(session)
        setSession(session)
        reconcileUserId(session.user.id)
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
      setSession(null)
      reconcileUserId(null)
    })

    // Defense-in-depth for the offline-user-switch case. Supabase emits
    // SIGNED_IN cross-tab via localStorage, which may fire while this
    // tab is offline — reconcileUserId then leaves lastUserIdRef
    // pointing at the previous user, waiting for an online auth event
    // to fire the cache clear. But if the new session's token is
    // still valid after reconnect, supabase emits no further event,
    // and the SW cache stays primed with the prior user's rows. The
    // 'online' edge re-asks supabase what the current session is and
    // reconciles, which clears the cache if the identity differs.
    function onWindowOnline() {
      if (ignored) return
      supabase.auth.getSession()
        .then(({ data: { session: current } }) => {
          if (ignored) return
          reconcileUserId(current?.user?.id ?? null)
        })
        .catch(() => {
          // getSession can fail if supabase's storage adapter is in a
          // weird state; the next real auth event will reconcile.
        })
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
