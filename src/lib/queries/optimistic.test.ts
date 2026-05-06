import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient, type Mutation } from '@tanstack/react-query'
import {
  makeOptimisticBulkDelete,
  makeOptimisticBulkMove,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  makeOptimisticReorder,
} from './optimistic'
import { mutationErrorHandler } from '../mutation-error-handler'

type Row = { id: string; name: string; category_id: string | null }
type SortableRow = { id: string; name: string; sort_order: number }

function makeClient(initial: Row[]): { qc: QueryClient; key: readonly ['rows'] } {
  const qc = new QueryClient()
  const key = ['rows'] as const
  qc.setQueryData(key, initial)
  return { qc, key }
}

describe('makeOptimisticBulkDelete', () => {
  it('removes every matching row from the cache (happy path)', () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
      { id: 'C', name: 'c', category_id: null },
      { id: 'D', name: 'd', category_id: null },
    ])
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    helper.onMutate(['B', 'D'])
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', category_id: null },
      { id: 'C', name: 'c', category_id: null },
    ])
  })

  it('is a no-op for an empty id set', () => {
    const initial: Row[] = [{ id: 'A', name: 'a', category_id: null }]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    helper.onMutate([])
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    const ctx = helper.onMutate(['A'])
    expect(qc.getQueryData<Row[]>(key)).toEqual([{ id: 'B', name: 'b', category_id: null }])
    helper.onError(new Error('boom'), ['A'], ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('ignores ids that are not in the cache (partial match)', () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
    ])
    const helper = makeOptimisticBulkDelete<Row, string[]>({
      qc,
      queryKey: key,
      ids: (input) => input,
    })
    helper.onMutate(['B', 'X'])
    expect(qc.getQueryData<Row[]>(key)).toEqual([{ id: 'A', name: 'a', category_id: null }])
  })
})

describe('makeOptimisticBulkMove', () => {
  it('applies the patch to every matching row (happy path)', () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', category_id: 'cat1' },
      { id: 'B', name: 'b', category_id: 'cat1' },
    ])
    const helper = makeOptimisticBulkMove<Row, { ids: string[]; categoryId: string | null }>({
      qc,
      queryKey: key,
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, category_id: input.categoryId }),
    })
    helper.onMutate({ ids: ['A'], categoryId: 'cat2' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', category_id: 'cat2' },
      { id: 'B', name: 'b', category_id: 'cat1' },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', category_id: 'cat1' },
      { id: 'B', name: 'b', category_id: 'cat1' },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticBulkMove<Row, { ids: string[]; categoryId: string | null }>({
      qc,
      queryKey: key,
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, category_id: input.categoryId }),
    })
    const ctx = helper.onMutate({ ids: ['A', 'B'], categoryId: 'cat2' })
    expect(qc.getQueryData<Row[]>(key)).not.toEqual(initial)
    helper.onError(new Error('boom'), { ids: ['A', 'B'], categoryId: 'cat2' }, ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('uses the caller-supplied apply function rather than shallow merge', () => {
    type NestedRow = { id: string; meta: { tag: string } }
    const qc = new QueryClient()
    const key = ['nested'] as const
    qc.setQueryData<NestedRow[]>(key, [
      { id: 'A', meta: { tag: 'old' } },
      { id: 'B', meta: { tag: 'old' } },
    ])
    const helper = makeOptimisticBulkMove<NestedRow, { ids: string[]; tag: string }>({
      qc,
      queryKey: key,
      ids: (input) => input.ids,
      apply: (item, input) => ({ ...item, meta: { ...item.meta, tag: input.tag } }),
    })
    helper.onMutate({ ids: ['A'], tag: 'new' })
    expect(qc.getQueryData<NestedRow[]>(key)).toEqual([
      { id: 'A', meta: { tag: 'new' } },
      { id: 'B', meta: { tag: 'old' } },
    ])
  })
})

describe('makeOptimisticInsert', () => {
  it('appends the optimistic row to the cached array (happy path, default merge)', () => {
    const { qc, key } = makeClient([{ id: 'A', name: 'a', category_id: null }])
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, category_id: null }),
    })
    helper.onMutate({ name: 'b' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', category_id: null },
      { id: 'temp-1', name: 'b', category_id: null },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: Row[] = [{ id: 'A', name: 'a', category_id: null }]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, category_id: null }),
    })
    const ctx = helper.onMutate({ name: 'b' })
    helper.onError(new Error('boom'), { name: 'b' }, ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('uses the caller-supplied merge function rather than appending', () => {
    const { qc, key } = makeClient([{ id: 'A', name: 'a', category_id: null }])
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, category_id: null }),
      merge: (current, next) => [next, ...current],
    })
    helper.onMutate({ name: 'b' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'temp-1', name: 'b', category_id: null },
      { id: 'A', name: 'a', category_id: null },
    ])
  })

  it('seeds the cache with the optimistic row when no prior data exists', () => {
    const qc = new QueryClient()
    const key = ['rows'] as const
    // No setQueryData ahead of time — onMutate must still produce a usable
    // cache value.
    const helper = makeOptimisticInsert<Row, { name: string }>({
      qc,
      queryKey: key,
      optimistic: (input) => ({ id: 'temp-1', name: input.name, category_id: null }),
    })
    helper.onMutate({ name: 'b' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'temp-1', name: 'b', category_id: null },
    ])
  })
})

describe('makeOptimisticUpdate', () => {
  it('applies the patch to the row resolved by id (happy path)', () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
    ])
    const helper = makeOptimisticUpdate<Row, { id: string; name: string }>({
      qc,
      queryKey: key,
      id: (input) => input.id,
      apply: (item, input) => ({ ...item, name: input.name }),
    })
    helper.onMutate({ id: 'B', name: 'b-renamed' })
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b-renamed', category_id: null },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticUpdate<Row, { id: string; name: string }>({
      qc,
      queryKey: key,
      id: (input) => input.id,
      apply: (item, input) => ({ ...item, name: input.name }),
    })
    const ctx = helper.onMutate({ id: 'B', name: 'b-renamed' })
    helper.onError(new Error('boom'), { id: 'B', name: 'b-renamed' }, ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('preserves caller-supplied fields like updated_at via apply (M-2 contract)', () => {
    type RowWithTimestamp = Row & { updated_at: string }
    const qc = new QueryClient()
    const key = ['rows'] as const
    qc.setQueryData<RowWithTimestamp[]>(key, [
      { id: 'A', name: 'a', category_id: null, updated_at: '2026-01-01T00:00:00.000Z' },
    ])
    const helper = makeOptimisticUpdate<RowWithTimestamp, { id: string; name: string }>({
      qc,
      queryKey: key,
      id: (input) => input.id,
      apply: (item, input) => ({ ...item, name: input.name, updated_at: '2026-05-06T12:00:00.000Z' }),
    })
    helper.onMutate({ id: 'A', name: 'a-renamed' })
    expect(qc.getQueryData<RowWithTimestamp[]>(key)).toEqual([
      { id: 'A', name: 'a-renamed', category_id: null, updated_at: '2026-05-06T12:00:00.000Z' },
    ])
  })

  it('is a no-op when the cache is undefined (no prior fetch)', () => {
    const qc = new QueryClient()
    const key = ['rows'] as const
    const helper = makeOptimisticUpdate<Row, { id: string; name: string }>({
      qc,
      queryKey: key,
      id: (input) => input.id,
      apply: (item, input) => ({ ...item, name: input.name }),
    })
    helper.onMutate({ id: 'A', name: 'a-renamed' })
    expect(qc.getQueryData<Row[]>(key)).toBeUndefined()
  })
})

describe('makeOptimisticDelete', () => {
  it('removes the row resolved by id from the cache (happy path)', () => {
    const { qc, key } = makeClient([
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
    ])
    const helper = makeOptimisticDelete<Row, string>({
      qc,
      queryKey: key,
      id: (input) => input,
    })
    helper.onMutate('A')
    expect(qc.getQueryData<Row[]>(key)).toEqual([
      { id: 'B', name: 'b', category_id: null },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: Row[] = [
      { id: 'A', name: 'a', category_id: null },
      { id: 'B', name: 'b', category_id: null },
    ]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticDelete<Row, string>({
      qc,
      queryKey: key,
      id: (input) => input,
    })
    const ctx = helper.onMutate('A')
    helper.onError(new Error('boom'), 'A', ctx)
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })

  it('is a no-op when the id is not in the cache', () => {
    const initial: Row[] = [{ id: 'A', name: 'a', category_id: null }]
    const { qc, key } = makeClient(initial)
    const helper = makeOptimisticDelete<Row, string>({
      qc,
      queryKey: key,
      id: (input) => input,
    })
    helper.onMutate('Z')
    expect(qc.getQueryData<Row[]>(key)).toEqual(initial)
  })
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

  it('applies sort_order patches and re-sorts the cache (happy path)', () => {
    const { qc, key } = makeSortableClient([
      { id: 'A', name: 'a', sort_order: 10 },
      { id: 'B', name: 'b', sort_order: 20 },
      { id: 'C', name: 'c', sort_order: 30 },
    ])
    const helper = makeOptimisticReorder<SortableRow>(qc, key)
    // Swap A and C: A→30, C→10. Re-sorted: C, B, A.
    helper.onMutate([
      { id: 'A', sort_order: 30 },
      { id: 'C', sort_order: 10 },
    ])
    expect(qc.getQueryData<SortableRow[]>(key)).toEqual([
      { id: 'C', name: 'c', sort_order: 10 },
      { id: 'B', name: 'b', sort_order: 20 },
      { id: 'A', name: 'a', sort_order: 30 },
    ])
  })

  it('rolls back on error to the pre-apply snapshot', () => {
    const initial: SortableRow[] = [
      { id: 'A', name: 'a', sort_order: 10 },
      { id: 'B', name: 'b', sort_order: 20 },
    ]
    const { qc, key } = makeSortableClient(initial)
    const helper = makeOptimisticReorder<SortableRow>(qc, key)
    const ctx = helper.onMutate([
      { id: 'A', sort_order: 20 },
      { id: 'B', sort_order: 10 },
    ])
    helper.onError(new Error('boom'), undefined, ctx)
    expect(qc.getQueryData<SortableRow[]>(key)).toEqual(initial)
  })

  it('leaves untouched rows in their original sort_order slots', () => {
    const { qc, key } = makeSortableClient([
      { id: 'A', name: 'a', sort_order: 10 },
      { id: 'B', name: 'b', sort_order: 20 },
      { id: 'C', name: 'c', sort_order: 30 },
      { id: 'D', name: 'd', sort_order: 40 },
    ])
    const helper = makeOptimisticReorder<SortableRow>(qc, key)
    // Only swap B and C; A and D unchanged.
    helper.onMutate([
      { id: 'B', sort_order: 30 },
      { id: 'C', sort_order: 20 },
    ])
    expect(qc.getQueryData<SortableRow[]>(key)).toEqual([
      { id: 'A', name: 'a', sort_order: 10 },
      { id: 'C', name: 'c', sort_order: 20 },
      { id: 'B', name: 'b', sort_order: 30 },
      { id: 'D', name: 'd', sort_order: 40 },
    ])
  })
})

describe('mutationErrorHandler (MutationCache observability, M-1)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  function makeMutation(mutationKey: readonly unknown[] | undefined): Mutation<unknown, unknown, unknown> {
    // The handler only reads mutation.options.mutationKey; everything else
    // can be a placeholder.
    return { options: { mutationKey } } as Mutation<unknown, unknown, unknown>
  }

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('logs structured warn with the mutationKey-joined prefix (Error instance)', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutation = makeMutation(['gear-items', 'create'])
    mutationErrorHandler(new Error('permission denied'), undefined, undefined, mutation)
    expect(warnSpy).toHaveBeenCalledWith('[gear-items/create] failed', {
      error: 'permission denied',
      code: undefined,
      mutationKey: ['gear-items', 'create'],
    })
  })

  it('extracts the code property from a plain (non-Error) object payload', () => {
    // Plain objects don't go through the `error.message` branch — they're
    // stringified via String(error), which produces '[object Object]'. The
    // code property is still extracted via the typeguard. This shape is
    // unusual in practice (Supabase's PostgrestError extends Error) but
    // locks the typeguard's positive case for any future caller that
    // throws a literal object.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutation = makeMutation(['list-items', 'add'])
    const pgErrorObject = { message: 'permission denied', code: '42501' }
    mutationErrorHandler(pgErrorObject, undefined, undefined, mutation)
    expect(warnSpy).toHaveBeenCalledWith('[list-items/add] failed', {
      error: '[object Object]',
      code: '42501',
      mutationKey: ['list-items', 'add'],
    })
  })

  it('extracts code from an Error subclass that also carries a code property', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    class PgError extends Error {
      code: string
      constructor(message: string, code: string) {
        super(message)
        this.code = code
      }
    }
    const mutation = makeMutation(['categories', 'delete'])
    mutationErrorHandler(new PgError('row violates RLS', '42501'), undefined, undefined, mutation)
    expect(warnSpy).toHaveBeenCalledWith('[categories/delete] failed', {
      error: 'row violates RLS',
      code: '42501',
      mutationKey: ['categories', 'delete'],
    })
  })

  it('stringifies non-Error, non-object error values', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutation = makeMutation(['lists', 'reorder'])
    mutationErrorHandler('plain string error', undefined, undefined, mutation)
    expect(warnSpy).toHaveBeenCalledWith('[lists/reorder] failed', {
      error: 'plain string error',
      code: undefined,
      mutationKey: ['lists', 'reorder'],
    })
  })

  it("falls back to '[mutation] failed' prefix when mutationKey is unset", () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mutation = makeMutation(undefined)
    mutationErrorHandler(new Error('boom'), undefined, undefined, mutation)
    expect(warnSpy).toHaveBeenCalledWith('[mutation] failed', {
      error: 'boom',
      code: undefined,
      mutationKey: undefined,
    })
  })
})
