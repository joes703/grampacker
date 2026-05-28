// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
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

    const { getByTestId } = render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    )

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

    const { getByTestId } = render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    )

    await act(async () => {})

    expect(getByTestId('auth').dataset.loading).toBe('no')
    expect(getByTestId('auth').dataset.userId).toBe('cached-user')
  })

  it('keeps the cached session when a null auth event fires offline', async () => {
    const cached = makeSession('cached-user')
    localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(cached))
    mockState.getSession.mockResolvedValue({ data: { session: cached }, error: null })

    const { getByTestId } = render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    )

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

    const { getByTestId } = render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    )

    await act(async () => {})

    expect(getByTestId('auth').dataset.loading).toBe('no')
    expect(getByTestId('auth').dataset.userId).toBe('')
    expect(localStorage.getItem(OFFLINE_SESSION_KEY)).toBeNull()
  })
})

describe('AuthProvider cross-user SW cache clear', () => {
  it('clears the SW cache on an online user-switch (sign-in as a different user in the same tab)', async () => {
    mockState.getSession.mockResolvedValue({ data: { session: makeSession('user-a') }, error: null })

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    )
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

  it('clears the SW cache on the online edge after an offline user-switch (audit regression)', async () => {
    // Audit scenario: User A signed in. Tab goes offline. Supabase
    // cross-tab fires SIGNED_IN for User B while still offline. On
    // reconnect, supabase may not emit a fresh auth event because
    // B's token is still valid — so the 'online' edge listener must
    // run reconciliation against the current session and clear the
    // SW cache. The prior implementation advanced lastUserIdRef
    // during the offline event, so the online edge saw prev === next
    // and never cleared, serving A's row JSON to B from the SW cache.
    mockState.getSession.mockResolvedValueOnce({
      data: { session: makeSession('user-a') },
      error: null,
    })

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    )
    await act(async () => {})
    expect(mockState.clearSupabaseRestCache).not.toHaveBeenCalled()

    const listener = mockState.onAuthStateChange.mock.calls[0]?.[0] as
      | ((event: 'SIGNED_IN', session: Session | null) => void)
      | undefined

    // User-switch while offline: fire SIGNED_IN for B with navigator.onLine=false.
    setNavigatorOnline(false)
    await act(async () => {
      listener?.('SIGNED_IN', makeSession('user-b'))
    })
    expect(mockState.clearSupabaseRestCache).not.toHaveBeenCalled()

    // Reconnect: supabase doesn't fire any event (B's token still
    // valid). The 'online' edge listener triggers and reconciles via
    // getSession, which returns B's current session.
    mockState.getSession.mockResolvedValueOnce({
      data: { session: makeSession('user-b') },
      error: null,
    })
    setNavigatorOnline(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mockState.clearSupabaseRestCache).toHaveBeenCalledTimes(1)
  })

  it('does NOT clear the SW cache on the online edge when identity is unchanged', async () => {
    mockState.getSession.mockResolvedValueOnce({
      data: { session: makeSession('user-a') },
      error: null,
    })

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    )
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
