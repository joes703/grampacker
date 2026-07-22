// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AppShell from './AppShell'

vi.mock('../lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { email: 'hiker@example.com' } } }),
  },
}))

vi.mock('./use-sign-out', () => ({
  useSignOut: () => ({ signingOut: false, signOut: vi.fn() }),
}))

afterEach(cleanup)

describe('AppShell', () => {
  it('keeps the all-viewport Settings entry point touch-safe below lg', () => {
    render(<AppShell />, { wrapper: MemoryRouter })

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveClass(
      'h-10',
      'w-10',
      'lg:h-7',
      'lg:w-7',
    )
  })
})
