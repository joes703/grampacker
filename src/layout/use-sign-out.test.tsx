// @vitest-environment jsdom
//
// Sign-out must not be a client-side navigate('/sign-in'). That leaves the SPA
// running, and the QueryClient is a module singleton, so every row the
// signed-out account had loaded would stay in memory - and the last-list path
// would stay in localStorage, pointing RootRedirect's fast path at that
// account's list. The next person to sign in on the same browser would see both.
//
// jsdom cannot actually unload a document, so these tests assert the MECHANISM
// that does the teardown - a full-document navigation - rather than an empty
// cache afterwards. That is the honest boundary: once the browser reloads,
// in-memory state is gone by construction and there is nothing left to test.
// What jsdom can still check for real is the part a reload does NOT fix, which
// is localStorage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { readLastListPath, writeLastListPath } from '../lib/last-list-path'

const h = vi.hoisted(() => ({
  signOut: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: { signOut: h.signOut },
}))

// last-list-path is deliberately NOT mocked: its strict key handling (it clears
// the legacy key too) is part of what this fix relies on.
import { useSignOut } from './use-sign-out'

// A real UUID. writeLastListPath validates against a strict /lists/<uuid>
// regex and silently no-ops on anything else, so a placeholder id would make
// the clearing assertions pass vacuously.
const listPath = '/lists/11111111-2222-4333-8444-555555555555'
// The pointer is owner-tagged now; write and read it as the same account so the
// clear assertion isn't vacuous. Sign-out clears the KEY regardless of owner,
// so this just makes a real, readable pointer exist before the teardown.
const OWNER = 'signed-in-user'

// The hook under test does not touch the router, so this wrapper looks
// redundant. It is not: AppShell renders the hook inside a router, and a
// navigate-based implementation would call useNavigate(). Without the wrapper
// such an implementation fails with "useNavigate() may be used only in the
// context of a <Router>" - which proves nothing about the cache teardown.
// Rendering in a router lets it RUN, so these tests fail on the assertion
// they actually make.
function withRouter({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/lists']}>{children}</MemoryRouter>
}

const renderSignOut = () => renderHook(() => useSignOut(), { wrapper: withRouter })

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  h.signOut.mockResolvedValue({})
  assignMock = vi.fn()
  // The hook only ever reads window.location.assign; a minimal stand-in is
  // enough and avoids jsdom's "Not implemented: navigation" noise.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignMock },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

describe('useSignOut', () => {
  it('tears the document down instead of client-side routing to /sign-in', async () => {
    const { result } = renderSignOut()

    await act(() => result.current.signOut())

    // A full-document navigation IS the cache teardown: it discards the module
    // singleton QueryClient and better-auth's session atom together, with no
    // list of caches to keep in sync by hand.
    expect(assignMock).toHaveBeenCalledWith('/sign-in')
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })

  it('clears the last-list path, which the reload would not', async () => {
    writeLastListPath(listPath, OWNER)
    const { result } = renderSignOut()

    await act(() => result.current.signOut())

    // Left behind, RootRedirect's fast path sends the NEXT account straight to
    // the signed-out account's list URL on their first visit to /.
    expect(readLastListPath(OWNER)).toBeNull()
  })

  it('leaves device preferences alone', async () => {
    // The teardown is scoped to account data on purpose. Reaching for
    // localStorage.clear() would also drop the weight unit and the
    // seen-session perf hint, which belong to the browser, not the account.
    localStorage.setItem('weightUnit', 'oz')
    localStorage.setItem('gp:seen-session', '1')
    const { result } = renderSignOut()

    await act(() => result.current.signOut())

    expect(localStorage.getItem('weightUnit')).toBe('oz')
    expect(localStorage.getItem('gp:seen-session')).toBe('1')
  })

  it('still tears down when the signOut call rejects', async () => {
    // The cookie may already be gone (expired, or cleared server-side). That
    // is the case where a populated cache is most likely to be left sitting in
    // front of the next user, so the teardown has to run on this path too.
    writeLastListPath(listPath, OWNER)
    h.signOut.mockRejectedValue(new Error('network'))
    const { result } = renderSignOut()

    await act(() => result.current.signOut())

    expect(assignMock).toHaveBeenCalledWith('/sign-in')
    expect(readLastListPath(OWNER)).toBeNull()
  })

  it('stays disabled after the navigation is scheduled', async () => {
    const { result } = renderSignOut()

    await act(() => result.current.signOut())

    // assign() only schedules the unload, so this hook keeps rendering for an
    // unbounded window afterwards. Re-arming the button there would offer a
    // second sign-out of a session that is already gone.
    await waitFor(() => expect(result.current.signingOut).toBe(true))
  })

  it('ignores a second sign-out while one is in flight', async () => {
    let release = () => {}
    h.signOut.mockImplementation(
      () => new Promise<unknown>((resolve) => (release = () => resolve({}))),
    )
    const { result } = renderSignOut()

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.signOut()
    })
    await waitFor(() => expect(result.current.signingOut).toBe(true))
    await act(async () => {
      await result.current.signOut()
    })

    expect(h.signOut).toHaveBeenCalledTimes(1)

    await act(async () => {
      release()
      await first
    })
    expect(assignMock).toHaveBeenCalledTimes(1)
  })
})
