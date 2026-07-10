// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// PasskeySection does its own network I/O (authClient.passkey.*); stub it
// so this test covers the settings shell, not the passkey plumbing (which
// has its own test file).
vi.mock('./PasskeySection', () => ({
  default: () => <div>passkey-section</div>,
}))

import SettingsPage from './SettingsPage'

afterEach(() => cleanup())

describe('SettingsPage', () => {
  it('renders the Settings heading and mounts the Passkeys section', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('passkey-section')).toBeInTheDocument()
  })
})
