// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runServiceWorkerTeardown } from './sw-teardown'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('runServiceWorkerTeardown', () => {
  it('unregisters service workers, deletes caches, and removes the dead queue key', async () => {
    const unregister = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) },
    })
    const cacheDelete = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['workbox-precache', 'supabase-rest']),
      delete: cacheDelete,
    })
    localStorage.setItem('grampacker:pending-checks:v2', '[]')
    localStorage.setItem('grampacker:last-auth-session', '{}')
    localStorage.setItem('grampacker:passkey-nudge-pending', 'keep-me')

    await runServiceWorkerTeardown()

    expect(unregister).toHaveBeenCalledTimes(1)
    expect(cacheDelete).toHaveBeenCalledWith('workbox-precache')
    expect(cacheDelete).toHaveBeenCalledWith('supabase-rest')
    expect(localStorage.getItem('grampacker:pending-checks:v2')).toBeNull()
    expect(localStorage.getItem('grampacker:last-auth-session')).toBeNull()
    expect(localStorage.getItem('grampacker:passkey-nudge-pending')).toBe('keep-me')
  })

  it('resolves without throwing when the APIs are absent', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('caches', undefined)
    await expect(runServiceWorkerTeardown()).resolves.toBeUndefined()
  })

  it('swallows a SecurityError from caches (private mode)', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('caches', {
      keys: vi.fn().mockRejectedValue(new DOMException('denied', 'SecurityError')),
      delete: vi.fn(),
    })
    await expect(runServiceWorkerTeardown()).resolves.toBeUndefined()
  })
})
