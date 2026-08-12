// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { List } from '../lib/types'

const { updateList, rotateShareLink } = vi.hoisted(() => ({
  updateList: vi.fn(),
  rotateShareLink: vi.fn(),
}))

vi.mock('../lib/queries', () => ({
  queryKeys: {
    lists: () => ['lists'],
  },
  updateList,
  rotateShareLink,
  makeOptimisticUpdate: () => ({}),
}))

import PrivacyPanel from './PrivacyPanel'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const list: List = {
  id: 'list-1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  isShared: false,
  isDraft: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function renderPanel(row: List = list, seedCache?: List[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (seedCache) qc.setQueryData(['lists'], seedCache)
  render(
    <QueryClientProvider client={qc}>
      <PrivacyPanel list={row} />
    </QueryClientProvider>,
  )
  return qc
}

describe('PrivacyPanel', () => {
  it('hides the URL row while the list is private', () => {
    renderPanel()

    const toggle = screen.getByRole('switch', { name: 'Enable public link' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByDisplayValue(/\/r\/abc123$/)).toBeNull()
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull()
  })

  it('toggling sends the isShared PATCH', async () => {
    updateList.mockResolvedValue({ ...list, isShared: true })
    renderPanel()
    const user = userEvent.setup()

    await user.click(screen.getByRole('switch', { name: 'Enable public link' }))

    await waitFor(() => {
      expect(updateList).toHaveBeenCalledWith('list-1', { isShared: true })
    })
  })

  it('shows the share URL (built from the slug) with a Copy button when public', () => {
    renderPanel({ ...list, isShared: true })

    const toggle = screen.getByRole('switch', { name: 'Disable public link' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    const url = screen.getByDisplayValue(/\/r\/abc123$/) as HTMLInputElement
    expect(url.value).toBe(`${window.location.origin}/r/abc123`)
    expect(url).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })

  it('unsharing sends isShared: false', async () => {
    updateList.mockResolvedValue({ ...list, isShared: false })
    renderPanel({ ...list, isShared: true })
    const user = userEvent.setup()

    await user.click(screen.getByRole('switch', { name: 'Disable public link' }))

    await waitFor(() => {
      expect(updateList).toHaveBeenCalledWith('list-1', { isShared: false })
    })
  })

  // Regression (Codex PR #29 review): a relative toggle raced - the
  // optimistic update flipped the cache immediately, but the PATCH body
  // closed over the stale rendered prop, so a rapid double-toggle sent
  // the SAME body twice and could leave the list public while the UI
  // said private. The fix is an absolute target + a disabled toggle
  // while the flip is in flight.
  it('ignores a second activation while the first flip is in flight', async () => {
    let resolveFirst!: (v: List) => void
    updateList.mockImplementation(
      () => new Promise<List>((resolve) => { resolveFirst = resolve }),
    )
    renderPanel()
    const user = userEvent.setup()

    const toggle = screen.getByRole('switch', { name: 'Enable public link' })
    await user.click(toggle)
    expect(toggle).toBeDisabled()
    await user.click(toggle) // native disabled blocks this entirely

    expect(updateList).toHaveBeenCalledTimes(1)
    expect(updateList).toHaveBeenCalledWith('list-1', { isShared: true })
    resolveFirst({ ...list, isShared: true })
    await waitFor(() => expect(toggle).not.toBeDisabled())
  })

  // Regression (Codex PR #29 re-review): isPending and the disabled
  // attribute are render-derived, so two activations inside the same
  // commit window both passed the old guard - and since the optimistic
  // write flips the cache synchronously, the second derived the OPPOSITE
  // target, putting {true} then {false} on the wire where out-of-order
  // resolution ends public. The ref guard is synchronous; the second
  // same-tick activation must be a complete no-op.
  it('ignores a second activation in the same commit window (before React re-renders)', async () => {
    updateList.mockResolvedValue({ ...list, isShared: true })
    renderPanel()

    const toggle = screen.getByRole('switch', { name: 'Enable public link' })
    // Two synchronous clicks - no await between them, so React has not
    // committed the pending/disabled state when the second one lands.
    fireEvent.click(toggle)
    fireEvent.click(toggle)

    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1))
    expect(updateList).toHaveBeenCalledWith('list-1', { isShared: true })
  })

  it('re-arms after the flip settles', async () => {
    updateList.mockResolvedValue({ ...list, isShared: true })
    renderPanel()

    const toggle = screen.getByRole('switch', { name: 'Enable public link' })
    fireEvent.click(toggle)
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1))
    // Settled (mock resolved): the ref guard must have cleared so the
    // next activation goes through.
    await waitFor(() => expect(toggle).not.toBeDisabled())
    fireEvent.click(toggle)
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))
  })

  it('derives the PATCH target from the live cache row, not the rendered prop', async () => {
    updateList.mockResolvedValue({ ...list, isShared: false })
    // The cache row is already shared; the prop snapshot lags behind.
    renderPanel(list, [{ ...list, isShared: true }])
    const user = userEvent.setup()

    await user.click(screen.getByRole('switch', { name: 'Enable public link' }))

    await waitFor(() => {
      expect(updateList).toHaveBeenCalledWith('list-1', { isShared: false })
    })
  })
})

// Replacing the link is a separate, irreversible action from the share toggle.
// The toggle must stay non-destructive: people paste these URLs into places
// they cannot edit afterwards, so only this control may retarget them.
describe('PrivacyPanel - replacing the share link', () => {
  const shared: List = { ...list, isShared: true }

  it('offers no way to replace the link while the list is private', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: /replace link/i })).toBeNull()
  })

  it('does not replace on the first click - it asks first', async () => {
    renderPanel(shared)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /replace link/i }))

    expect(rotateShareLink).not.toHaveBeenCalled()
    expect(screen.getByText(/current link stops working/i)).toBeInTheDocument()
  })

  it('cancelling leaves the link alone', async () => {
    renderPanel(shared)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /replace link/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(rotateShareLink).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /replace link/i })).toBeInTheDocument()
  })

  it('confirming replaces the link for this list', async () => {
    rotateShareLink.mockResolvedValue({ ...shared, slug: 'xyz789' })
    renderPanel(shared)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /replace link/i }))
    await user.click(screen.getByRole('button', { name: /^replace$/i }))

    await waitFor(() => expect(rotateShareLink).toHaveBeenCalledWith('list-1'))
    expect(rotateShareLink).toHaveBeenCalledTimes(1)
  })

  it('never sends an isShared PATCH while replacing', async () => {
    // The whole point of the separate control: rotating is not unsharing.
    rotateShareLink.mockResolvedValue({ ...shared, slug: 'xyz789' })
    renderPanel(shared)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /replace link/i }))
    await user.click(screen.getByRole('button', { name: /^replace$/i }))

    await waitFor(() => expect(rotateShareLink).toHaveBeenCalled())
    expect(updateList).not.toHaveBeenCalled()
  })

  it('shows the new URL once the replacement lands', async () => {
    rotateShareLink.mockResolvedValue({ ...shared, slug: 'xyz789' })
    const qc = renderPanel(shared, [shared])
    const user = userEvent.setup()

    expect(screen.getByDisplayValue(/\/r\/abc123$/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /replace link/i }))
    await user.click(screen.getByRole('button', { name: /^replace$/i }))
    await waitFor(() => expect(rotateShareLink).toHaveBeenCalled())

    // The panel renders whatever the parent passes; the parent reads the lists
    // cache, so the invalidate is what carries the new slug to the screen.
    qc.setQueryData(['lists'], [{ ...shared, slug: 'xyz789' }])
    cleanup()
    renderPanel({ ...shared, slug: 'xyz789' })
    expect(screen.getByDisplayValue(/\/r\/xyz789$/)).toBeInTheDocument()
  })

  it('does not fire twice on a double-click of Replace', async () => {
    rotateShareLink.mockImplementation(() => new Promise(() => {}))
    renderPanel(shared)

    await userEvent.setup().click(screen.getByRole('button', { name: /replace link/i }))
    const confirm = screen.getByRole('button', { name: /^replace$/i })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await waitFor(() => expect(rotateShareLink).toHaveBeenCalledTimes(1))
  })
})
