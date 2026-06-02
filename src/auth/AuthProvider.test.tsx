// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'

const mockState = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  clearSupabaseRestCache: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockState.getSession,
      onAuthStateChange: mockState.onAuthStateChange,
    },
  },
}))

vi.mock('../lib/sw-cache', () => ({
  clearSupabaseRestCache: mockState.clearSupabaseRestCache,
}))

const OFFLINE_SESSION_KEY = 'grampacker:last-auth-session'

function makeSession(id = 'user-1'): Session {
  return {
    access_token: `access-${id}`,
    refresh_token: `refresh-${id}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-05-08T00:00:00.000Z',
    },
  }
}

function Harness() {
  const { session, loading } = useAuth()
  return (
    <div
      data-testid="auth"
      data-loading={loading ? 'yes' : 'no'}
      data-user-id={session?.user.id ?? ''}
    />
  )
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  })
}

// AuthProvider calls useQueryClient(), so it must render inside a
// QueryClientProvider. Each call gets a fresh client (and a spy on its
// `clear`) so a test can assert whether the in-memory React Query cache
// was dropped on identity change. The spy is installed before render so
// it also captures the mount-time reconcile (which must NOT clear).
function renderAuth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const clearSpy = vi.spyOn(queryClient, 'clear')
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { ...utils, queryClient, clearSpy }
}

// The handler AuthProvider registered with supabase.auth.onAuthStateChange.
function authListener() {
  return mockState.onAuthStateChange.mock.calls[0]?.[0] as
    | ((event: string, session: Session | null) => Promise<void> | void)
    | undefined
}

beforeEach(() => {
  localStorage.clear()
  mockState.getSession.mockReset()
  mockState.onAuthStateChange.mockReset()
  mockState.unsubscribe.mockReset()
  mockState.clearSupabaseRestCache.mockReset()
  mockState.clearSupabaseRestCache.mockResolvedValue(undefined)
  mockState.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: mockState.unsubscribe } },
  })
  setNavigatorOnline(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AuthProvider offline session fallback', () => {
  it('caches a valid session after the initial auth load', async () => {
    const session = makeSession()
    mockState.getSession.mockResolvedValue({ data: { session }, error: null })

    const { getByTestId } = renderAuth()

    await act(async () => {})

    expect(getByTestId('auth').dataset.loading).toBe('no')
    expect(getByTestId('auth').dataset.userId).toBe('user-1')
    expect(JSON.parse(localStorage.getItem(OFFLINE_SESSION_KEY) ?? '{}').access_token).toBe(
      'access-user-1',
    )
  })

  it('uses the cached session when offline getSession fails to refresh', async () => {
    const cached = makeSession('cached-user')
    localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(cached))
    setNavigatorOnline(false)
    mockState.getSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Failed to fetch'),
    })

    const { getByTestId } = renderAuth()

    await act(async () => {})

    expect(getByTestId('auth').dataset.loading).toBe('no')
    expect(getByTestId('auth').dataset.userId).toBe('cached-user')
  })

  it('keeps the cached session when a null auth event fires offline', async () => {
    const cached = makeSession('cached-user')
    localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(cached))
    mockState.getSession.mockResolvedValue({ data: { session: cached }, error: null })

    const { getByTestId } = renderAuth()

    await act(async () => {})

    expect(getByTestId('auth').dataset.userId).toBe('cached-user')

    const listener = mockState.onAuthStateChange.mock.calls[0]?.[0] as
      | ((event: 'SIGNED_OUT', session: Session | null) => void)
      | undefined
    expect(listener).toBeDefined()

    setNavigatorOnline(false)
    await act(async () => {
      listener?.('SIGNED_OUT', null)
    })

    expect(getByTestId('auth').dataset.userId).toBe('cached-user')
    expect(localStorage.getItem(OFFLINE_SESSION_KEY)).not.toBeNull()
  })

  it('does not use the cached session when the browser is online', async () => {
    localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(makeSession('cached-user')))
    mockState.getSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Invalid refresh token'),
    })

    const { getByTestId } = renderAuth()

    await act(async () => {})

    expect(getByTestId('auth').dataset.loading).toBe('no')
    expect(getByTestId('auth').dataset.userId).toBe('')
    expect(localStorage.getItem(OFFLINE_SESSION_KEY)).toBeNull()
  })
})

describe('AuthProvider cross-user SW cache clear', () => {
  it('clears the SW cache on an online user-switch (sign-in as a different user in the same tab)', async () => {
    mockState.getSession.mockResolvedValue({ data: { session: makeSession('user-a') }, error: null })

    renderAuth()
    await act(async () => {})
    // Mount-time seeding does NOT clear (the cache content belongs to whoever we booted as).
    expect(mockState.clearSupabaseRestCache).not.toHaveBeenCalled()

    const listener = mockState.onAuthStateChange.mock.calls[0]?.[0] as
      | ((event: 'SIGNED_IN', session: Session | null) => void)
      | undefined
    expect(listener).toBeDefined()

    await act(async () => {
      listener?.('SIGNED_IN', makeSession('user-b'))
    })

    expect(mockState.clearSupabaseRestCache).toHaveBeenCalledTimes(1)
  })

  it('clears the SW cache immediately on an offline user-switch, before setSession commits the new identity (audit regression)', async () => {
    // Audit scenario: User A signed in. Tab goes offline. Supabase
    // cross-tab fires SIGNED_IN for User B while still offline. The
    // SW `supabase-rest` cache is URL-keyed and would otherwise
    // serve A's cached row JSON to B — both while still offline
    // (reads land on the SW) and on reconnect (React Query's
    // refetchOnReconnect races StaleWhileRevalidate). The fix
    // clears the cache during the offline event, AWAITED before
    // setSession, so no useQuery scoped to B can mount until the
    // cache is gone.
    mockState.getSession.mockResolvedValueOnce({
      data: { session: makeSession('user-a') },
      error: null,
    })

    const { getByTestId } = renderAuth()
    await act(async () => {})
    expect(mockState.clearSupabaseRestCache).not.toHaveBeenCalled()
    expect(getByTestId('auth').dataset.userId).toBe('user-a')

    const listener = mockState.onAuthStateChange.mock.calls[0]?.[0] as
      | ((event: 'SIGNED_IN', session: Session | null) => Promise<void> | void)
      | undefined

    // User-switch while offline: clear must fire NOW, not on reconnect.
    setNavigatorOnline(false)
    await act(async () => {
      await listener?.('SIGNED_IN', makeSession('user-b'))
    })

    expect(mockState.clearSupabaseRestCache).toHaveBeenCalledTimes(1)
    expect(getByTestId('auth').dataset.userId).toBe('user-b')
  })

  it('awaits the SW cache clear before committing the new identity to state', async () => {
    // Regression for the timing requirement: setSession must NOT
    // complete until clearSupabaseRestCache resolves. Without this
    // gating, React Query's refetchOnReconnect could mount a
    // useQuery scoped to the new userId and hit the SW
    // StaleWhileRevalidate cache before the clear finished.
    mockState.getSession.mockResolvedValueOnce({
      data: { session: makeSession('user-a') },
      error: null,
    })
    renderAuth()
    await act(async () => {})

    const listener = mockState.onAuthStateChange.mock.calls[0]?.[0] as
      | ((event: 'SIGNED_IN', session: Session | null) => Promise<void> | void)
      | undefined

    // Hold the cache clear in-flight so we can observe the gating.
    let resolveClear!: () => void
    mockState.clearSupabaseRestCache.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveClear = resolve
      }),
    )

    // Fire the auth event WITHOUT awaiting inside act so the gate
    // remains open until we resolve the clear.
    let handlerDone = false
    void Promise.resolve(listener?.('SIGNED_IN', makeSession('user-b')))
      .then(() => { handlerDone = true })

    // Yield microtasks: the clear is in flight, the ref/state have
    // NOT advanced yet.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(handlerDone).toBe(false)
    expect(mockState.clearSupabaseRestCache).toHaveBeenCalledTimes(1)

    // Release the clear. setSession runs after.
    await act(async () => {
      resolveClear()
      // Yield enough microtasks for the awaited chain to complete.
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(handlerDone).toBe(true)
  })

  it('does NOT clear the SW cache on the online edge when identity is unchanged', async () => {
    mockState.getSession.mockResolvedValueOnce({
      data: { session: makeSession('user-a') },
      error: null,
    })

    renderAuth()
    await act(async () => {})

    // Reconnect with the same user — no clear.
    mockState.getSession.mockResolvedValueOnce({
      data: { session: makeSession('user-a') },
      error: null,
    })
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mockState.clearSupabaseRestCache).not.toHaveBeenCalled()
  })
})

describe('AuthProvider cross-user React Query cache clear', () => {
  // The SW cache clear (above) only flushes the URL-keyed PostgREST
  // disk cache. The in-memory React Query cache is a separate layer:
  // most query keys (['gear-items'], ['lists'], ['list-items', id], ...)
  // are NOT user-scoped, and the global 30s staleTime means a query
  // re-mounting right after an account switch would be served the
  // previous user's rows from memory without a refetch. These tests
  // pin that queryClient.clear() fires on every identity change
  // (switch and sign-out) and before the new session is committed.

  it('clears the React Query cache on an online user-switch', async () => {
    mockState.getSession.mockResolvedValue({ data: { session: makeSession('user-a') }, error: null })

    const { clearSpy } = renderAuth()
    await act(async () => {})
    // Mount-time seeding does NOT clear (the cache belongs to the boot user).
    expect(clearSpy).not.toHaveBeenCalled()

    const listener = authListener()
    await act(async () => {
      await listener?.('SIGNED_IN', makeSession('user-b'))
    })

    expect(clearSpy).toHaveBeenCalledTimes(1)
  })

  it('clears the React Query cache on sign-out (online null event)', async () => {
    mockState.getSession.mockResolvedValue({ data: { session: makeSession('user-a') }, error: null })

    const { clearSpy, getByTestId } = renderAuth()
    await act(async () => {})
    expect(clearSpy).not.toHaveBeenCalled()

    const listener = authListener()
    // Online (set in beforeEach): a null event is a real sign-out.
    await act(async () => {
      await listener?.('SIGNED_OUT', null)
    })

    expect(clearSpy).toHaveBeenCalledTimes(1)
    expect(getByTestId('auth').dataset.userId).toBe('')
  })

  it('does NOT clear the React Query cache on mount or on a same-identity event', async () => {
    mockState.getSession.mockResolvedValue({ data: { session: makeSession('user-a') }, error: null })

    const { clearSpy } = renderAuth()
    await act(async () => {})
    // Mount: prev === undefined seeds the ref, no clear.
    expect(clearSpy).not.toHaveBeenCalled()

    // Re-auth as the same user: no identity change, no clear.
    const listener = authListener()
    await act(async () => {
      await listener?.('SIGNED_IN', makeSession('user-a'))
    })
    expect(clearSpy).not.toHaveBeenCalled()
  })

  it('does NOT clear the React Query cache on an offline null event (transient refresh failure)', async () => {
    // Mirrors the SW behavior: an offline null event is treated as a
    // transient refresh failure, not a sign-out, so the previous user's
    // identity (and cache) is preserved until the next online roundtrip.
    const cached = makeSession('user-a')
    localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(cached))
    mockState.getSession.mockResolvedValue({ data: { session: cached }, error: null })

    const { clearSpy } = renderAuth()
    await act(async () => {})

    const listener = authListener()
    setNavigatorOnline(false)
    await act(async () => {
      await listener?.('SIGNED_OUT', null)
    })

    expect(clearSpy).not.toHaveBeenCalled()
  })

  it('clears the React Query cache BEFORE the new identity is committed to state', async () => {
    // The whole point of clearing inside reconcileUserId (which every
    // setSession awaits) is that no useQuery can observe the cache under
    // the new identity. Capture the committed identity visible at the
    // moment clear() runs: it must still be the OLD user.
    mockState.getSession.mockResolvedValueOnce({
      data: { session: makeSession('user-a') },
      error: null,
    })

    const { clearSpy, getByTestId } = renderAuth()
    await act(async () => {})
    expect(getByTestId('auth').dataset.userId).toBe('user-a')

    let userIdAtClear: string | undefined
    clearSpy.mockImplementation(() => {
      userIdAtClear = getByTestId('auth').dataset.userId
    })

    const listener = authListener()
    await act(async () => {
      await listener?.('SIGNED_IN', makeSession('user-b'))
    })

    // clear() ran while user-a was still the committed identity; user-b
    // only appears after reconcileUserId (and thus the clear) resolves.
    expect(userIdAtClear).toBe('user-a')
    expect(getByTestId('auth').dataset.userId).toBe('user-b')
  })
})
