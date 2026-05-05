import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { makeOptimisticBulkDelete, makeOptimisticBulkMove } from './optimistic'

type Row = { id: string; name: string; category_id: string | null }

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
