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
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockState.getSession,
      onAuthStateChange: mockState.onAuthStateChange,
    },
  },
}))

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
  mockState.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: mockState.unsubscribe } },
  })
  setNavigatorOnline(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AuthProvider cross-user React Query cache clear', () => {
  // Most query keys (['gear-items'], ['lists'], ['list-items', id], ...)
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

  it('signs out instead of restoring the cached session when getSession rejects offline', async () => {
    // Pre-removal, an offline getSession rejection restored the cached
    // last-known-good session (data-user-id would become 'cached-user').
    // With the offline fallback gone, a rejection is signed-out regardless
    // of online state, and loading always clears in finally.
    localStorage.setItem('grampacker:last-auth-session', JSON.stringify(makeSession('cached-user')))
    setNavigatorOnline(false)
    mockState.getSession.mockRejectedValue(new Error('offline'))

    const { getByTestId } = renderAuth()
    await act(async () => {})

    expect(getByTestId('auth').dataset.loading).toBe('no')
    expect(getByTestId('auth').dataset.userId).toBe('')
  })

  it('clears the React Query cache BEFORE the new identity is committed to state', async () => {
    // The whole point of clearing inside reconcileUserId (which runs before
    // setSession) is that no useQuery can observe the cache under the new
    // identity. Capture the committed identity visible at the moment clear()
    // runs: it must still be the OLD user.
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
    // only appears after reconcileUserId (and thus the clear) runs.
    expect(userIdAtClear).toBe('user-a')
    expect(getByTestId('auth').dataset.userId).toBe('user-b')
  })
})
