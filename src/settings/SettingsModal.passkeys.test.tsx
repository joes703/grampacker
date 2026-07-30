// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ supported: true }))

vi.mock('../lib/auth-client', () => ({
  authClient: {
    passkey: {
      listUserPasskeys: vi.fn().mockResolvedValue({ data: [], error: null }),
    },
    useSession: () => ({ data: { user: { email: 'hiker@example.com' } } }),
  },
  passkeysSupported: () => h.supported,
}))

vi.mock('./DefaultTargetsSection', () => ({ default: () => null }))
vi.mock('./DownloadAllData', () => ({ default: () => null }))
vi.mock('./DeleteAccountSection', () => ({ default: () => null }))

import SettingsModal from './SettingsModal'

beforeEach(() => {
  h.supported = true
})

afterEach(cleanup)

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

describe('SettingsModal passkey guidance', () => {
  it('does not tell an unsupported browser to add a passkey', () => {
    h.supported = false
    render(<SettingsModal open onClose={() => {}} />)

    expect(screen.getByText(/This browser doesn't support passkeys/)).toBeInTheDocument()
    expect(
      screen.queryByText('Your passkeys are how you sign in. Add one per device you use'),
    ).not.toBeInTheDocument()
  })

  it('keeps the enrollment guidance in supported browsers', () => {
    render(<SettingsModal open onClose={() => {}} />)

    expect(
      screen.getByText('Your passkeys are how you sign in. Add one per device you use'),
    ).toBeInTheDocument()
  })
})
