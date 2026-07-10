// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mock only the network call; authErrorMessage (../auth/auth-errors) stays
// real so the 429 mapping is exercised end to end. The vi.fn lives inside
// the factory (vi.mock is hoisted above top-level consts) and is grabbed
// back via vi.mocked below.
vi.mock('../lib/auth-client', () => ({ authClient: { changePassword: vi.fn() } }))

import { authClient } from '../lib/auth-client'
import ChangePasswordForm from './ChangePasswordForm'

const changePassword = vi.mocked(authClient.changePassword)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function fill({ current, next, confirm }: { current?: string; next?: string; confirm?: string }) {
  if (current !== undefined)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
  if (next !== undefined)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } })
  if (confirm !== undefined)
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } })
}

function submit() {
  // Submit via the form so the disabled-button cases (e.g. empty current
  // password, reachable via Enter) still exercise the handler.
  fireEvent.submit(screen.getByLabelText('Current password').closest('form')!)
}

describe('ChangePasswordForm validation', () => {
  it('requires the current password', async () => {
    render(<ChangePasswordForm />)
    fill({ next: 'longenough1', confirm: 'longenough1' })
    submit()
    expect(await screen.findByText('Enter your current password.')).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('requires the new password to be at least 12 characters', async () => {
    render(<ChangePasswordForm />)
    fill({ current: 'oldpassword', next: 'short', confirm: 'short' })
    submit()
    expect(
      await screen.findByText('New password must be at least 12 characters.'),
    ).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('requires the new password and confirmation to match', async () => {
    render(<ChangePasswordForm />)
    // Both clear the 12-char gate so the mismatch check (not length) fires.
    fill({ current: 'oldpassword', next: 'longenough123', confirm: 'longenough124' })
    submit()
    expect(await screen.findByText('New passwords do not match.')).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('rejects a new password identical to the current one', async () => {
    render(<ChangePasswordForm />)
    fill({ current: 'samepassword1', next: 'samepassword1', confirm: 'samepassword1' })
    submit()
    expect(
      await screen.findByText('Choose a password different from your current one.'),
    ).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })
})

describe('ChangePasswordForm submission', () => {
  it('changes the password, revokes other sessions, clears the form, and confirms', async () => {
    changePassword.mockResolvedValue({ error: null })
    render(<ChangePasswordForm />)
    fill({ current: 'oldpassword', next: 'newpassword1', confirm: 'newpassword1' })
    submit()

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'oldpassword',
        newPassword: 'newpassword1',
        revokeOtherSessions: true,
      }),
    )
    expect(await screen.findByText('Password updated.')).toBeInTheDocument()
    // Fields cleared on success.
    expect(screen.getByLabelText<HTMLInputElement>('Current password').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('New password').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('Confirm new password').value).toBe('')
  })

  it('maps INVALID_PASSWORD to a precise "current password is incorrect" message', async () => {
    changePassword.mockResolvedValue({
      error: { code: 'INVALID_PASSWORD', status: 400, message: 'Invalid password' },
    })
    render(<ChangePasswordForm />)
    fill({ current: 'wrongpass1', next: 'newpassword1', confirm: 'newpassword1' })
    submit()
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument()
  })

  it('maps a 429 through the shared auth-error mapper', async () => {
    changePassword.mockResolvedValue({ error: { status: 429 } })
    render(<ChangePasswordForm />)
    fill({ current: 'oldpassword', next: 'newpassword1', confirm: 'newpassword1' })
    submit()
    expect(
      await screen.findByText('Too many attempts. Please wait a bit and try again.'),
    ).toBeInTheDocument()
  })

  it('ignores a second submit while one is in flight (no duplicate call)', async () => {
    // Never resolves: the first submit stays pending for the whole test.
    changePassword.mockReturnValue(new Promise<never>(() => {}))
    render(<ChangePasswordForm />)
    fill({ current: 'oldpassword', next: 'newpassword1', confirm: 'newpassword1' })
    // Two synchronous submits (Enter can fire even with the button disabled);
    // the synchronous ref guard must block the second.
    submit()
    submit()
    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1))
  })

  it('recovers from a thrown rejection instead of sticking on "Updating..."', async () => {
    changePassword.mockRejectedValue(new Error('network exploded'))
    render(<ChangePasswordForm />)
    fill({ current: 'oldpassword', next: 'newpassword1', confirm: 'newpassword1' })
    submit()

    expect(
      await screen.findByText("Couldn't change your password. Please try again."),
    ).toBeInTheDocument()
    // busy reset in finally: the button is back to its idle label and enabled
    // (fields are still filled on error), so the form is usable again.
    const button = screen.getByRole('button', { name: 'Change password' })
    expect(button).not.toBeDisabled()
  })
})
