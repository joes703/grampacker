// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { List } from '../lib/types'
import { showToast } from '../lib/toast'

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))

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

  // Both directions, from a fresh render with nothing cached: the target comes
  // from the row itself, so a wrong default for "no cached row" fails one of
  // them.
  it.each([
    ['Enable public link', false, true],
    ['Disable public link', true, false],
  ] as const)('toggling sends the isShared PATCH: %s', async (name, from, to) => {
    updateList.mockResolvedValue({ ...list, isShared: to })
    renderPanel({ ...list, isShared: from })
    const user = userEvent.setup()

    await user.click(screen.getByRole('switch', { name }))

    await waitFor(() => {
      expect(updateList).toHaveBeenCalledWith('list-1', { isShared: to })
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

  // A relative toggle races: the optimistic update flips the cache at once,
  // but a PATCH body built from the stale rendered prop sends the SAME body
  // twice on a rapid double-toggle, and can leave the list public while the
  // UI says private. Hence an absolute target and a disabled toggle while
  // the flip is in flight.
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

  // isPending and the disabled attribute are render-derived, so two
  // activations inside the same commit window both get past them. The
  // optimistic write flips the cache synchronously, so the second would
  // derive the OPPOSITE target, putting {true} then {false} on the wire,
  // where out-of-order resolution ends public. The ref guard is synchronous;
  // the second same-tick activation must be a complete no-op.
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

  it('canceling leaves the link alone', async () => {
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
    // The panel renders whatever the parent passes, and the parent reads the
    // lists cache. So the new slug reaches the screen only if the replace
    // refreshes that cache.
    let serverLists: List[] = [shared]
    rotateShareLink.mockImplementation(async () => {
      serverLists = [{ ...shared, slug: 'xyz789' }]
      return serverLists[0]
    })
    function CacheReadingParent() {
      const { data } = useQuery({ queryKey: ['lists'], queryFn: async () => serverLists })
      const row = data?.find((l) => l.id === shared.id)
      return row ? <PrivacyPanel list={row} /> : null
    }
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={qc}>
        <CacheReadingParent />
      </QueryClientProvider>,
    )
    const user = userEvent.setup()

    expect(await screen.findByDisplayValue(/\/r\/abc123$/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /replace link/i }))
    await user.click(screen.getByRole('button', { name: /^replace$/i }))

    expect(await screen.findByDisplayValue(/\/r\/xyz789$/)).toBeInTheDocument()
  })

  it('does not fire twice on a double-click of Replace', async () => {
    rotateShareLink.mockImplementation(() => new Promise(() => {}))
    renderPanel(shared)

    await userEvent.setup().click(screen.getByRole('button', { name: /replace link/i }))
    const confirm = screen.getByRole('button', { name: /^replace$/i })
    // Both clicks in one act(), so React does not re-render between them and
    // the button is still enabled for the second. Only the ref can stop it.
    act(() => {
      confirm.click()
      confirm.click()
    })

    await waitFor(() => expect(rotateShareLink).toHaveBeenCalled())
    await act(async () => {})
    expect(rotateShareLink).toHaveBeenCalledTimes(1)
  })
})

// A failed replace is reported INLINE: this panel lives inside a Modal on the
// Lists page and in mobile List options, and the modal rule puts the error beside
// the control. The rotate is a non-idempotent POST that may have
// committed before the failure, so the copy claims only what it can prove and
// advises a refresh before retrying.
describe('PrivacyPanel - a failed replace', () => {
  const shared: List = { ...list, isShared: true }
  const failure = /couldn't confirm the link was replaced\. refresh to check before trying again\./i

  function deferred() {
    let reject: (err: unknown) => void = () => {}
    const promise = new Promise((_resolve, rej) => {
      reject = rej
    })
    return { promise, reject }
  }

  async function confirmReplace() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /replace link/i }))
    await user.click(screen.getByRole('button', { name: /^replace$/i }))
  }

  it('says so in the panel, closes the confirm, and carries no error toast', async () => {
    rotateShareLink.mockRejectedValue(new Error('network'))
    const qc = renderPanel(shared)

    await confirmReplace()

    expect(await screen.findByRole('alert')).toHaveTextContent(failure)
    expect(screen.getByRole('button', { name: /replace link/i })).toBeInTheDocument()
    expect(qc.getMutationCache().getAll()[0]?.options.meta?.errorToast).toBeUndefined()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('refetches the lists anyway, in case the replace committed', async () => {
    rotateShareLink.mockRejectedValue(new Error('network'))
    const qc = renderPanel(shared)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    await confirmReplace()

    await screen.findByRole('alert')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lists'] })
  })

  it('still reports a failure that lands after Cancel', async () => {
    const d = deferred()
    rotateShareLink.mockReturnValue(d.promise)
    renderPanel(shared)

    await confirmReplace()
    await userEvent.setup().click(screen.getByRole('button', { name: /cancel/i }))
    d.reject(new Error('network'))

    expect(await screen.findByRole('alert')).toHaveTextContent(failure)
  })

  it('cannot be reopened while the replace is in flight', async () => {
    rotateShareLink.mockReturnValue(new Promise(() => {}))
    renderPanel(shared)

    await confirmReplace()
    await userEvent.setup().click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.getByRole('button', { name: /replace link/i })).toBeDisabled()
  })

  it('still reports a failure that lands after sharing was turned off', async () => {
    const d = deferred()
    rotateShareLink.mockReturnValue(d.promise)
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <PrivacyPanel list={shared} />
      </QueryClientProvider>,
    )

    await confirmReplace()
    rerender(
      <QueryClientProvider client={qc}>
        <PrivacyPanel list={{ ...shared, isShared: false }} />
      </QueryClientProvider>,
    )
    d.reject(new Error('network'))

    expect(await screen.findByRole('alert')).toHaveTextContent(failure)
  })

  // The panel can leave the screen before a slow replace fails: mobile List
  // options closes its Modal on Duplicate or Export, and the Lists page's Share
  // dialog or the desktop popover can be closed. An inline report is invisible
  // then, so it falls back to a toast.
  it('toasts a failure that lands after its Modal was closed', async () => {
    const d = deferred()
    rotateShareLink.mockReturnValue(d.promise)
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const tree = (open: boolean) => (
      <QueryClientProvider client={qc}>
        <dialog open={open}>
          <PrivacyPanel list={shared} />
        </dialog>
      </QueryClientProvider>
    )
    const { rerender } = render(tree(true))

    await confirmReplace()
    rerender(tree(false))
    d.reject(new Error('network'))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't confirm the link was replaced. Refresh to check before trying again.",
        { type: 'error' },
      ),
    )
    expect(screen.queryByText(failure)).toBeNull()
  })

  it('toasts a failure that lands after the panel unmounted', async () => {
    const d = deferred()
    rotateShareLink.mockReturnValue(d.promise)
    const qc = renderPanel(shared)

    await confirmReplace()
    cleanup()
    d.reject(new Error('network'))

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1))
    expect(qc.isMutating()).toBe(0)
  })

  it('clears the report when the next replace starts', async () => {
    rotateShareLink.mockRejectedValueOnce(new Error('network'))
    rotateShareLink.mockImplementationOnce(() => new Promise(() => {}))
    renderPanel(shared)

    await confirmReplace()
    await screen.findByRole('alert')
    await confirmReplace()

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
