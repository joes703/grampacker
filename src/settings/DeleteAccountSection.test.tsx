// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mock only the network call; authErrorMessage (../auth/auth-errors) stays real
// so the 429 mapping is exercised end to end. There is no client-side cache to
// tear down: on success the component does a full-document navigation, which
// discards the whole SPA (React Query cache + better-auth session atom) for
// free, so the test replaces window.location with an assign() spy.
vi.mock('../lib/auth-client', () => ({
  authClient: { deleteUser: vi.fn() },
}))

import { authClient } from '../lib/auth-client'
import DeleteAccountSection from './DeleteAccountSection'

const deleteUser = vi.mocked(authClient.deleteUser)

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  assignMock = vi.fn()
  // The component only ever reads window.location.assign; a minimal stand-in is
  // enough and avoids jsdom's "Not implemented: navigation" noise.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignMock },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

function fill({ password, confirm }: { password?: string; confirm?: string }) {
  if (password !== undefined)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: password } })
  if (confirm !== undefined)
    fireEvent.change(screen.getByLabelText('Type delete to confirm'), {
      target: { value: confirm },
    })
}

function submit() {
  // Submit via the form so disabled-button cases (reachable via Enter) still
  // exercise the handler's own gate.
  fireEvent.submit(screen.getByLabelText('Current password').closest('form')!)
}

const button = () => screen.getByRole('button', { name: 'Delete account' })

describe('DeleteAccountSection gating', () => {
  it('disables the button until both the password and the confirm word are present', () => {
    render(<DeleteAccountSection />)
    expect(button()).toBeDisabled()
    fill({ password: 'a-long-test-password-123' })
    expect(button()).toBeDisabled()
    fill({ confirm: 'delete' })
    expect(button()).not.toBeDisabled()
  })

  it('accepts the confirm word case-insensitively', () => {
    render(<DeleteAccountSection />)
    fill({ password: 'a-long-test-password-123', confirm: '  DELETE  ' })
    expect(button()).not.toBeDisabled()
  })

  it('does not call deleteUser when submitted (via Enter) without the confirm word', () => {
    render(<DeleteAccountSection />)
    fill({ password: 'a-long-test-password-123', confirm: 'nope' })
    submit()
    expect(deleteUser).not.toHaveBeenCalled()
  })
})

describe('DeleteAccountSection submission', () => {
  it('deletes the account and hard-reloads to /sign-in', async () => {
    deleteUser.mockResolvedValue({ error: null })
    render(<DeleteAccountSection />)
    fill({ password: 'a-long-test-password-123', confirm: 'delete' })
    submit()

    await waitFor(() =>
      expect(deleteUser).toHaveBeenCalledWith({ password: 'a-long-test-password-123' }),
    )
    // A full-document navigation (not a client route change) is the teardown:
    // it discards the entire in-memory cache and session atom.
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
  })

  it('clears the persisted last-list path (both keys) before reloading on success', async () => {
    // The hard reload discards in-memory state but NOT localStorage, so the
    // deleted account's list UUID would otherwise survive into the next
    // session in this browser. Seed both the current and legacy keys and prove
    // the delete teardown removes both.
    const uuid = '11111111-1111-4111-8111-111111111111'
    localStorage.setItem('lastListPath', `/lists/${uuid}`)
    localStorage.setItem('lastListId', uuid)
    deleteUser.mockResolvedValue({ error: null })
    render(<DeleteAccountSection />)
    fill({ password: 'a-long-test-password-123', confirm: 'delete' })
    submit()

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
    expect(localStorage.getItem('lastListPath')).toBeNull()
    expect(localStorage.getItem('lastListId')).toBeNull()
  })

  it('clears the persisted last-list path (both keys) on the indeterminate throw path', async () => {
    // A throw means the irreversible delete may already have landed, so the
    // catch biases to the same teardown - it must scrub localStorage too.
    const uuid = '22222222-2222-4222-8222-222222222222'
    localStorage.setItem('lastListPath', `/lists/${uuid}`)
    localStorage.setItem('lastListId', uuid)
    deleteUser.mockRejectedValue(new Error('network exploded'))
    render(<DeleteAccountSection />)
    fill({ password: 'a-long-test-password-123', confirm: 'delete' })
    submit()

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
    expect(localStorage.getItem('lastListPath')).toBeNull()
    expect(localStorage.getItem('lastListId')).toBeNull()
  })

  it('maps INVALID_PASSWORD to a precise message and does NOT reload', async () => {
    deleteUser.mockResolvedValue({
      error: { code: 'INVALID_PASSWORD', status: 400, message: 'Invalid password' },
    })
    render(<DeleteAccountSection />)
    fill({ password: 'wrongpass1234', confirm: 'delete' })
    submit()

    expect(await screen.findByText('Password is incorrect.')).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('maps a 429 through the shared auth-error mapper', async () => {
    deleteUser.mockResolvedValue({ error: { status: 429 } })
    render(<DeleteAccountSection />)
    fill({ password: 'a-long-test-password-123', confirm: 'delete' })
    submit()

    expect(
      await screen.findByText('Too many attempts. Please wait a bit and try again.'),
    ).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('ignores a second submit while one is in flight (no duplicate call)', async () => {
    deleteUser.mockReturnValue(new Promise<never>(() => {}))
    render(<DeleteAccountSection />)
    fill({ password: 'a-long-test-password-123', confirm: 'delete' })
    // Two synchronous submits (Enter can fire even with the button disabled);
    // the synchronous ref guard must block the second.
    submit()
    submit()
    await waitFor(() => expect(deleteUser).toHaveBeenCalledTimes(1))
  })

  it('hard-reloads to /sign-in when the delete throws (the deletion may have committed)', async () => {
    // Indeterminate: better-auth normally returns { error } rather than
    // rejecting, so a throw is a client/network failure and the irreversible
    // deletion may already have landed. Bias to the same reload rather than
    // leaving a possibly-deleted account's data in memory. No misleading error.
    deleteUser.mockRejectedValue(new Error('network exploded'))
    render(<DeleteAccountSection />)
    fill({ password: 'a-long-test-password-123', confirm: 'delete' })
    submit()

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
    expect(
      screen.queryByText("Couldn't delete your account. Please try again."),
    ).not.toBeInTheDocument()
  })
})
