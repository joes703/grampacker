// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'

const mockState = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockState.getSession,
      onAuthStateChange: mockState.onAuthStateChange,
    },
  },
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
