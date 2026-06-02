// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared, hoisted mock state so the factories below keep stable references
// across vi.resetModules() (each test re-imports PasskeyNudge fresh to reset
// its module-level one-shot consume memo).
const h = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useOnline: vi.fn(),
  isPasskeySupported: vi.fn(),
  list: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: h.useAuth }))
vi.mock('../lib/use-online', () => ({ useOnline: h.useOnline }))
vi.mock('../lib/passkey', () => ({ isPasskeySupported: h.isPasskeySupported }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { passkey: { list: h.list } } },
}))
vi.mock('../lib/queries', () => ({
  queryKeys: { passkeys: (userId: string) => ['passkeys', userId] as const },
}))
vi.mock('react-router', () => ({ useNavigate: () => h.navigate }))

const PENDING_KEY = 'grampacker:passkey-nudge-pending'
const dismissedKey = (userId: string) => `grampacker:passkey-nudge-dismissed:${userId}`
const COPY = 'Sign in faster next time with a passkey.'

// Default: a fully eligible state. Individual tests override one precondition.
function setEligibleDefaults() {
  sessionStorage.setItem(PENDING_KEY, '1')
  h.useAuth.mockReturnValue({ session: { user: { id: 'user-1' } }, loading: false })
  h.useOnline.mockReturnValue(true)
  h.isPasskeySupported.mockReturnValue(true)
  h.list.mockResolvedValue({ data: [], error: null })
}

beforeEach(() => {
  vi.resetModules()
  sessionStorage.clear()
  localStorage.clear()
  h.useAuth.mockReset()
  h.useOnline.mockReset()
  h.isPasskeySupported.mockReset()
  h.list.mockReset()
  h.navigate.mockReset()
  setEligibleDefaults()
})

afterEach(() => {
  cleanup()
})

// Fresh import each test so the module-level consume memo starts at null.
async function renderNudge() {
  const mod = await import('./PasskeyNudge')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <mod.default />
    </QueryClientProvider>,
  )
  return { ...utils, mod }
}

describe('PasskeyNudge eligibility', () => {
  it('shows the nudge when every precondition holds and the user has no passkey', async () => {
    await renderNudge()
    expect(await screen.findByText(COPY)).toBeTruthy()
  })

  it('consumes the one-shot sessionStorage flag on mount', async () => {
    await renderNudge()
    await screen.findByText(COPY)
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
  })

  it('does not show without the one-shot flag (e.g. a normal app load)', async () => {
    sessionStorage.removeItem(PENDING_KEY)
    await renderNudge()
    await act(async () => {})
    expect(screen.queryByText(COPY)).toBeNull()
    // No flag means no eligibility, so we never hit the passkey list.
    expect(h.list).not.toHaveBeenCalled()
  })

  it('does not show when the user already has a passkey', async () => {
    h.list.mockResolvedValue({ data: [{ id: 'pk-1' }], error: null })
    await renderNudge()
    await waitFor(() => expect(h.list).toHaveBeenCalled())
    expect(screen.queryByText(COPY)).toBeNull()
  })

  it('does not show when the browser does not support passkeys', async () => {
    h.isPasskeySupported.mockReturnValue(false)
    await renderNudge()
    await act(async () => {})
    expect(screen.queryByText(COPY)).toBeNull()
    expect(h.list).not.toHaveBeenCalled()
  })

  it('does not show when offline', async () => {
    h.useOnline.mockReturnValue(false)
    await renderNudge()
    await act(async () => {})
    expect(screen.queryByText(COPY)).toBeNull()
    expect(h.list).not.toHaveBeenCalled()
  })

  it('does not show when already dismissed for this account', async () => {
    localStorage.setItem(dismissedKey('user-1'), '1')
    await renderNudge()
    await act(async () => {})
    expect(screen.queryByText(COPY)).toBeNull()
    expect(h.list).not.toHaveBeenCalled()
  })
})

describe('PasskeyNudge actions', () => {
  it('"Not now" hides the nudge and persists dismissal for the account', async () => {
    await renderNudge()
    await screen.findByText(COPY)

    fireEvent.click(screen.getByText('Not now'))

    expect(localStorage.getItem(dismissedKey('user-1'))).toBe('1')
    expect(screen.queryByText(COPY)).toBeNull()
  })

  it('"Add passkey" deep-links to Settings and hides, without persisting dismissal', async () => {
    await renderNudge()
    await screen.findByText(COPY)

    fireEvent.click(screen.getByText('Add passkey'))

    expect(h.navigate).toHaveBeenCalledWith('/settings#passkeys')
    expect(screen.queryByText(COPY)).toBeNull()
    // Not persisted: a user who bails out of Settings is nudged again next
    // sign-in. Settings marks it dismissed only on a successful add.
    expect(localStorage.getItem(dismissedKey('user-1'))).toBeNull()
  })
})

describe('PasskeyNudge helpers', () => {
  it('markPasskeyNudgePending sets the one-shot flag', async () => {
    const mod = await import('./PasskeyNudge')
    mod.markPasskeyNudgePending()
    expect(sessionStorage.getItem(PENDING_KEY)).toBe('1')
  })

  it('dismissPasskeyNudge persists per-user dismissal', async () => {
    const mod = await import('./PasskeyNudge')
    mod.dismissPasskeyNudge('user-9')
    expect(localStorage.getItem(dismissedKey('user-9'))).toBe('1')
  })

  it('re-arms the nudge for a second sign-in in the same page load', async () => {
    // First sign-in: the nudge shows and consumes the one-shot flag, leaving
    // the module-level memo marked as "consumed".
    const { mod } = await renderNudge()
    await screen.findByText(COPY)
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
    cleanup()

    // Second sign-in without a full reload: LoginPage marks pending again.
    // This must reset the memo, not just rewrite the flag.
    mod.markPasskeyNudgePending()
    expect(sessionStorage.getItem(PENDING_KEY)).toBe('1')

    // Same module instance (no resetModules mid-test): the nudge consumes
    // the re-armed flag and shows again.
    await renderNudge()
    expect(await screen.findByText(COPY)).toBeTruthy()
  })
})
