// @vitest-environment jsdom
// Type-side import for the jest-dom matchers (toBeInTheDocument, ...).
// vitest.setup.ts registers them at runtime for every test file; this
// import is what brings the vitest module augmentation into tsc's
// program for THIS file, so each matcher-using test stays self-typed.
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PasskeySection from './PasskeySection'

const ONEPASSWORD_AAGUID = 'bada5566-a7aa-401f-bd96-45619a55120d'
const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000'

const h = vi.hoisted(() => ({
  listUserPasskeys: vi.fn<() => Promise<{ data: unknown; error: unknown }>>(),
  updatePasskey: vi.fn<
    (input: { id: string; name: string }) => Promise<{ error: unknown }>
  >(),
  deletePasskey: vi.fn<(input: { id: string }) => Promise<{ error: unknown }>>(),
  addPasskey: vi.fn<() => Promise<{ error: unknown } | undefined>>(),
  apiFetchVoid: vi.fn<(path: string, opts?: unknown) => Promise<void>>(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: {
    passkey: {
      listUserPasskeys: h.listUserPasskeys,
      updatePasskey: h.updatePasskey,
      deletePasskey: h.deletePasskey,
      addPasskey: h.addPasskey,
    },
  },
  passkeysSupported: () => true,
}))

// Only the network call is faked; ApiError stays real, because the component
// distinguishes a wrong password (400) from a rate limit (429) by its status.
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetchVoid: h.apiFetchVoid,
}))

function listResolves(rows: unknown[]) {
  h.listUserPasskeys.mockResolvedValue({ data: rows, error: null })
}

// Adding and removing a passkey open a password prompt first (the fresh-auth
// gate). Walk through it. Renaming does NOT - see the rename suite.
async function confirmPassword(password = 'correct horse battery') {
  fireEvent.change(await screen.findByLabelText('Password'), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Default: the password confirmation succeeds. Tests that care about a
  // rejected password override this.
  h.apiFetchVoid.mockResolvedValue(undefined)
})

describe('PasskeySection labels', () => {
  it('shows the stored name first, with the authenticator in the detail line', async () => {
    listResolves([
      {
        id: 'pk1',
        name: 'work laptop',
        aaguid: ONEPASSWORD_AAGUID,
        createdAt: '2026-07-09T00:00:00.000Z',
      },
    ])
    render(<PasskeySection />)
    expect(await screen.findByText('work laptop')).toBeInTheDocument()
    expect(screen.getByText(/1Password/)).toBeInTheDocument()
  })

  it('falls back to the authenticator name when no stored name exists', async () => {
    listResolves([{ id: 'pk1', name: null, aaguid: ONEPASSWORD_AAGUID }])
    render(<PasskeySection />)
    expect(await screen.findByText('1Password')).toBeInTheDocument()
  })

  it('falls back to the generic label for the all-zero AAGUID', async () => {
    listResolves([{ id: 'pk1', name: null, aaguid: ZERO_AAGUID }])
    render(<PasskeySection />)
    expect(await screen.findByText('Passkey')).toBeInTheDocument()
  })
})

describe('PasskeySection rename', () => {
  it('renames via updatePasskey and refetches the list', async () => {
    listResolves([{ id: 'pk1', name: null, aaguid: ONEPASSWORD_AAGUID }])
    h.updatePasskey.mockResolvedValue({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Passkey name')
    fireEvent.change(input, { target: { value: '  travel key  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(h.updatePasskey).toHaveBeenCalledWith({
        id: 'pk1',
        name: 'travel key',
      }),
    )
    // reloadKey bump: initial load + post-rename refetch.
    await waitFor(() => expect(h.listUserPasskeys).toHaveBeenCalledTimes(2))
    // A rename is not gated: no password prompt, no fresh-auth proof minted.
    // Renaming changes a label, never which credentials can sign in.
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(h.apiFetchVoid).not.toHaveBeenCalled()
  })

  it('submits once when Enter and blur are delivered against the same render', async () => {
    listResolves([{ id: 'pk1', name: null, aaguid: ONEPASSWORD_AAGUID }])
    h.updatePasskey.mockResolvedValue({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Passkey name')
    fireEvent.change(input, { target: { value: 'travel key' } })
    // One act = one event batch: sequential fireEvent calls flush a
    // re-render between them (which unmounts the input and makes the
    // blur a no-op even without the guard), so both events must land
    // against the same render for this to be a real red test. Verified
    // red against the unguarded code, green with the ref guard.
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.blur(input)
    })
    await waitFor(() =>
      expect(h.updatePasskey).toHaveBeenCalledWith({
        id: 'pk1',
        name: 'travel key',
      }),
    )
    await waitFor(() => expect(h.listUserPasskeys).toHaveBeenCalledTimes(2))
    // The point of the test: the double delivery still yields ONE write.
    expect(h.updatePasskey).toHaveBeenCalledTimes(1)
  })

  it('treats submitting the prefilled display label as a cancel, not a write', async () => {
    listResolves([{ id: 'pk1', name: null, aaguid: ONEPASSWORD_AAGUID }])
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Passkey name')
    // Prefilled with the provider label; blur submits unchanged.
    expect((input as HTMLInputElement).value).toBe('1Password')
    fireEvent.blur(input)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument(),
    )
    expect(h.updatePasskey).not.toHaveBeenCalled()
  })

  it('cancels on Escape without calling updatePasskey', async () => {
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Passkey name')
    fireEvent.change(input, { target: { value: 'discarded draft' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.getByText('work laptop')).toBeInTheDocument(),
    )
    expect(h.updatePasskey).not.toHaveBeenCalled()
  })

  it('surfaces a rename failure without dropping the row', async () => {
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    h.updatePasskey.mockResolvedValue({ error: { message: 'nope' } })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Passkey name')
    fireEvent.change(input, { target: { value: 'new name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('nope')).toBeInTheDocument()
    expect(screen.getByText('work laptop')).toBeInTheDocument()
    // No refetch on failure: only the initial load.
    expect(h.listUserPasskeys).toHaveBeenCalledTimes(1)
  })
})

describe('PasskeySection fresh-auth gate', () => {
  it('will not add a passkey until the password is confirmed', async () => {
    listResolves([])
    h.addPasskey.mockResolvedValue({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }))

    // The WebAuthn ceremony must not even start: a hijacked session should
    // never get as far as the browser prompt.
    expect(h.addPasskey).not.toHaveBeenCalled()
    await confirmPassword()

    await waitFor(() => expect(h.addPasskey).toHaveBeenCalledTimes(1))
    expect(h.apiFetchVoid).toHaveBeenCalledWith('/me/reauth', {
      method: 'POST',
      body: { password: 'correct horse battery' },
    })
  })

  it('will not remove a passkey until the password is confirmed', async () => {
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    h.deletePasskey.mockResolvedValue({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(h.deletePasskey).not.toHaveBeenCalled()
    await confirmPassword()
    await waitFor(() => expect(h.deletePasskey).toHaveBeenCalledWith({ id: 'pk1' }))
  })

  it('reports a wrong password and does not run the mutation', async () => {
    const { ApiError } = await import('../lib/api')
    listResolves([])
    h.addPasskey.mockResolvedValue({ error: null })
    h.apiFetchVoid.mockRejectedValue(new ApiError(400, 'Incorrect password.'))
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }))
    await confirmPassword('wrong')

    expect(await screen.findByText('Password is incorrect.')).toBeInTheDocument()
    expect(h.addPasskey).not.toHaveBeenCalled()
    // Still armed: the prompt stays open so the user can retry.
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('names the rate limit rather than blaming the password', async () => {
    const { ApiError } = await import('../lib/api')
    listResolves([])
    h.apiFetchVoid.mockRejectedValue(new ApiError(429, 'Too many requests'))
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }))
    await confirmPassword()

    expect(
      await screen.findByText('Too many attempts. Try again in a few minutes.'),
    ).toBeInTheDocument()
    expect(h.addPasskey).not.toHaveBeenCalled()
  })

  it('re-prompts when the server says the proof expired mid-flight', async () => {
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    // The client thinks its window is open; the server disagrees. The gate is
    // the authority, so the prompt must come back rather than the action being
    // silently dropped.
    h.deletePasskey.mockResolvedValueOnce({
      error: { status: 403, code: 'REAUTH_REQUIRED', message: 'nope' },
    })
    h.deletePasskey.mockResolvedValueOnce({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await confirmPassword()

    await waitFor(() => expect(h.deletePasskey).toHaveBeenCalledTimes(1))
    // Prompt is back, not an error message.
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()

    await confirmPassword()
    await waitFor(() => expect(h.deletePasskey).toHaveBeenCalledTimes(2))
    expect(h.apiFetchVoid).toHaveBeenCalledTimes(2)
  })

  it('does not re-prompt inside the window it believes is open', async () => {
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    h.deletePasskey.mockResolvedValue({ error: null })
    h.addPasskey.mockResolvedValue({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await confirmPassword()
    await waitFor(() => expect(h.deletePasskey).toHaveBeenCalledTimes(1))

    // Second mutation, same window: straight through, no second password.
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }))
    await waitFor(() => expect(h.addPasskey).toHaveBeenCalledTimes(1))
    expect(h.apiFetchVoid).toHaveBeenCalledTimes(1)
  })
})
