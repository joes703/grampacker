// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SHARE_WEIGHT_UNIT_KEY, WEIGHT_UNIT_KEY } from '../lib/weight'

// PasskeySection, DownloadAllData and DeleteAccountSection each do their own
// I/O (authClient.passkey.*, a QueryClient fetch, authClient.deleteUser,
// useNavigate); stub them so this test covers the settings shell, not their
// plumbing (each has its own test file).
vi.mock('./PasskeySection', () => ({ default: () => <div>passkey-section</div> }))
vi.mock('./DownloadAllData', () => ({ default: () => <div>download-all-data</div> }))
vi.mock('./DeleteAccountSection', () => ({ default: () => <div>delete-account-section</div> }))

import SettingsModal from './SettingsModal'

afterEach(() => cleanup())

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

describe('SettingsModal', () => {
  it('renders the Settings shell with Passkeys, Download, and Delete sections', () => {
    render(<SettingsModal open onClose={() => {}} />)
    const ui = within(document.querySelector('dialog')!)
    expect(ui.getByRole('heading', { name: 'Settings', level: 2 })).toBeInTheDocument()

    // Every card, including Passkeys, gets its heading from the shared shell.
    expect(ui.getByRole('heading', { name: 'Passkeys', level: 3 })).toBeInTheDocument()
    expect(ui.getByText('passkey-section')).toBeInTheDocument()
    expect(
      ui.getByRole('heading', { name: 'Download all data', level: 3 }),
    ).toBeInTheDocument()
    expect(ui.getByText('download-all-data')).toBeInTheDocument()
    expect(
      ui.getByText('A complete archive of your gear, lists, and settings'),
    ).toBeInTheDocument()

    // Danger zone: delete account.
    expect(ui.getByRole('heading', { name: 'Delete account', level: 3 })).toBeInTheDocument()
    expect(ui.getByText('delete-account-section')).toBeInTheDocument()
  })

  it('has no password section at all', () => {
    // grampacker stores no password, so there is nothing to change. This asserts
    // the removal rather than trusting it: a stray re-import of a password form
    // would be a live surface for a credential that does not exist.
    render(<SettingsModal open onClose={() => {}} />)
    const ui = within(document.querySelector('dialog')!)
    expect(ui.queryByRole('heading', { name: 'Account', level: 3 })).not.toBeInTheDocument()
    expect(ui.queryByText(/password/i)).not.toBeInTheDocument()
  })
})

// Weight units landed in Settings because the app had NO unit switcher at all:
// the control existed only on the public /r/:slug share page, so a signed-in
// user had to open somebody's shared list to change their own units.
describe('SettingsModal weight units', () => {
  afterEach(() => localStorage.clear())

  it('offers a units control that writes the app-wide preference', () => {
    localStorage.setItem(WEIGHT_UNIT_KEY, 'g')
    render(<SettingsModal open onClose={() => {}} />)
    const ui = within(document.querySelector('dialog')!)

    expect(ui.getByRole('heading', { name: 'Weight units', level: 3 })).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Imperial'))
    expect(localStorage.getItem(WEIGHT_UNIT_KEY)).toBe('oz')

    fireEvent.click(screen.getByTitle('Metric'))
    expect(localStorage.getItem(WEIGHT_UNIT_KEY)).toBe('g')
  })

  it('does not write the share-scoped key', () => {
    // The isolation runs both ways: Settings must not reach into the public
    // page's preference either.
    render(<SettingsModal open onClose={() => {}} />)
    fireEvent.click(screen.getByTitle('Imperial'))
    expect(localStorage.getItem(SHARE_WEIGHT_UNIT_KEY)).toBeNull()
  })
})
