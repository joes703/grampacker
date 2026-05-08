import { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const OFFLINE_SESSION_KEY = 'grampacker:last-auth-session'

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

  useEffect(() => {
    let ignored = false

    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (ignored) return
        if (session) {
          writeOfflineSession(session)
          setSession(session)
        } else if (error && !isOnline()) {
          setSession(readOfflineSession())
        } else {
          clearOfflineSession()
          setSession(null)
        }
        setLoading(false)
      })
      .catch(() => {
        if (ignored) return
        if (!isOnline()) {
          setSession(readOfflineSession())
        }
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (ignored) return
      if (session) {
        writeOfflineSession(session)
      } else {
        clearOfflineSession()
      }
      setSession(session)
    })

    return () => {
      ignored = true
      subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
