import { useEffect, useState } from 'react'
import { healthResponseSchema } from '../shared/health'

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

export default function App() {
  const [health, setHealth] = useState<ApiHealth>('checking')

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

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
        grampacker
      </h1>
      <p className="text-center text-sm text-gray-600">
        Rewrite scaffold: Hono + Drizzle + D1 behind a Vite SPA. The real app
        transplants in from phase 2.
      </p>
      <span
        className={`rounded-full px-3 py-1 text-xs font-medium ${HEALTH_STYLE[health]}`}
      >
        {HEALTH_LABEL[health]}
      </span>
    </main>
  )
}
