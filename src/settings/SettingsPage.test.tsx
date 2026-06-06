// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { Session } from '@supabase/supabase-js'

// These tests exercise the DeleteAccount sub-component's handleDelete flow:
//   1. Re-auth gate - signInWithPassword failure shows "Current password is
//      incorrect." and never reaches the destructive RPC.
//   2. Happy path - re-auth OK -> rpc('delete_account') -> signOut -> navigate.
//   3. Reentrancy - the `if (busy) return` guard prevents a second in-flight
//      submit from racing a second signInWithPassword/rpc.
//
// supabase is mocked at the module boundary (SettingsPage imports it as
// `import { supabase } from '../lib/supabase'`), mirroring AuthProvider.test.tsx.
const mockSupabase = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: mockSupabase.signInWithPassword,
      signOut: mockSupabase.signOut,
      // PasskeysSection (rendered as part of SettingsPage) calls
      // passkey.list() inside a useQuery. Stub it so the page renders without
      // throwing; the delete flow under test never touches it.
      passkey: { list: vi.fn(async () => ({ data: [], error: null })) },
    },
    rpc: mockSupabase.rpc,
  },
}))

// Control the session DeleteAccount reads via useAuth(). A real session with
// an email is required for handleDelete to pass its email guard.
const mockSession = vi.hoisted(() => ({ current: null as Session | null }))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: mockSession.current, loading: false }),
}))

// Spy on navigate while keeping the real MemoryRouter/Routes machinery.
const navigateSpy = vi.hoisted(() => vi.fn())
vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>()
  return { ...actual, useNavigate: () => navigateSpy }
})

import SettingsPage from './SettingsPage'

function makeSession(): Session {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: 'user-1',
      email: 'joe@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-05-08T00:00:00.000Z',
    },
  }
}

beforeEach(() => {
  mockSession.current = makeSession()
  mockSupabase.signInWithPassword.mockReset()
  mockSupabase.signOut.mockReset()
  mockSupabase.signOut.mockResolvedValue({ error: null })
  mockSupabase.rpc.mockReset()
  navigateSpy.mockReset()
  // jsdom does not implement the native <dialog> methods Modal calls.
  // TypedConfirmDialog renders inside Modal, so stub them or the dialog
  // mount effect throws.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
  }
  // jsdom has no matchMedia; SettingsPage's render path reads it.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// Walks the DeleteAccount confirmation gauntlet up to (but not including) the
// final submit: "Delete my account" -> type "delete" -> Continue -> fill the
// password field. Returns the password field so the caller can submit it.
async function openDeleteForm(password: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
  // TypedConfirmDialog renders inside a native <dialog> (role="dialog").
  // Scope to it so the confirm-phrase input isn't confused with the
  // change-password fields elsewhere on the page. The phrase must be typed
  // before Continue enables.
  const dialog = await screen.findByRole('dialog')
  const confirmInput = within(dialog).getByRole('textbox')
  fireEvent.change(confirmInput, { target: { value: 'delete' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
  const passwordField = (await screen.findByLabelText(
    'Confirm with your current password',
  )) as HTMLInputElement
  fireEvent.change(passwordField, { target: { value: password } })
  return passwordField
}

describe('DeleteAccount re-auth gate', () => {
  it('shows "Current password is incorrect." and never calls delete_account when re-auth fails', async () => {
    mockSupabase.signInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    })
    renderSettings()
    await openDeleteForm('wrong-password')

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    expect(await screen.findByText('Current password is incorrect.')).toBeTruthy()
    expect(mockSupabase.signInWithPassword).toHaveBeenCalledTimes(1)
    // The destructive RPC must never fire when re-auth rejected the password.
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})

describe('DeleteAccount happy path', () => {
  it('calls delete_account, signs out, and navigates to /login on success', async () => {
    mockSupabase.signInWithPassword.mockResolvedValue({ error: null })
    mockSupabase.rpc.mockResolvedValue({ error: null })
    renderSettings()
    await openDeleteForm('correct-password')

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/login', { replace: true }))
    expect(mockSupabase.signInWithPassword).toHaveBeenCalledTimes(1)
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('delete_account')
    expect(mockSupabase.signOut).toHaveBeenCalledTimes(1)
  })
})

describe('DeleteAccount reentrancy guard', () => {
  it('does not start a second delete while the first is in flight', async () => {
    // Hold the first re-auth in flight so the delete handler is mid-await when
    // a second submit arrives. The component protects against a double-submit
    // two ways that compose here: the submit button is `disabled={busy}` after
    // the first click sets busy=true (React re-renders between fireEvent.click
    // calls, which run inside act()), and handleDelete opens with `if (busy)
    // return`. Either way the observable contract is the same: signInWithPassword
    // is called exactly once and the destructive rpc is never reached a second
    // time. We assert that contract rather than which guard fired.
    //
    // Limitation: in jsdom the disabled-button gate alone would satisfy this,
    // so the test does not isolate the `if (busy) return` guard from the
    // disabled attribute. Both exist deliberately (see the handleDelete
    // comment); removing the disabled attribute would make the in-closure
    // guard the sole protection, but with both present this asserts the
    // user-visible no-double-delete behavior, which is the property that
    // matters.
    let resolveReauth!: (v: { error: null }) => void
    mockSupabase.signInWithPassword.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReauth = resolve
      }),
    )
    renderSettings()
    await openDeleteForm('correct-password')

    const submit = screen.getByRole('button', { name: 'Delete account' })
    // Fire twice before the first re-auth resolves.
    fireEvent.click(submit)
    fireEvent.click(submit)

    // Let microtasks flush; the in-flight promise is still pending.
    await Promise.resolve()
    expect(mockSupabase.signInWithPassword).toHaveBeenCalledTimes(1)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()

    // Release the first re-auth and confirm the single flow completes normally.
    mockSupabase.rpc.mockResolvedValue({ error: null })
    resolveReauth({ error: null })
    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalledTimes(1))
    expect(mockSupabase.signInWithPassword).toHaveBeenCalledTimes(1)
  })
})
