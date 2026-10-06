// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { readLastListPath, writeLastListPath } from '../lib/last-list-path'
import AppShell from './AppShell'

// The settings modal is lazy and mounts only while open, so the shell's own
// tests never pull that tree in - passkeysSupported is here so a future eager
// import fails loudly rather than mysteriously.
vi.mock('../lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user-1', email: 'hiker@example.com' } } }),
  },
  passkeysSupported: () => false,
}))

vi.mock('./use-sign-out', () => ({
  useSignOut: () => ({ signingOut: false, signOut: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('AppShell', () => {
  it('keeps the all-viewport Settings entry point touch-safe below lg', () => {
    // A button, not a link: settings opens over the page you are on instead of
    // navigating away from it.
    render(<AppShell />, { wrapper: MemoryRouter })

    expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass(
      'h-10',
      'w-10',
      'lg:h-7',
      'lg:w-6',
    )
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

  // The bottom bar is lg:hidden. If the header nav appeared at md instead,
  // both would show across 768-1023px.
  it('hands primary navigation from the bottom bar to the header at lg', () => {
    render(<AppShell />, { wrapper: MemoryRouter })

    const header = screen.getByRole('navigation', { name: 'Primary' })
    expect(header).toHaveClass('hidden', 'lg:flex')
    expect(header).not.toHaveClass('md:flex')
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toHaveClass('lg:hidden')
  })
})
