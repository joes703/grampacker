// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// PasskeySection, DownloadAllData, and ChangePasswordForm each do their own
// I/O (authClient.passkey.*, a QueryClient fetch, authClient.changePassword);
// stub them so this test covers the settings shell, not their plumbing
// (each has its own test file). authClient.useSession backs the Account
// subtitle.
vi.mock('../lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { email: 'joe@example.com' } } }) },
}))
vi.mock('./PasskeySection', () => ({ default: () => <div>passkey-section</div> }))
vi.mock('./DownloadAllData', () => ({ default: () => <div>download-all-data</div> }))
vi.mock('./ChangePasswordForm', () => ({ default: () => <div>change-password-form</div> }))

import SettingsPage from './SettingsPage'

afterEach(() => cleanup())

describe('SettingsPage', () => {
  it('renders the Settings shell with Account, Passkeys, and Download sections', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()

    // Account section: titled, subtitled with the signed-in email, form mounted.
    expect(screen.getByRole('heading', { name: 'Account', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('joe@example.com')).toBeInTheDocument()
    expect(screen.getByText('change-password-form')).toBeInTheDocument()

    // Passkeys (self-headed stub) and Download all data.
    expect(screen.getByText('passkey-section')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Download all data', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('download-all-data')).toBeInTheDocument()
  })
})
