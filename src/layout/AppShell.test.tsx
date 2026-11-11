// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { readLastListPath, writeLastListPath } from '../lib/last-list-path'
import AppShell from './AppShell'
import { noteLinkSignInStart, passkeyOfferClosed } from '../auth/link-sign-in-prompt'

const h = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<{ data: unknown; error: unknown }>>(),
  passkeysSupported: false,
}))

// The settings modal is lazy and mounts only while open, so the shell's own
// tests never pull that tree in. passkeysSupported and getSession serve the
// passkey prompt (src/auth/link-sign-in-prompt.ts).
vi.mock('../lib/auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: { id: 'user-1', email: 'hiker@example.com' },
        session: { id: 'session-current' },
      },
    }),
    getSession: h.getSession,
  },
  passkeysSupported: () => h.passkeysSupported,
}))

vi.mock('./use-sign-out', () => ({
  useSignOut: () => ({ signingOut: false, signOut: vi.fn() }),
}))

// jsdom does not implement <dialog>.showModal() / .close(); Modal drives both
// imperatively. Same shim Modal.test.tsx documents in full.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  passkeyOfferClosed()
  h.passkeysSupported = false
})

describe('AppShell', () => {
  it('offers a named Settings button', () => {
    // A button, not a link: settings opens over the page you are on instead of
    // navigating away from it.
    render(<AppShell />, { wrapper: MemoryRouter })

    expect(screen.getByRole('button', { name: 'Settings' })).toBeEnabled()
  })

  it('does not offer the parked Food workspace in primary navigation', () => {
    render(<AppShell />, { wrapper: MemoryRouter })

    expect(screen.queryByRole('link', { name: 'Food' })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Primary' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Gear', 'Lists'])
  })

  // A stored last-list path is where the app's ROOT reopens (RootRedirect).
  // The Lists link must not follow it: Lists is the way back to the index,
  // in the header and in the bottom bar alike.
  it('keeps Lists as the same index destination at every viewport', () => {
    const stored = '/lists/0b9f2c4e-1a2b-4c3d-8e9f-0123456789ab/pack'
    writeLastListPath(stored, 'user-1')
    // The writer silently refuses a path it would not follow, so prove the
    // pointer is really there for this user.
    expect(readLastListPath('user-1')).toBe(stored)
    render(<AppShell />, { wrapper: MemoryRouter })

    const lists = screen.getAllByRole('link', { name: 'Lists' })
    expect(lists.map((link) => link.getAttribute('href'))).toEqual(['/lists', '/lists'])
  })

  // Lists is the destination for the whole lists workspace, so it stays lit on
  // every list page and view, in the header and in the bottom bar.
  it('marks Lists current on a list detail page, in both navs', () => {
    render(
      <MemoryRouter initialEntries={['/lists/0b9f2c4e/pack']}>
        <AppShell />
      </MemoryRouter>,
    )
    for (const link of screen.getAllByRole('link', { name: 'Lists' })) {
      expect(link.getAttribute('aria-current')).toBe('page')
    }
    for (const link of screen.getAllByRole('link', { name: 'Gear' })) {
      expect(link.getAttribute('aria-current')).toBeNull()
    }
  })
})

describe('AppShell passkey prompt', () => {
  const PROMPT = 'Sign in faster next time'

  it('offers a passkey after a link sign-in created this session', async () => {
    h.passkeysSupported = true
    h.getSession.mockResolvedValue({ data: null, error: null })
    await noteLinkSignInStart()

    render(<AppShell />, { wrapper: MemoryRouter })

    expect(await screen.findByRole('dialog', { name: PROMPT })).toBeInTheDocument()
  })

  it('stays closed after Not now, even when the shell mounts again', async () => {
    // Visiting /privacy unmounts the shell; coming back mounts it again.
    h.passkeysSupported = true
    h.getSession.mockResolvedValue({ data: null, error: null })
    await noteLinkSignInStart()
    const { unmount } = render(<AppShell />, { wrapper: MemoryRouter })

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: PROMPT })).not.toBeInTheDocument(),
    )
    unmount()
    render(<AppShell />, { wrapper: MemoryRouter })

    await expect(screen.findByRole('dialog', { name: PROMPT })).rejects.toThrow()
  })

  it('does not offer one when a failed link left the same session', async () => {
    // Signed in, the link failed, and /sign-in sent this session back to '/'.
    h.passkeysSupported = true
    h.getSession.mockResolvedValue({ data: { session: { id: 'session-current' } }, error: null })
    await noteLinkSignInStart()

    render(<AppShell />, { wrapper: MemoryRouter })

    // Positive control for the wait: the prompt chunk loads lazily, and the
    // test above shows it does appear within findByRole's wait.
    await expect(screen.findByRole('dialog', { name: PROMPT })).rejects.toThrow()
  })

  it('does not offer one without a link sign-in', async () => {
    h.passkeysSupported = true

    render(<AppShell />, { wrapper: MemoryRouter })

    await expect(screen.findByRole('dialog', { name: PROMPT })).rejects.toThrow()
  })
})
