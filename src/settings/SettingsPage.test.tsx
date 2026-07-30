// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SHARE_WEIGHT_UNIT_KEY, WEIGHT_UNIT_KEY } from '../lib/weight'

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

    // Every card, including Passkeys, gets its heading from the shared shell.
    expect(screen.getByRole('heading', { name: 'Passkeys', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('passkey-section')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Default nutrition targets', level: 2 }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('default-targets-section')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Download all data', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('download-all-data')).toBeInTheDocument()
    expect(
      screen.getByText('A complete archive of your gear, lists, and settings'),
    ).toBeInTheDocument()

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

// Weight units landed in Settings because the app had NO unit switcher at all:
// the control existed only on the public /r/:slug share page, so a signed-in
// user had to open somebody's shared list to change their own units.
describe('SettingsPage weight units', () => {
  afterEach(() => localStorage.clear())

  it('offers a units control that writes the app-wide preference', () => {
    localStorage.setItem(WEIGHT_UNIT_KEY, 'g')
    render(<SettingsPage />)

    expect(screen.getByRole('heading', { name: 'Weight units', level: 2 })).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Imperial'))
    expect(localStorage.getItem(WEIGHT_UNIT_KEY)).toBe('oz')

    fireEvent.click(screen.getByTitle('Metric'))
    expect(localStorage.getItem(WEIGHT_UNIT_KEY)).toBe('g')
  })

  it('does not write the share-scoped key', () => {
    // The isolation runs both ways: Settings must not reach into the public
    // page's preference either.
    render(<SettingsPage />)
    fireEvent.click(screen.getByTitle('Imperial'))
    expect(localStorage.getItem(SHARE_WEIGHT_UNIT_KEY)).toBeNull()
  })
})
