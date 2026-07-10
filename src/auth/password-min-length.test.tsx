// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// The sign-up and reset forms are noValidate, so their input minLength is
// advisory only. These tests pin the manual client-side length gate added
// alongside the 12-char minimum: a short password must be rejected before
// any network call. Mock only the auth client; authErrorMessage stays real.
vi.mock('../lib/auth-client', () => ({
  authClient: {
    signUp: { email: vi.fn() },
    resetPassword: vi.fn(),
  },
}))

import { authClient } from '../lib/auth-client'
import SignUpPage from './SignUpPage'
import ResetPasswordPage from './ResetPasswordPage'

const signUpEmail = vi.mocked(authClient.signUp.email)
const resetPassword = vi.mocked(authClient.resetPassword)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function submitVia(input: HTMLElement) {
  fireEvent.submit(input.closest('form')!)
}

describe('client-side password minimum on noValidate forms', () => {
  it('sign-up rejects a short password without calling signUp', async () => {
    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } })
    const password = screen.getByLabelText(/password/i)
    fireEvent.change(password, { target: { value: 'short' } })
    submitVia(password)

    expect(
      await screen.findByText('Password must be at least 12 characters.'),
    ).toBeInTheDocument()
    expect(signUpEmail).not.toHaveBeenCalled()
  })

  it('reset rejects a short password without calling resetPassword', async () => {
    render(
      <MemoryRouter initialEntries={['/reset-password?token=abc123']}>
        <ResetPasswordPage />
      </MemoryRouter>,
    )
    const password = screen.getByLabelText(/password/i)
    fireEvent.change(password, { target: { value: 'short' } })
    submitVia(password)

    expect(
      await screen.findByText('Password must be at least 12 characters.'),
    ).toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('sign-up lets a >= 12 char password through to signUp', async () => {
    signUpEmail.mockResolvedValue({ error: null })
    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'twelvechars1' } })
    submitVia(screen.getByLabelText(/password/i))

    await waitFor(() => expect(signUpEmail).toHaveBeenCalledTimes(1))
  })
})
