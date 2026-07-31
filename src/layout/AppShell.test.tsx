// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AppShell from './AppShell'

// The settings modal is lazy and mounts only while open, so the shell's own
// tests never pull that tree in - passkeysSupported is here so a future eager
// import fails loudly rather than mysteriously.
vi.mock('../lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { email: 'hiker@example.com' } } }),
  },
  passkeysSupported: () => false,
}))

vi.mock('./use-sign-out', () => ({
  useSignOut: () => ({ signingOut: false, signOut: vi.fn() }),
}))

afterEach(cleanup)

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
})
