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

function listResolves(rows: unknown[]) {
  h.listUserPasskeys.mockResolvedValue({ data: rows, error: null })
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
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
