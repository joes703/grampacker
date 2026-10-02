// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mock only the network calls; authErrorMessage (../auth/auth-errors) stays real
// so the 429 mapping is exercised end to end. There is no client-side cache to
// tear down: on success the component does a full-document navigation, which
// discards the whole SPA (React Query cache + better-auth session atom) for
// free, so the test replaces window.location with an assign() spy.
const h = vi.hoisted(() => ({
  deleteUser: vi.fn<(input: object) => Promise<{ error: unknown }>>(),
  signInPasskey: vi.fn<() => Promise<{ error: unknown } | undefined>>(),
  signInMagicLink: vi.fn<(input: { email: string }) => Promise<{ error: unknown }>>(),
  listUserPasskeys: vi.fn<() => Promise<{ data: unknown[] | null; error: unknown }>>(),
  // The signed-in account. A test changes it to model the session switching
  // to another account mid-flow.
  sessionUserId: 'user-a',
}))

vi.mock('../lib/auth-client', () => ({
  authClient: {
    deleteUser: h.deleteUser,
    signIn: { passkey: h.signInPasskey, magicLink: h.signInMagicLink },
    passkey: { listUserPasskeys: h.listUserPasskeys },
    useSession: () => ({ data: { user: { id: h.sessionUserId, email: 'joe@example.com' } } }),
  },
  passkeysSupported: () => true,
}))

import DeleteAccountSection from './DeleteAccountSection'
import { DELETE_ACCOUNT_USER_HEADER } from '../../shared/auth'

// What the component must send to delete `userId`: no password, and the
// account it means named in the header.
function deleteRequestFor(userId: string) {
  return { fetchOptions: { headers: { [DELETE_ACCOUNT_USER_HEADER]: userId } } }
}

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  h.sessionUserId = 'user-a'
  h.listUserPasskeys.mockResolvedValue({ data: [{ id: 'pk-1' }], error: null })
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
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

function typeConfirm(value: string) {
  fireEvent.change(screen.getByLabelText('Type delete to confirm'), {
    target: { value },
  })
}

function submit() {
  // Submit via the form so disabled-button cases (reachable via Enter) still
  // exercise the handler's own gate.
  fireEvent.submit(screen.getByLabelText('Type delete to confirm').closest('form')!)
}

const button = () => screen.getByRole('button', { name: 'Delete account' })


describe('DeleteAccountSection gating', () => {
  it('never asks for a password: there is none to ask for', () => {
    // The authorization gate moved to session freshness (server-side). A
    // password field here would be collecting a credential the app does not
    // have, and would be a lie about what protects the account.
    render(<DeleteAccountSection />)
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('disables the button until the confirm word is present', () => {
    render(<DeleteAccountSection />)
    expect(button()).toBeDisabled()
    typeConfirm('delete')
    expect(button()).toBeEnabled()
  })

  it('accepts the confirm word case-insensitively', () => {
    render(<DeleteAccountSection />)
    typeConfirm('  DeLeTe  ')
    expect(button()).toBeEnabled()
  })

  it('does not call deleteUser when submitted (via Enter) without the confirm word', () => {
    render(<DeleteAccountSection />)
    submit()
    expect(h.deleteUser).not.toHaveBeenCalled()
  })
})

describe('DeleteAccountSection submission', () => {
  it('deletes with NO password, naming the signed-in account, and hard-reloads to /sign-in', async () => {
    // No password is what selects better-auth's freshness path. Sending one
    // would 400 (no credential account exists). The header names the account
    // the user confirmed; the server refuses a delete without it.
    h.deleteUser.mockResolvedValue({ error: null })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    await waitFor(() => expect(h.deleteUser).toHaveBeenCalledWith(deleteRequestFor('user-a')))
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
  })

  it('clears the persisted last-list path (both keys) before reloading on success', async () => {
    // A hard reload discards the React Query cache and the session atom, but NOT
    // localStorage - so the deleted account's list id would survive into the next
    // account in this browser and RootRedirect would send it to a dead route.
    localStorage.setItem('lastListPath', '/lists/abc')
    localStorage.setItem('lastListId', 'abc')
    h.deleteUser.mockResolvedValue({ error: null })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
    expect(localStorage.getItem('lastListPath')).toBeNull()
    expect(localStorage.getItem('lastListId')).toBeNull()
  })

  it('clears the persisted last-list path on the indeterminate throw path', async () => {
    localStorage.setItem('lastListPath', '/lists/abc')
    h.deleteUser.mockRejectedValue(new Error('network'))
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('offers re-authentication on a STALE session instead of failing', async () => {
    // The passwordless equivalent of "your password is wrong": the session is
    // simply too old to authorize this. The user must not be left staring at an
    // error with no way forward - both routes back are offered.
    h.deleteUser.mockResolvedValue({ error: { status: 400, code: 'SESSION_EXPIRED' } })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    expect(await screen.findByText(/Confirm it is you/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Use a passkey' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('re-authenticates with a passkey and replays the delete', async () => {
    h.deleteUser.mockResolvedValueOnce({
      error: { status: 400, code: 'SESSION_EXPIRED' },
    })
    h.deleteUser.mockResolvedValueOnce({ error: null })
    h.signInPasskey.mockResolvedValue({ error: null })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    fireEvent.click(await screen.findByRole('button', { name: 'Use a passkey' }))

    // Signing in again mints a fresh session; the parked delete then succeeds.
    await waitFor(() => expect(h.signInPasskey).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(h.deleteUser).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
  })

  it('replays the delete for the CONFIRMED account, even if the passkey signed in another', async () => {
    // A passkey for a different account signs that account in. The replay
    // must still name the account the user confirmed, so the server refuses
    // instead of deleting the account the passkey belonged to.
    h.deleteUser.mockResolvedValueOnce({
      error: { status: 400, code: 'SESSION_EXPIRED' },
    })
    h.deleteUser.mockResolvedValueOnce({
      error: {
        status: 400,
        code: 'DELETE_ACCOUNT_MISMATCH',
        message:
          'You are signed in to a different account than the one you chose to delete. Nothing was deleted.',
      },
    })
    h.signInPasskey.mockImplementation(async () => {
      h.sessionUserId = 'user-b'
      return { error: null }
    })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    fireEvent.click(await screen.findByRole('button', { name: 'Use a passkey' }))

    await waitFor(() => expect(h.deleteUser).toHaveBeenCalledTimes(2))
    expect(h.deleteUser).toHaveBeenLastCalledWith(deleteRequestFor('user-a'))
    expect(await screen.findByText(/Nothing was deleted/)).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('offers only the email link to an account with no passkey', async () => {
    // With no passkey of its own, the browser could offer a passkey that
    // belongs to another account. Email is the way back for this account.
    h.listUserPasskeys.mockResolvedValue({ data: [], error: null })
    h.deleteUser.mockResolvedValue({ error: { status: 400, code: 'SESSION_EXPIRED' } })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    expect(await screen.findByRole('button', { name: 'Email me a link' })).toBeInTheDocument()
    await waitFor(() => expect(h.listUserPasskeys).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).not.toBeInTheDocument()
  })

  it('offers only the email link when the passkey list fails to load', async () => {
    h.listUserPasskeys.mockRejectedValue(new Error('network'))
    h.deleteUser.mockResolvedValue({ error: { status: 400, code: 'SESSION_EXPIRED' } })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    expect(await screen.findByRole('button', { name: 'Email me a link' })).toBeInTheDocument()
    await waitFor(() => expect(h.listUserPasskeys).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).not.toBeInTheDocument()
  })

  it('falls back to an email link for an account with no passkey', async () => {
    // Someone who signed in by email and never enrolled a passkey cannot
    // re-assert one. Without this path they could never delete their account.
    h.deleteUser.mockResolvedValue({ error: { status: 400, code: 'SESSION_EXPIRED' } })
    h.signInMagicLink.mockResolvedValue({ error: null })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    fireEvent.click(await screen.findByRole('button', { name: 'Email me a link' }))

    await waitFor(() =>
      expect(h.signInMagicLink).toHaveBeenCalledWith({ email: 'joe@example.com' }),
    )
    expect(await screen.findByText(/link sent to joe@example.com/i)).toBeInTheDocument()
  })

  it('maps a 429 through the shared auth-error mapper', async () => {
    h.deleteUser.mockResolvedValue({ error: { status: 429, message: 'Too many requests' } })
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    expect(await screen.findByText(/too many/i)).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('ignores a second submit while one is in flight (no duplicate call)', async () => {
    let resolve: (v: { error: unknown }) => void = () => {}
    h.deleteUser.mockReturnValue(
      new Promise<{ error: unknown }>((r) => {
        resolve = r
      }),
    )
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    submit()
    submit()

    expect(h.deleteUser).toHaveBeenCalledTimes(1)
    resolve({ error: null })
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
  })

  it('hard-reloads to /sign-in when the delete throws (the deletion may have committed)', async () => {
    h.deleteUser.mockRejectedValue(new Error('network'))
    render(<DeleteAccountSection />)
    typeConfirm('delete')
    fireEvent.click(button())

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/sign-in'))
  })
})
