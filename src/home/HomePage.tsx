import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { healthResponseSchema } from '../../shared/health'
import { apiFetch } from '../lib/api'
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

// Placeholder home: renders inside AppShell (which owns the header and
// sign-out). Keeps the deploy smoke signal (health badge) from phase 0.
export default function HomePage() {
  const { data: session } = authClient.useSession()
  const [health, setHealth] = useState<ApiHealth>('checking')

  useEffect(() => {
    let cancelled = false
    apiFetch('/health', healthResponseSchema)
      .then((body) => {
        if (!cancelled) setHealth(body.ok ? 'ok' : 'down')
      })
      .catch(() => {
        if (!cancelled) setHealth('down')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gray-700">
        Signed in as <span className="font-medium">{session?.user.name}</span>.{' '}
        Head to your <Link to="/gear" className="font-medium text-blue-600 hover:underline">gear library</Link>;
        lists arrive with the next phases.
      </p>
      <span
        className={`mt-4 inline-block rounded-full px-3 py-1 text-xs font-medium ${HEALTH_STYLE[health]}`}
      >
        {HEALTH_LABEL[health]}
      </span>
      <PasskeySection />
    </div>
  )
}
