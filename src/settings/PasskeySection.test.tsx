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
  // What better-auth's useListPasskeys returns; it refetches by itself after
  // add, delete and rename, so the tests set the list they want shown.
  list: { data: null as unknown, error: null as unknown, isPending: true },
  updatePasskey: vi.fn<
    (input: { id: string; name: string }) => Promise<{ error: unknown }>
  >(),
  deletePasskey: vi.fn<(input: { id: string }) => Promise<{ error: unknown }>>(),
  addPasskey: vi.fn<() => Promise<{ error: unknown } | undefined>>(),
  signInPasskey: vi.fn<() => Promise<{ error: unknown } | undefined>>(),
  signInMagicLink: vi.fn<(input: { email: string }) => Promise<{ error: unknown }>>(),
}))

vi.mock('../lib/auth-client', () => ({
  authClient: {
    useListPasskeys: () => h.list,
    passkey: {
      updatePasskey: h.updatePasskey,
      deletePasskey: h.deletePasskey,
      addPasskey: h.addPasskey,
    },
    signIn: { passkey: h.signInPasskey, magicLink: h.signInMagicLink },
    useSession: () => ({ data: { user: { email: 'joe@example.com' } } }),
  },
  passkeysSupported: () => true,
}))

function listResolves(rows: unknown[]) {
  h.list = { data: rows, error: null, isPending: false }
}

// The server's refusal when the session is too old to change the credential set.
const STALE = { status: 403, code: 'SESSION_NOT_FRESH', message: 'stale' }

// Re-authentication is a CEREMONY, not a typed secret: signing in again
// mints a new session, and a new session is a fresh one.
async function confirmWithPasskey() {
  fireEvent.click(await screen.findByRole('button', { name: 'Use a passkey' }))
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Default: re-authentication succeeds. Tests that care about a failure
  // override this.
  h.signInPasskey.mockResolvedValue({ error: null })
  h.signInMagicLink.mockResolvedValue({ error: null })
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

describe('PasskeySection loading', () => {
  it('shows loading, then a load failure', () => {
    h.list = { data: null, error: null, isPending: true }
    const { rerender } = render(<PasskeySection />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()

    h.list = { data: null, error: { status: 500 }, isPending: false }
    rerender(<PasskeySection />)
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your passkeys.")
  })
})

describe('PasskeySection rename', () => {
  it('renames via updatePasskey', async () => {
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
    // A rename is not gated: no re-auth prompt, no ceremony. Renaming changes a
    // label, never which credentials can sign in.
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).not.toBeInTheDocument()
    expect(h.signInPasskey).not.toHaveBeenCalled()
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
  })
})

describe('PasskeySection fresh-auth gate', () => {
  it('goes straight through on a FRESH session - no prompt at all', async () => {
    // The common case. There is no client-side freshness clock: we just try, and
    // the server decides. A user who signed in recently never sees a challenge.
    listResolves([])
    h.addPasskey.mockResolvedValue({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }))

    await waitFor(() => expect(h.addPasskey).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).not.toBeInTheDocument()
    expect(h.signInPasskey).not.toHaveBeenCalled()
  })

  it('re-authenticates and replays the ADD when better-auth says the session is stale', async () => {
    // The register endpoints are gated by better-auth's own middleware, which
    // answers SESSION_NOT_FRESH like our delete gate. Missing it would strand
    // "Add a passkey" on a raw error with no way forward.
    // (One passkey already enrolled, so re-asserting one is possible here - the
    // zero-passkey case is its own test below.)
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    h.addPasskey.mockResolvedValueOnce({ error: STALE })
    h.addPasskey.mockResolvedValueOnce({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }))

    await confirmWithPasskey()

    await waitFor(() => expect(h.signInPasskey).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(h.addPasskey).toHaveBeenCalledTimes(2))
  })

  it('re-authenticates and replays the REMOVE when our gate says the session is stale', async () => {
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    h.deletePasskey.mockResolvedValueOnce({ error: STALE })
    h.deletePasskey.mockResolvedValueOnce({ error: null })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await confirmWithPasskey()

    await waitFor(() => expect(h.signInPasskey).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(h.deletePasskey).toHaveBeenCalledTimes(2))
  })

  it('offers ONLY the email route when the account has no passkey to re-assert', async () => {
    // The bootstrap case, and the one that would otherwise be a dead end: a user
    // who signed in by email days ago and never enrolled a passkey now wants to.
    // Their session is stale, and "use a passkey" would be a door with no key.
    listResolves([])
    h.addPasskey.mockResolvedValue({ error: STALE })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }))

    expect(await screen.findByRole('button', { name: 'Email me a link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }))
    await waitFor(() =>
      expect(h.signInMagicLink).toHaveBeenCalledWith({ email: 'joe@example.com' }),
    )
    expect(await screen.findByText(/link sent to joe@example.com/i)).toBeInTheDocument()
  })

  it('re-parks the action when the server refuses even after re-authentication', async () => {
    // Signed out elsewhere mid-flight. The action must not be silently dropped.
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    h.deletePasskey.mockResolvedValue({ error: STALE })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await confirmWithPasskey()

    await waitFor(() => expect(h.deletePasskey).toHaveBeenCalledTimes(2))
    // Prompt is back, not a dead end.
    expect(await screen.findByRole('button', { name: 'Use a passkey' })).toBeInTheDocument()
  })

  it('reports a canceled re-auth ceremony without running the mutation', async () => {
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    h.deletePasskey.mockResolvedValue({ error: STALE })
    h.signInPasskey.mockRejectedValue(new Error('user dismissed the prompt'))
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await confirmWithPasskey()

    expect(
      await screen.findByText('Passkey confirmation was canceled or failed.'),
    ).toBeInTheDocument()
    // One attempt (the original), not a replay.
    expect(h.deletePasskey).toHaveBeenCalledTimes(1)
  })

  it('does not treat an unrelated 403 as "just re-authenticate"', async () => {
    // better-auth answers 403 for other reasons (a failed origin check). Keying
    // on the status alone would turn a real refusal into an endless re-auth loop.
    listResolves([{ id: 'pk1', name: 'work laptop', aaguid: null }])
    h.deletePasskey.mockResolvedValue({
      error: { status: 403, code: 'INVALID_ORIGIN', message: 'Invalid origin' },
    })
    render(<PasskeySection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Invalid origin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).not.toBeInTheDocument()
    expect(h.signInPasskey).not.toHaveBeenCalled()
  })
})
