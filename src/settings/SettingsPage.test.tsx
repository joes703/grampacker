// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// PasskeySection, DownloadAllData and DeleteAccountSection each do their own
// I/O (authClient.passkey.*, a QueryClient fetch, authClient.deleteUser,
// useNavigate); stub them so this test covers the settings shell, not their
// plumbing (each has its own test file).
vi.mock('./PasskeySection', () => ({ default: () => <div>passkey-section</div> }))
vi.mock('./DefaultTargetsSection', () => ({ default: () => <div>default-targets-section</div> }))
vi.mock('./DownloadAllData', () => ({ default: () => <div>download-all-data</div> }))
vi.mock('./DeleteAccountSection', () => ({ default: () => <div>delete-account-section</div> }))

import SettingsPage from './SettingsPage'

afterEach(() => cleanup())

describe('SettingsPage', () => {
  it('renders the Settings shell with Passkeys, Download, and Delete sections', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()

    // Passkeys (self-headed stub) and Download all data.
    expect(screen.getByText('passkey-section')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Default nutrition targets', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('default-targets-section')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Download all data', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('download-all-data')).toBeInTheDocument()

    // Danger zone: delete account.
    expect(screen.getByRole('heading', { name: 'Delete account', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('delete-account-section')).toBeInTheDocument()
  })

  it('has no password section at all', () => {
    // grampacker stores no password, so there is nothing to change. This asserts
    // the removal rather than trusting it: a stray re-import of a password form
    // would be a live surface for a credential that does not exist.
    render(<SettingsPage />)
    expect(screen.queryByRole('heading', { name: 'Account', level: 2 })).not.toBeInTheDocument()
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument()
  })
})
