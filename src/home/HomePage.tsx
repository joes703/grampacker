import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { healthResponseSchema } from '../../shared/health'
import { authClient } from '../lib/auth-client'
import PasskeySection from './PasskeySection'

type ApiHealth = 'checking' | 'ok' | 'down'

const HEALTH_STYLE: Record<ApiHealth, string> = {
  checking: 'bg-gray-100 text-gray-600',
  ok: 'bg-emerald-100 text-emerald-800',
  down: 'bg-rose-100 text-rose-800',
}

const HEALTH_LABEL: Record<ApiHealth, string> = {
  checking: 'checking api...',
  ok: 'api + d1 healthy',
  down: 'api unreachable',
}

// Placeholder home: proves the session-gated shell that the gear and list
// pages drop into in later phases. Keeps the deploy smoke signal (health
// badge) from phase 0.
export default function HomePage() {
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()
  const [health, setHealth] = useState<ApiHealth>('checking')
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)),
      )
      .then((body) => {
        if (cancelled) return
        const parsed = healthResponseSchema.safeParse(body)
        setHealth(parsed.success && parsed.data.ok ? 'ok' : 'down')
      })
      .catch(() => {
        if (!cancelled) setHealth('down')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await authClient.signOut()
      navigate('/sign-in')
    } catch {
      // Session cookie may already be gone; landing on sign-in is correct
      // either way.
      navigate('/sign-in')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight text-gray-900">grampacker</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{session?.user.email}</span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {signingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-gray-700">
          Signed in as <span className="font-medium">{session?.user.name}</span>.
          Gear and lists arrive with the next phases.
        </p>
        <span
          className={`mt-4 inline-block rounded-full px-3 py-1 text-xs font-medium ${HEALTH_STYLE[health]}`}
        >
          {HEALTH_LABEL[health]}
        </span>
        <PasskeySection />
      </div>
    </main>
  )
}
