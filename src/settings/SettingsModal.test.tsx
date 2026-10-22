// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'

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

describe('SettingsModal weight units', () => {
  it('has no units control - the toggle lives where the weights are', () => {
    // Weight units landed in Settings when the app had no unit switcher at
    // all. The list toolbar and the gear page now each carry the switcher
    // next to the weights it changes, so a second copy here was a duplicate
    // control for the same device-local preference. Asserted rather than
    // trusted, like the password section's absence above.
    render(<SettingsModal open onClose={() => {}} />)
    const ui = within(document.querySelector('dialog')!)
    expect(
      ui.queryByRole('heading', { name: 'Weight units', level: 3 }),
    ).not.toBeInTheDocument()
    expect(ui.queryByTitle('Imperial')).not.toBeInTheDocument()
  })
})
