import { afterEach, describe, expect, it, vi } from 'vitest'
import { SUPABASE_REST_CACHE_NAME, clearSupabaseRestCache } from './sw-cache'

// AuthProvider calls clearSupabaseRestCache() on sign-out / different-user
// sign-in to enforce a per-user boundary on the Workbox runtime REST
// cache (vite.config.ts cacheName 'supabase-rest'). The full AuthProvider
// wiring is small enough to inspect at review time; these tests pin the
// helper's contracts so a future refactor can't silently break the
// boundary by renaming the cache or swallowing different errors.

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clearSupabaseRestCache', () => {
  it('passes the canonical cache name to caches.delete', async () => {
    const deleteFn = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('caches', { delete: deleteFn })

    await clearSupabaseRestCache()

    expect(deleteFn).toHaveBeenCalledTimes(1)
    expect(deleteFn).toHaveBeenCalledWith(SUPABASE_REST_CACHE_NAME)
    // Constant value pinned: cache name must match vite.config.ts
    // runtimeCaching[].options.cacheName.
    expect(SUPABASE_REST_CACHE_NAME).toBe('supabase-rest')
  })

  it('no-ops silently when the Cache Storage API is unavailable', async () => {
    // Some environments (SSR, locked-down sandboxes) lack window.caches.
    // The helper must not throw.
    vi.stubGlobal('caches', undefined)
    await expect(clearSupabaseRestCache()).resolves.toBeUndefined()
  })

  it('swallows caches.delete() rejections (e.g. SecurityError in private mode)', async () => {
    const deleteFn = vi.fn().mockRejectedValue(new Error('SecurityError'))
    vi.stubGlobal('caches', { delete: deleteFn })

    // Failing to clear isn't dangerous on its own: the next response will
    // overwrite the stale entries. A rejected promise leaking out of the
    // sign-out path would be a worse UX than the residual staleness.
    await expect(clearSupabaseRestCache()).resolves.toBeUndefined()
    expect(deleteFn).toHaveBeenCalledTimes(1)
  })
})
