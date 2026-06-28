import { describe, expect, it } from 'vitest'

// Guard: public/sw.js is a legacy KILL-WORKER intentionally retained to
// unregister the former Workbox service worker for returning clients still
// controlled by it. It is NOT active PWA/offline behavior - grampacker is
// online-only and registers no service worker. If this file 404s, those
// clients are stranded on the stale precached shell forever (the old SW's
// update check fails and never unregisters), so it must survive a "dead code"
// sweep. This test fails the build if the kill-worker is deleted or stops
// self-destructing.
//
// Uses Vite's import.meta.glob (raw) rather than node:fs so it typechecks under
// the app tsconfig (vite/client types, no @types/node) and runs under the same
// Vite transform as the rest of the suite.
const killWorker = import.meta.glob('../../public/sw.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('legacy service-worker kill-worker', () => {
  it('public/sw.js still ships and is loadable', () => {
    // Non-vacuous: a broken relative path would yield {} and silently pass.
    expect(Object.keys(killWorker)).toHaveLength(1)
  })

  it('still self-destructs (unregisters itself and clears caches)', () => {
    const source = Object.values(killWorker)[0] ?? ''
    expect(source).toContain('self.registration.unregister()')
    expect(source).toContain('skipWaiting')
    expect(source).toContain('caches.keys()')
    expect(source).toContain('caches.delete')
  })

  it('carries the do-not-delete rationale so future cleanup keeps it', () => {
    const source = Object.values(killWorker)[0] ?? ''
    expect(source).toContain('DO NOT DELETE')
  })
})
