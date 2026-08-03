// @vitest-environment jsdom
//
// The QueryClient is a module singleton (App.tsx), so nothing about a session
// ending unmounts it - a client-side route to /sign-in leaves every cached
// query in memory, and an A -> B account switch never unmounts at all. An
// earlier attempt cleared the cache in place; that does NOT work, because
// clear() neither updates already-mounted query observers nor cancels an
// in-flight mutation whose rollback then re-populates the cache. Only a full
// document teardown discards mounted state, cache, and pending mutations
// together - the same teardown the deliberate exits (useSignOut,
// DeleteAccountSection, magic-link) already use.
//
// The guard WRAPS the app, so on a cross-account change it does two things:
// synchronously stops rendering its children (so A's cached rows never commit
// under B in the frame before the document goes away) and then tears the
// document down. jsdom cannot actually unload a document, so - exactly as
// use-sign-out.test does - these tests assert the MECHANISM: that the children
// disappear on the switch render, that a full-document navigation is triggered,
// and that the per-account localStorage a reload would not clear is cleared.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readLastListPath, writeLastListPath } from '../lib/last-list-path'

// A controllable session. useSession reads this on every render, so a rerender
// with a new value models a real session transition (sign-out, expiry, or an
// account switch) without a live better-auth client.
const h = vi.hoisted(() => ({ data: undefined as { user: { id: string } } | null | undefined }))

vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: h.data, isPending: false }) },
}))

// last-list-path is deliberately NOT mocked: clearing it (including the legacy
// key) is half of what this guard is responsible for, and a reload would not.
import { SessionCacheGuard } from './session-cache-guard'

// A real UUID: writeLastListPath validates against a strict /lists/<uuid> regex
// and silently no-ops on anything else, so a placeholder id would make the
// clearing assertions pass vacuously.
const listPath = '/lists/11111111-2222-4333-8444-555555555555'

// The child stands in for the mounted authenticated tree. Its presence in the
// DOM is the thing that must be true for the current account and false the
// instant a different account is observed - the confidentiality invariant made
// observable in jsdom.
const CHILD = 'authenticated-app'

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>
let reloadMock: ReturnType<typeof vi.fn>

function renderGuard() {
  // A FRESH element each time. Rerendering the same element reference hits
  // React's identity bail-out and the guard never re-reads the mocked
  // useSession, so the transition under test would never fire.
  const ui = () => (
    <SessionCacheGuard>
      <div>{CHILD}</div>
    </SessionCacheGuard>
  )
  const view = render(ui())
  return { ...view, rerender: () => view.rerender(ui()) }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  h.data = undefined
  assignMock = vi.fn()
  reloadMock = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignMock, reload: reloadMock },
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

describe('SessionCacheGuard: session-scoped teardown', () => {
  it('tears the document down when the session ends (sign-out or expiry)', () => {
    h.data = { user: { id: 'A' } }
    writeLastListPath(listPath, 'A')
    const { rerender } = renderGuard()
    expect(screen.getByText(CHILD)).toBeInTheDocument()

    h.data = null
    rerender()

    // The mounted tree is dropped in the same render that observed the change,
    // before any teardown navigation resolves.
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()
    // A full-document navigation IS the teardown: it discards the singleton
    // cache and any pending mutation along with the (already unmounted) tree.
    expect(assignMock).toHaveBeenCalledWith('/')
    // localStorage survives a reload, so the per-account pointer must go too.
    expect(readLastListPath('A')).toBeNull()
  })

  it('tears down and suppresses A when the session switches to a different account', () => {
    // The case in-place cache clearing gets wrong: RequireSession never unmounts
    // (B is truthy), so without synchronously dropping children the mounted tree
    // would keep rendering A's rows under B's session for at least one frame.
    h.data = { user: { id: 'A' } }
    writeLastListPath(listPath, 'A')
    const { rerender } = renderGuard()
    expect(screen.getByText(CHILD)).toBeInTheDocument()

    h.data = { user: { id: 'B' } }
    rerender()

    // A's tree is gone on the B render - it never commits under B.
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument()
    expect(assignMock).toHaveBeenCalledWith('/')
    expect(readLastListPath('A')).toBeNull()
  })

  it('does NOT tear down on sign-in (no session -> a session)', () => {
    writeLastListPath(listPath, 'A')
    const { rerender } = renderGuard()

    h.data = { user: { id: 'A' } }
    rerender()

    // Children keep rendering; a new sign-in is not a cross-account change.
    expect(screen.getByText(CHILD)).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
    expect(readLastListPath('A')).toBe(listPath)
  })

  it('does NOT tear down when a refetch resolves to the same user', () => {
    // better-auth refetches the session after every auth mutation and on focus;
    // an unchanged id is not a session change.
    h.data = { user: { id: 'A' } }
    writeLastListPath(listPath, 'A')
    const { rerender } = renderGuard()

    h.data = { user: { id: 'A' } }
    rerender()

    expect(screen.getByText(CHILD)).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
    expect(readLastListPath('A')).toBe(listPath)
  })

  it('does NOT tear down when the document loads already signed in', () => {
    // First observation is a real session, not a transition from one. A refresh
    // while authenticated must not bounce the user to '/' or hide the app.
    h.data = { user: { id: 'A' } }
    writeLastListPath(listPath, 'A')
    renderGuard()

    expect(screen.getByText(CHILD)).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
    expect(readLastListPath('A')).toBe(listPath)
  })
})

describe('SessionCacheGuard: bfcache', () => {
  function firePageShow(persisted: boolean) {
    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: persisted })
    window.dispatchEvent(event)
  }

  it('reloads when an authenticated document is restored from bfcache', () => {
    h.data = { user: { id: 'A' } }
    renderGuard()

    firePageShow(true)

    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload a document that never held a session (protects the magic-link token)', () => {
    // The magic-link page is anonymous and keeps its one-shot token in memory
    // after scrubbing it from the URL. Reloading a bfcache-restored copy would
    // discard the token and strand the user on "Broken link", so a document
    // that never observed a session must never be reloaded here.
    h.data = null
    renderGuard()

    firePageShow(true)

    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('does not reload on an ordinary pageshow', () => {
    // persisted === false is a normal load, not a Back/Forward cache restore.
    h.data = { user: { id: 'A' } }
    renderGuard()

    firePageShow(false)

    expect(reloadMock).not.toHaveBeenCalled()
  })
})
