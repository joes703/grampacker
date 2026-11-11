// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { List } from '../lib/types'

// Mock ONLY the network call; queryKeys and makeOptimisticUpdate stay
// real, so these tests exercise the actual synchronous cache flip the
// races come from.
vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  updateList: vi.fn(),
}))

import { updateList, queryKeys } from '../lib/queries'
import { useListFlagToggle } from './use-list-flag-toggle'
import { deferred } from '../test/deferred'

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

function Probe({ targets, flag = 'isShared' }: { targets: List[]; flag?: 'isShared' | 'isDraft' }) {
  const toggle = useListFlagToggle(flag)
  return (
    <>
      {targets.map((t) => (
        <button key={t.id} onClick={() => toggle.toggle(t)}>
          {flag === 'isShared' ? 'flip' : 'draft'}-{t.id}
        </button>
      ))}
    </>
  )
}

function freshClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData(queryKeys.lists(), [list])
  return qc
}

function renderProbe(targets: List[], seedCache: List[] = targets) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData(queryKeys.lists(), seedCache)
  render(
    <QueryClientProvider client={qc}>
      <Probe targets={targets} />
    </QueryClientProvider>,
  )
  return qc
}

describe('useListFlagToggle', () => {
  it('same-commit-window double activation sends exactly one absolute PATCH', async () => {
    vi.mocked(updateList).mockResolvedValue({ ...list, isShared: true })
    renderProbe([list])

    const button = screen.getByRole('button', { name: 'flip-list-1' })
    // Two synchronous clicks: the REAL optimistic helper has already
    // flipped the cache when the second lands, so without the ref guard
    // it would derive the OPPOSITE target and race it on the wire.
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1))
    expect(updateList).toHaveBeenCalledWith('list-1', { isShared: true })
  })

  it('re-arms after a successful flip and derives the next target from the cache', async () => {
    vi.mocked(updateList).mockResolvedValue({ ...list, isShared: true })
    renderProbe([list])

    const button = screen.getByRole('button', { name: 'flip-list-1' })
    fireEvent.click(button)
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1))

    fireEvent.click(button)
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))
    // First flip targeted true; the optimistic cache row now reads true,
    // so the second flip targets false - never a duplicate body.
    expect(vi.mocked(updateList).mock.calls.map(([, patch]) => patch)).toEqual([
      { isShared: true },
      { isShared: false },
    ])
  })

  it('re-arms after a FAILED flip (rollback restores the original target)', async () => {
    vi.mocked(updateList).mockRejectedValueOnce(new Error('network down'))
    vi.mocked(updateList).mockResolvedValueOnce({ ...list, isShared: true })
    renderProbe([list])

    const button = screen.getByRole('button', { name: 'flip-list-1' })
    fireEvent.click(button)
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1))

    // The helper rolled the cache back to isShared: false, and the
    // per-call onSettled cleared the guard - the retry must go through
    // and target true again.
    fireEvent.click(button)
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))
    expect(vi.mocked(updateList).mock.calls.map(([, patch]) => patch)).toEqual([
      { isShared: true },
      { isShared: true },
    ])
  })

  it('locks per list: an in-flight flip on A does not block B', async () => {
    const listB: List = { ...list, id: 'list-2', slug: 'def456' }
    // Never resolves - A stays in flight for the whole test.
    vi.mocked(updateList).mockReturnValue(new Promise<never>(() => {}))
    renderProbe([list, listB])

    fireEvent.click(screen.getByRole('button', { name: 'flip-list-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'flip-list-2' }))

    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))
    expect(vi.mocked(updateList).mock.calls.map(([id]) => id)).toEqual([
      'list-1',
      'list-2',
    ])
  })

  it('derives the target from the live cache row, not the passed snapshot', async () => {
    vi.mocked(updateList).mockResolvedValue({ ...list, isShared: false })
    // Cache says shared; the prop snapshot lags behind.
    renderProbe([list], [{ ...list, isShared: true }])

    fireEvent.click(screen.getByRole('button', { name: 'flip-list-1' }))

    await waitFor(() => {
      expect(updateList).toHaveBeenCalledWith('list-1', { isShared: false })
    })
  })
})

describe('useListFlagToggle across surfaces', () => {
  it('two mounted surfaces flipping the same flag send one PATCH', async () => {
    vi.mocked(updateList).mockReturnValue(new Promise<never>(() => {}))
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    qc.setQueryData(queryKeys.lists(), [list])
    render(
      <QueryClientProvider client={qc}>
        <Probe targets={[list]} />
        <Probe targets={[list]} />
      </QueryClientProvider>,
    )

    const [first, second] = screen.getAllByRole('button', { name: 'flip-list-1' })
    fireEvent.click(first as HTMLElement)
    fireEvent.click(second as HTMLElement)

    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(updateList).toHaveBeenCalledTimes(1)
  })

  it('a pending share flip does not block a draft flip on the same list', async () => {
    vi.mocked(updateList).mockReturnValue(new Promise<never>(() => {}))
    render(
      <QueryClientProvider client={freshClient()}>
        <Probe targets={[list]} />
        <Probe targets={[list]} flag="isDraft" />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'flip-list-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'draft-list-1' }))

    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))
    expect(vi.mocked(updateList).mock.calls.map(([, patch]) => patch)).toEqual([
      { isShared: true },
      { isDraft: false },
    ])
  })

  it('a surface unmounted mid-flight does not leave the flag locked', async () => {
    let settle!: () => void
    vi.mocked(updateList).mockImplementationOnce(
      () => new Promise((resolve) => { settle = () => resolve({ ...list, isShared: true }) }),
    )
    vi.mocked(updateList).mockResolvedValueOnce({ ...list, isShared: false })
    const qc = freshClient()
    const first = render(
      <QueryClientProvider client={qc}>
        <Probe targets={[list]} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'flip-list-1' }))
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1))
    first.unmount()
    settle()
    await waitFor(() => expect(qc.isMutating()).toBe(0))

    render(
      <QueryClientProvider client={qc}>
        <Probe targets={[list]} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'flip-list-1' }))
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))
  })
})

describe('useListFlagToggle overlapping flips', () => {
  // A share flip and a draft flip on the same list may overlap (the lock is
  // per list AND flag). A failed flip must rewind only its own flag, onto
  // the row as it is now: restoring the whole cached array as it was when the
  // failed flip started would also undo the other flip, which succeeded.
  it('a failed draft flip does not undo a share flip that landed mid-flight', async () => {
    const draft = deferred<List>()
    const share = deferred<List>()
    vi.mocked(updateList)
      .mockReturnValueOnce(draft.promise)
      .mockReturnValueOnce(share.promise)
    const qc = freshClient()
    render(
      <QueryClientProvider client={qc}>
        <Probe targets={[list]} />
        <Probe targets={[list]} flag="isDraft" />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'draft-list-1' }))
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'flip-list-1' }))
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))
    share.resolve({ ...list, isShared: true, isDraft: false })
    await waitFor(() => expect(qc.isMutating()).toBe(1))

    draft.reject(new Error('network down'))
    await waitFor(() => expect(qc.isMutating()).toBe(0))

    const row = qc.getQueryData<List[]>(queryKeys.lists())!.find((l) => l.id === list.id)!
    expect(row.isDraft).toBe(true)
    expect(row.isShared).toBe(true)
  })

  // Same last-one-out rule as gear's updateItem: a refetch fired while a
  // sibling flip is pending can land stale server data over its optimistic
  // value, so overlapping flips refetch once, after the last settles.
  it('overlapping flips refetch the lists once, after the last settles', async () => {
    const draft = deferred<List>()
    const share = deferred<List>()
    vi.mocked(updateList)
      .mockReturnValueOnce(draft.promise)
      .mockReturnValueOnce(share.promise)
    const qc = freshClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const listInvalidations = () =>
      invalidate.mock.calls.filter(
        ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(queryKeys.lists()),
      ).length
    render(
      <QueryClientProvider client={qc}>
        <Probe targets={[list]} />
        <Probe targets={[list]} flag="isDraft" />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'draft-list-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'flip-list-1' }))
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))

    draft.resolve({ ...list, isDraft: false })
    await waitFor(() => expect(qc.isMutating()).toBe(1))
    expect(listInvalidations()).toBe(0)

    share.resolve({ ...list, isDraft: false, isShared: true })
    await waitFor(() => expect(qc.isMutating()).toBe(0))
    expect(listInvalidations()).toBe(1)
  })
})

describe('useListFlagToggle overlapping flips, settling together', () => {
  // TanStack runs onSettled BEFORE it marks the mutation settled, so two flips
  // whose responses land in the same tick can each still count two pending.
  it('refetches the lists once when both flips settle in the same tick', async () => {
    const draft = deferred<List>()
    const share = deferred<List>()
    vi.mocked(updateList)
      .mockReturnValueOnce(draft.promise)
      .mockReturnValueOnce(share.promise)
    const qc = freshClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const listInvalidations = () =>
      invalidate.mock.calls.filter(
        ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(queryKeys.lists()),
      ).length
    render(
      <QueryClientProvider client={qc}>
        <Probe targets={[list]} />
        <Probe targets={[list]} flag="isDraft" />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'draft-list-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'flip-list-1' }))
    await waitFor(() => expect(updateList).toHaveBeenCalledTimes(2))

    draft.resolve({ ...list, isDraft: false })
    share.resolve({ ...list, isDraft: false, isShared: true })
    await waitFor(() => expect(qc.isMutating()).toBe(0))
    expect(listInvalidations()).toBe(1)
  })
})
