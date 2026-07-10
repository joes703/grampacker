// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { List } from '../lib/types'

const { updateList } = vi.hoisted(() => ({
  updateList: vi.fn(),
}))

vi.mock('../lib/queries', () => ({
  queryKeys: {
    lists: () => ['lists'],
  },
  updateList,
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
  groupWorn: false,
  readyChecksEnabled: false,
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
