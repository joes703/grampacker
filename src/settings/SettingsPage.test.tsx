// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// PasskeySection and DownloadAllData do their own I/O (authClient.passkey.*
// and a QueryClient fetch); stub both so this test covers the settings
// shell, not their plumbing (each has its own test file).
vi.mock('./PasskeySection', () => ({
  default: () => <div>passkey-section</div>,
}))
vi.mock('./DownloadAllData', () => ({
  default: () => <div>download-all-data</div>,
}))

import SettingsPage from './SettingsPage'

afterEach(() => cleanup())

describe('SettingsPage', () => {
  it('renders the Settings heading and mounts the Passkeys + Download sections', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('passkey-section')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Download all data', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('download-all-data')).toBeInTheDocument()
  })
})
