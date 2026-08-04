import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'

vi.mock('../toast', () => ({
  showToast: vi.fn(),
}))

import {
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  makeOptimisticBulkDelete,
  makeOptimisticBulkUpdate,
  makeOptimisticReorder,
} from './optimistic'
import { showToast } from '../toast'

type Row = { id: string; name: string; categoryId: string | null }
type SortableRow = { id: string; name: string; sortOrder: number }

function makeClient(initial: Row[]): { qc: QueryClient; key: readonly ['rows'] } {
  const qc = new QueryClient()
  const key = ['rows'] as const
  qc.setQueryData(key, initial)
  return { qc, key }
}

describe('makeOptimisticInsert', () => {
  it('appends the optimistic row to the cached array (happy path, default merge)', async () => {
    const { qc, key } = makeClient([{ id: 'A', name: 'a', categoryId: null }])
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, categoryId: null }),
    })
    await helper.onMutate({ name: 'b' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', categoryId: null },
      { id: 'temp-1', name: 'b', categoryId: null },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', async () => {
    const initial: Row[] = [{ id: 'A', name: 'a', categoryId: null }]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, categoryId: null }),
    })
    const ctx = await helper.onMutate({ name: 'b' })
    helper.onError(new Error('boom'), { name: 'b' }, ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('uses the caller-supplied merge function rather than appending', async () => {
    const { qc, key } = makeClient([{ id: 'A', name: 'a', categoryId: null }])
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, categoryId: null }),
      merge: (current, next) => [next, ...current],
    })
    await helper.onMutate({ name: 'b' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'temp-1', name: 'b', categoryId: null },
      { id: 'A', name: 'a', categoryId: null },
    ])
  })

  // The two halves of the absent-vs-empty distinction. This helper used to
  // seed an absent cache with the placeholder, which fabricated a collection
  // the user never loaded: `data` flipping from undefined to defined is the
  // signal every page reads as "the fetch resolved", so creating while the
  // library had failed to load replaced the failure state with a one-row
  // library and hid every real row.
  it('leaves an ABSENT cache absent rather than seeding one', async () => {
    const qc = new QueryClient()
    const key = ['rows'] as const
    // No setQueryData ahead of time: this query has never resolved.
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, categoryId: null }),
    })
    const ctx = await helper.onMutate({ name: 'b' })
    expect(qc.getQueryData<Row[]>(key)).toBeUndefined()
    // And the rollback keeps it absent rather than writing an empty array.
    helper.onError(new Error('boom'), { name: 'b' }, ctx)
    expect(qc.getQueryData<Row[]>(key)).toBeUndefined()
  })

  it('still applies the placeholder to a LOADED empty collection', async () => {
    // [] that came back from the server is the user's actual collection, not
    // absence. This is the first-list / first-packing-location case, and it
    // keeps its optimistic feedback.
    const { qc, key } = makeClient([])
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, categoryId: null }),
    })
    await helper.onMutate({ name: 'b' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'temp-1', name: 'b', categoryId: null },
    ])
  })
})

describe('makeOptimisticUpdate', () => {
  it('applies the patch to the row resolved by id (happy path)', async () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', categoryId: null },
      { id: 'B', name: 'b', categoryId: null },
    ])
    const helper = makeOptimisticUpdate<Row, { id: string; name: string }>({
      qc,
      queryKey: key,
      id: (input) => input.id,
      apply: (item, input) => ({ ...item, name: input.name }),
    })
    await helper.onMutate({ id: 'B', name: 'b-renamed' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', categoryId: null },
      { id: 'B', name: 'b-renamed', categoryId: null },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', async () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', categoryId: null },
      { id: 'B', name: 'b', categoryId: null },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticUpdate<Row, { id: string; name: string }>({
      qc,
      queryKey: key,
      id: (input) => input.id,
      apply: (item, input) => ({ ...item, name: input.name }),
    })
    const ctx = await helper.onMutate({ id: 'B', name: 'b-renamed' })
    helper.onError(new Error('boom'), { id: 'B', name: 'b-renamed' }, ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('preserves caller-supplied fields like updatedAt via apply (M-2 contract)', async () => {
    type RowWithTimestamp = Row & { updatedAt: string }
    const qc = new QueryClient()
    const key = ['rows'] as const
    qc.setQueryData<RowWithTimestamp[]>(key, [
      { id: 'A', name: 'a', categoryId: null, updatedAt: '2026-01-01T00:00:00.000Z' },
    ])
    const helper = makeOptimisticUpdate<RowWithTimestamp, { id: string; name: string }>({
      qc,
      queryKey: key,
      id: (input) => input.id,
      apply: (item, input) => ({ ...item, name: input.name, updatedAt: '2026-05-06T12:00:00.000Z' }),
    })
    await helper.onMutate({ id: 'A', name: 'a-renamed' })
    expect(qc.getQueryData<RowWithTimestamp[]>(key)).toEqual([
      { id: 'A', name: 'a-renamed', categoryId: null, updatedAt: '2026-05-06T12:00:00.000Z' },
    ])
  })

  it('is a no-op when the cache is undefined (no prior fetch)', async () => {
    const qc = new QueryClient()
    const key = ['rows'] as const
    const helper = makeOptimisticUpdate<Row, { id: string; name: string }>({
      qc,
      queryKey: key,
      id: (input) => input.id,
      apply: (item, input) => ({ ...item, name: input.name }),
    })
    await helper.onMutate({ id: 'A', name: 'a-renamed' })
    expect(qc.getQueryData<Row[]>(key)).toBeUndefined()
  })
})

describe('makeOptimisticDelete', () => {
  it('removes the row resolved by id from the cache (happy path)', async () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', categoryId: null },
      { id: 'B', name: 'b', categoryId: null },
    ])
    const helper = makeOptimisticDelete<Row, string>({
      qc,
      queryKey: key,
      id: (input) => input,
    })
    await helper.onMutate('A')
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'B', name: 'b', categoryId: null },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', async () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', categoryId: null },
      { id: 'B', name: 'b', categoryId: null },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticDelete<Row, string>({
      qc,
      queryKey: key,
      id: (input) => input,
    })
    const ctx = await helper.onMutate('A')
    helper.onError(new Error('boom'), 'A', ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('is a no-op when the id is not in the cache', async () => {
    const initial: Row[] = [{ id: 'A', name: 'a', categoryId: null }]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticDelete<Row, string>({
      qc,
      queryKey: key,
      id: (input) => input,
    })
    await helper.onMutate('Z')
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })
})

describe('makeOptimisticBulkDelete', () => {
  it('removes every row in the id set in one write (happy path)', async () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', categoryId: null },
      { id: 'B', name: 'b', categoryId: null },
      { id: 'C', name: 'c', categoryId: null },
    ])
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    await helper.onMutate(['A', 'C'])
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'B', name: 'b', categoryId: null },
    ])
  })

  it('rolls back on error to the pre-apply snapshot and shows the errorToast', async () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', categoryId: null },
      { id: 'B', name: 'b', categoryId: null },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      errorToast: 'Bulk delete failed.',
      ids: (input) => input,
    })
    const ctx = await helper.onMutate(['A', 'B'])
    helper.onError(new Error('boom'), ['A', 'B'], ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
    expect(showToast).toHaveBeenCalledWith('Bulk delete failed.', { type: 'error' })
  })

  it('is a no-op when the cache is undefined (no prior fetch)', async () => {
    const qc = new QueryClient()
    const key = ['rows'] as const
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    await helper.onMutate(['A'])
    expect(qc.getQueryData<Row[]>(key)).toBeUndefined()
  })
})

describe('makeOptimisticBulkUpdate', () => {
  type MoveInput = { ids: string[]; categoryId: string | null }

  it('applies the transform to every row in the id set and no others (happy path)', async () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', categoryId: 'c1' },
      { id: 'B', name: 'b', categoryId: 'c1' },
      { id: 'C', name: 'c', categoryId: 'c2' },
    ])
    const helper = makeOptimisticBulkUpdate<Row, MoveInput>({
      qc,
      queryKey: key,
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, categoryId: input.categoryId }),
    })
    await helper.onMutate({ ids: ['A', 'C'], categoryId: null })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', categoryId: null },
      { id: 'B', name: 'b', categoryId: 'c1' },
      { id: 'C', name: 'c', categoryId: null },
    ])
  })

  it('rolls back on error to the pre-apply snapshot and shows the errorToast', async () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', categoryId: 'c1' },
      { id: 'B', name: 'b', categoryId: 'c1' },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticBulkUpdate<Row, MoveInput>({
      qc,
      queryKey: key,
      errorToast: 'Bulk move failed.',
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, categoryId: input.categoryId }),
    })
    const ctx = await helper.onMutate({ ids: ['A', 'B'], categoryId: 'c9' })
    helper.onError(new Error('boom'), { ids: ['A', 'B'], categoryId: 'c9' }, ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
    expect(showToast).toHaveBeenCalledWith('Bulk move failed.', { type: 'error' })
  })

  it('is a no-op when the cache is undefined (no prior fetch)', async () => {
    const qc = new QueryClient()
    const key = ['rows'] as const
    const helper = makeOptimisticBulkUpdate<Row, MoveInput>({
      qc,
      queryKey: key,
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, categoryId: input.categoryId }),
    })
    await helper.onMutate({ ids: ['A'], categoryId: null })
    expect(qc.getQueryData<Row[]>(key)).toBeUndefined()
  })
})

// The mechanism suite for the awaited cancelQueries in every CRUD onMutate.
//
// READ THIS BEFORE TRUSTING IT, because what it proves is narrower than its name
// suggests, and the narrow version is the honest one.
//
// cancelQueries issues query.cancel() SYNCHRONOUSLY, and cancel() rejects the
// retryer's thenable in that same tick; a response arriving afterwards is dropped by
// an isResolved() guard. So for a fetch that is still genuinely PENDING, an unawaited
// cancel is already safe and awaiting buys nothing.
//
// The only hole is the sliver AFTER the fetch's promise has resolved but BEFORE the
// query has written the result. There cancel() finds a settled thenable and no-ops,
// while the write sits queued - and an unawaited cancel lets it land ON TOP of the
// optimistic state. Measured at a one-microtask offset:
//
//   void qc.cancelQueries(...)   ->  [A, STALE]   the row we deleted is BACK
//   await qc.cancelQueries(...)  ->  [STALE]      deletion survives, stale under it
//
// That sliver is NOT reachable from a user gesture: the browser drains the whole
// microtask checkpoint - including the query's write - before dispatching the next
// task, and a click is a task. Reaching it requires firing the mutation from a
// promise continuation already queued in that checkpoint, which is what the
// `await Promise.resolve()` below simulates. So these tests pin the MECHANISM and
// protect promise-chained callers (ListDetailPage's dialog chains mutateAsync ->
// mutateAsync); they are not evidence of a clobber a user has suffered. Do not cite
// them as one.
//
// The `await Promise.resolve()` is load-bearing all the same. An earlier draft let
// the response land zero microtasks late - the ONE offset where both variants are
// safe - and so it passed happily against the buggy code. A regression test that
// cannot fail on the bug is decoration.
describe('an in-flight refetch cannot clobber an optimistic CRUD write', () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  const CACHED: Row[] = [
    { id: 'A', name: 'a', categoryId: null },
    { id: 'B', name: 'b', categoryId: null },
  ]
  // Server truth from BEFORE the user acted. Identifiable by the extra row C.
  const STALE_FROM_SERVER: Row[] = [
    { id: 'A', name: 'a', categoryId: null },
    { id: 'B', name: 'b', categoryId: null },
    { id: 'C', name: 'c-from-a-stale-read', categoryId: null },
  ]

  // Each case fires one helper, then names the optimistic effect that must still be
  // visible. Asserting the EFFECT rather than the whole array is deliberate: the
  // stale response does land (underneath), so the final array is the optimistic op
  // applied to STALE_FROM_SERVER. What must never happen is the effect being erased
  // - which is precisely what the clobber does.
  const cases: {
    name: string
    fire: (qc: QueryClient, key: QueryKey) => Promise<unknown>
    survives: (rows: Row[]) => void
  }[] = [
    {
      name: 'insert',
      fire: (qc, queryKey) =>
        makeOptimisticInsert<Row, { name: string }>({
          qc,
          queryKey,
          optimistic: (input) => ({ id: 'temp-1', name: input.name, categoryId: null }),
        }).onMutate({ name: 'new' }),
      survives: (rows) => expect(rows.map((r) => r.id)).toContain('temp-1'),
    },
    {
      name: 'update',
      fire: (qc, queryKey) =>
        makeOptimisticUpdate<Row, { id: string; name: string }>({
          qc,
          queryKey,
          id: (input) => input.id,
          apply: (item, input) => ({ ...item, name: input.name }),
        }).onMutate({ id: 'B', name: 'renamed' }),
      survives: (rows) => expect(rows.find((r) => r.id === 'B')?.name).toBe('renamed'),
    },
    {
      name: 'delete',
      fire: (qc, queryKey) =>
        makeOptimisticDelete<Row, string>({
          qc,
          queryKey,
          id: (id) => id,
        }).onMutate('B'),
      survives: (rows) => expect(rows.map((r) => r.id)).not.toContain('B'),
    },
    {
      name: 'bulk delete',
      fire: (qc, queryKey) =>
        makeOptimisticBulkDelete<Row, string[]>({
          qc,
          queryKey,
          ids: (ids) => ids,
        }).onMutate(['A', 'B']),
      survives: (rows) => {
        expect(rows.map((r) => r.id)).not.toContain('A')
        expect(rows.map((r) => r.id)).not.toContain('B')
      },
    },
    {
      name: 'bulk update',
      fire: (qc, queryKey) =>
        makeOptimisticBulkUpdate<Row, { ids: string[]; categoryId: string | null }>({
          qc,
          queryKey,
          ids: (input) => input.ids,
          apply: (item, input) => ({ ...item, categoryId: input.categoryId }),
        }).onMutate({ ids: ['A'], categoryId: 'c9' }),
      survives: (rows) => expect(rows.find((r) => r.id === 'A')?.categoryId).toBe('c9'),
    },
  ]

  for (const { name, fire, survives } of cases) {
    it(`${name}: the optimistic write survives a refetch landing underneath it`, async () => {
      // retry: false so a cancelled fetch settles instead of being retried.
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const key = ['rows'] as const
      qc.setQueryData<Row[]>(key, CACHED)

      const server = deferred<Row[]>()
      const inFlight = qc
        .fetchQuery({ queryKey: key, queryFn: () => server.promise })
        // Cancelling a pending fetch rejects with CancelledError. Expected.
        .catch(() => undefined)
      server.resolve(STALE_FROM_SERVER)

      // Advance to the dangerous offset: the response has resolved, and its cache
      // write is queued but has NOT run. Delete this line and the suite passes
      // against the very bug it exists to catch.
      await Promise.resolve()

      await fire(qc, key)
      await inFlight

      const rows = qc.getQueryData<Row[]>(key)!
      // The stale response does land, underneath. That is fine and expected.
      expect(rows.map((r) => r.id)).toContain('C')
      // What must never be erased:
      survives(rows)
    })
  }
})

describe('makeOptimisticReorder', () => {
  function makeSortableClient(initial: SortableRow[]): {
    qc: QueryClient
    key: readonly ['sortable']
  } {
    const qc = new QueryClient()
    const key = ['sortable'] as const
    qc.setQueryData(key, initial)
    return { qc, key }
  }

  it('onMutate is SYNCHRONOUS - it must not become a promise', () => {
    // The deliberate asymmetry with the CRUD helpers above, pinned so nobody
    // "makes them consistent" and reintroduces a visual bug.
    //
    // Reorder is fired from dnd-kit's onDragEnd, and dnd-kit starts its drop
    // animation in the same synchronous tick that onDragEnd returns. If onMutate
    // returned a promise, the cache write would land one microtask later, the
    // animation would run against the OLD DOM order, and the dropped row would
    // visibly snap back to where it started before jumping to its new home.
    //
    // The price is the in-flight-refetch race the CRUD suite above proves and
    // prevents: reorder ACCEPTS it. It is rare (staleTime 30s), it self-heals
    // (onSettled invalidates regardless), and a wrong-for-a-moment order is a far
    // cheaper failure than a janky drag on every single drop.
    const { qc, key } = makeSortableClient([
      { id: 'A', name: 'a', sortOrder: 10 },
      { id: 'B', name: 'b', sortOrder: 20 },
    ])
    const helper = makeOptimisticReorder<SortableRow>(qc, key)

    const ctx = helper.onMutate([
      { id: 'A', sortOrder: 20 },
      { id: 'B', sortOrder: 10 },
    ])

    expect(ctx).not.toBeInstanceOf(Promise)
    // And the write is already visible, in this same tick - no await anywhere.
    expect(qc.getQueryData<SortableRow[]>(key)!.map((r) => r.id)).toEqual(['B', 'A'])
  })

  it('applies sortOrder patches and re-sorts the cache (happy path)', () => {
    const { qc, key } = makeSortableClient([
      { id: 'A', name: 'a', sortOrder: 10 },
      { id: 'B', name: 'b', sortOrder: 20 },
      { id: 'C', name: 'c', sortOrder: 30 },
    ])
    const helper = makeOptimisticReorder<SortableRow>(qc, key)
    // Swap A and C: A→30, C→10. Re-sorted: C, B, A.
    helper.onMutate([
      { id: 'A', sortOrder: 30 },
      { id: 'C', sortOrder: 10 },
    ])
    expect(qc.getQueryData<SortableRow[]>(key)).toEqual([
      { id: 'C', name: 'c', sortOrder: 10 },
      { id: 'B', name: 'b', sortOrder: 20 },
      { id: 'A', name: 'a', sortOrder: 30 },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: SortableRow[] = [
      { id: 'A', name: 'a', sortOrder: 10 },
      { id: 'B', name: 'b', sortOrder: 20 },
    ]
    const { qc, key } = makeSortableClient(initial)
    const helper = makeOptimisticReorder<SortableRow>(qc, key)
    const ctx = helper.onMutate([
      { id: 'A', sortOrder: 20 },
      { id: 'B', sortOrder: 10 },
    ])
    helper.onError(new Error('boom'), undefined, ctx)
    expect(qc.getQueryData<SortableRow[]>(key)).toEqual(initial)
  })

  it('leaves untouched rows in their original sortOrder slots', () => {
    const { qc, key } = makeSortableClient([
      { id: 'A', name: 'a', sortOrder: 10 },
      { id: 'B', name: 'b', sortOrder: 20 },
      { id: 'C', name: 'c', sortOrder: 30 },
      { id: 'D', name: 'd', sortOrder: 40 },
    ])
    const helper = makeOptimisticReorder<SortableRow>(qc, key)
    // Only swap B and C; A and D unchanged.
    helper.onMutate([
      { id: 'B', sortOrder: 30 },
      { id: 'C', sortOrder: 20 },
    ])
    expect(qc.getQueryData<SortableRow[]>(key)).toEqual([
      { id: 'A', name: 'a', sortOrder: 10 },
      { id: 'C', name: 'c', sortOrder: 20 },
      { id: 'B', name: 'b', sortOrder: 30 },
      { id: 'D', name: 'd', sortOrder: 40 },
    ])
  })

  // ── Dev-only invariant assertion ─────────────────────────────────────────
  //
  // Vitest sets `import.meta.env.DEV` to `true` by default, so the assertion
  // in makeOptimisticReorder runs in this suite. In production builds Vite
  // statically replaces `import.meta.env.DEV` with `false` and the assertion
  // (and its helper) tree-shake out. The throw is a programmer-error signal
  // for caller bugs that would otherwise silently corrupt the optimistic
  // cache until the next refetch (see the helper's docstring).
  describe('dev-only payload assertion', () => {
    it('accepts a subset payload (cached ids absent from payload do NOT trigger the assertion)', () => {
      // The contract documented at optimistic.ts:51-59 explicitly allows
      // SUBSET permutations: only the dragged category's items appear in
      // the payload while other categories' items stay in their slots.
      // assignSortOrderSlots() in grouping.ts produces exactly these
      // shapes for within-category DnD on /lists/:id. Locking this case
      // here keeps the assertion from regressing into a stricter rule
      // that breaks legitimate callers.
      const { qc, key } = makeSortableClient([
        { id: 'A', name: 'a', sortOrder: 10 },
        { id: 'B', name: 'b', sortOrder: 20 },
        { id: 'C', name: 'c', sortOrder: 30 },
        { id: 'D', name: 'd', sortOrder: 40 },
      ])
      const helper = makeOptimisticReorder<SortableRow>(qc, key)
      expect(() =>
        helper.onMutate([
          { id: 'B', sortOrder: 30 },
          { id: 'C', sortOrder: 20 },
        ]),
      ).not.toThrow()
    })

    it('throws on a duplicate id in the payload', () => {
      const { qc, key } = makeSortableClient([
        { id: 'A', name: 'a', sortOrder: 10 },
        { id: 'B', name: 'b', sortOrder: 20 },
      ])
      const helper = makeOptimisticReorder<SortableRow>(qc, key)
      expect(() =>
        helper.onMutate([
          { id: 'A', sortOrder: 20 },
          { id: 'A', sortOrder: 10 },
        ]),
      ).toThrow(/duplicate id "A"/)
    })

    it('throws when the payload references an id not in the cache', () => {
      // Same condition as the spec's "missing cached id": an id present
      // in the payload that has no row in the cache. The current
      // map-and-spread code silently no-ops such ids; the assertion
      // surfaces the caller bug instead.
      const { qc, key } = makeSortableClient([
        { id: 'A', name: 'a', sortOrder: 10 },
        { id: 'B', name: 'b', sortOrder: 20 },
      ])
      const helper = makeOptimisticReorder<SortableRow>(qc, key)
      expect(() =>
        helper.onMutate([
          { id: 'A', sortOrder: 20 },
          { id: 'X', sortOrder: 10 },
        ]),
      ).toThrow(/payload id "X" is not in the cached list/)
    })

    it('throws when the payload sort_orders are not a permutation of the touched subset', () => {
      // The exact silent-corruption case the helper's docstring warns
      // about: payload covers the right id subset {A, C}, but uses
      // sort_orders {5, 15} instead of a permutation of the subset's
      // existing sort_orders {10, 30}. Without the assertion the cache
      // ends up [B=20, A=5, C=15] → sorted [A=5, C=15, B=20], which
      // diverges from any valid server state.
      const { qc, key } = makeSortableClient([
        { id: 'A', name: 'a', sortOrder: 10 },
        { id: 'B', name: 'b', sortOrder: 20 },
        { id: 'C', name: 'c', sortOrder: 30 },
      ])
      const helper = makeOptimisticReorder<SortableRow>(qc, key)
      expect(() =>
        helper.onMutate([
          { id: 'A', sortOrder: 5 },
          { id: 'C', sortOrder: 15 },
        ]),
      ).toThrow(/not a permutation of the touched subset's existing sort_orders/)
    })

    it('leaves the cache untouched when the assertion throws (no partial write)', () => {
      // The assertion runs after cancelQueries/snapshot but before
      // setQueryData, so a thrown error must NOT mutate the cache.
      // Locking this means dev errors don't leave the UI in a
      // half-applied optimistic state.
      const initial: SortableRow[] = [
        { id: 'A', name: 'a', sortOrder: 10 },
        { id: 'B', name: 'b', sortOrder: 20 },
      ]
      const { qc, key } = makeSortableClient(initial)
      const helper = makeOptimisticReorder<SortableRow>(qc, key)
      expect(() =>
        helper.onMutate([
          { id: 'A', sortOrder: 20 },
          { id: 'A', sortOrder: 10 },
        ]),
      ).toThrow()
      expect(qc.getQueryData<SortableRow[]>(key)).toEqual(initial)
    })
  })

  // ── Production safety branch ─────────────────────────────────────────────
  //
  // The DEV assertion is tree-shaken out in production builds; without a
  // prod-side defense, a malformed payload would silently write `undefined`
  // into sortOrder via the non-null assertion in the cache updater. The
  // prod branch detects + logs + throws a tagged error that onError
  // recognizes (no rollback toast). onSettled's invalidate then pulls
  // authoritative server truth.
  describe('production safety branch', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.mocked(showToast).mockReset()
    })

    it('does not write the cache and throws a recognizable validation error in prod', () => {
      vi.stubEnv('DEV', false)
      const initial: SortableRow[] = [
        { id: 'A', name: 'a', sortOrder: 10 },
        { id: 'B', name: 'b', sortOrder: 20 },
      ]
      const { qc, key } = makeSortableClient(initial)
      const helper = makeOptimisticReorder<SortableRow>(qc, key)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      let caught: unknown
      try {
        helper.onMutate([
          { id: 'A', sortOrder: 20 },
          { id: 'A', sortOrder: 10 },
        ])
      } catch (e) {
        caught = e
      }

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).name).toBe('OptimisticReorderValidationError')
      expect(qc.getQueryData<SortableRow[]>(key)).toEqual(initial)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })

    it('onError treats the validation error as silent (no rollback toast)', () => {
      // The tagged error is the signal: cache wasn't written, nothing to
      // roll back; the user shouldn't see a generic "couldn't save" toast
      // for a programmer-error case they didn't cause. onSettled's
      // invalidate (not asserted here) handles the cache refresh.
      vi.stubEnv('DEV', false)
      const { qc, key } = makeSortableClient([
        { id: 'A', name: 'a', sortOrder: 10 },
        { id: 'B', name: 'b', sortOrder: 20 },
      ])
      const helper = makeOptimisticReorder<SortableRow>(qc, key)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      let caught: unknown
      try {
        helper.onMutate([{ id: 'A', sortOrder: 20 }, { id: 'A', sortOrder: 10 }])
      } catch (e) {
        caught = e
      }
      // Simulate TanStack's onError handoff: ctx is undefined because
      // onMutate threw before returning.
      helper.onError(caught, [], undefined)

      expect(showToast).not.toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })

    it('onError still shows the toast for non-validation errors (server-side failures)', () => {
      // Regression guard: the silent branch must only trigger for the
      // validation sentinel. A real network/server failure must still
      // surface to the user.
      const { qc, key } = makeSortableClient([
        { id: 'A', name: 'a', sortOrder: 10 },
        { id: 'B', name: 'b', sortOrder: 20 },
      ])
      const helper = makeOptimisticReorder<SortableRow>(qc, key)
      const ctx = helper.onMutate([
        { id: 'A', sortOrder: 20 },
        { id: 'B', sortOrder: 10 },
      ])
      helper.onError(new Error('network 500'), [], ctx)
      expect(showToast).toHaveBeenCalledWith(
        expect.stringMatching(/save the new order/i),
        expect.objectContaining({ type: 'error' }),
      )
    })
  })
})
