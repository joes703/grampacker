import { describe, it, expect, beforeEach, vi } from 'vitest'

// Unit-level coverage for the four reorder wrappers. The companion file
// queries.bulk-reorder.test.ts hits real Supabase and skips when
// TEST_USER_EMAIL/PASSWORD aren't set; CLAUDE.md flags exactly that
// silent-skip mode as a historic source of regressions ("the bulk-
// reorder helper was silently broken for categories for weeks because
// the existing test exercised an unused gear_items path"). These tests
// mock supabase.rpc so every CI run, with or without secrets, asserts:
//   1. each wrapper routes to the correct `p_table`
//   2. the payload is exactly `{ p_table, p_ids, p_orders }`, with
//      `p_ids` / `p_orders` containing id + sort_order only (no
//      pass-through of other fields from the input rows)
//   3. errors propagate with `code` preserved
//   4. an empty `updates` array is a no-op (no rpc call)

const mockState = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; params: Record<string, unknown> }[],
  nextResponse: { error: null as { code?: string; message: string } | null },
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (fn: string, params: Record<string, unknown>) => {
      mockState.rpcCalls.push({ fn, params })
      return Promise.resolve(mockState.nextResponse)
    },
  },
}))

import { reorderCategories } from './queries/categories'
import { reorderGearItems } from './queries/gear'
import { reorderListItems, reorderLists } from './queries'

beforeEach(() => {
  mockState.rpcCalls.length = 0
  mockState.nextResponse = { error: null }
})

describe('bulk reorder wrappers route to the correct table', () => {
  it('reorderCategories → p_table: "categories"', async () => {
    await reorderCategories([{ id: 'c1', sort_order: 0 }])
    expect(mockState.rpcCalls).toHaveLength(1)
    expect(mockState.rpcCalls[0]?.fn).toBe('bulk_update_sort_order')
    expect(mockState.rpcCalls[0]?.params.p_table).toBe('categories')
  })

  it('reorderGearItems → p_table: "gear_items"', async () => {
    await reorderGearItems([{ id: 'g1', sort_order: 0 }])
    expect(mockState.rpcCalls).toHaveLength(1)
    expect(mockState.rpcCalls[0]?.fn).toBe('bulk_update_sort_order')
    expect(mockState.rpcCalls[0]?.params.p_table).toBe('gear_items')
  })

  it('reorderListItems → p_table: "list_items"', async () => {
    await reorderListItems([{ id: 'li1', sort_order: 0 }])
    expect(mockState.rpcCalls).toHaveLength(1)
    expect(mockState.rpcCalls[0]?.fn).toBe('bulk_update_sort_order')
    expect(mockState.rpcCalls[0]?.params.p_table).toBe('list_items')
  })

  it('reorderLists → p_table: "lists"', async () => {
    await reorderLists([{ id: 'l1', sort_order: 0 }])
    expect(mockState.rpcCalls).toHaveLength(1)
    expect(mockState.rpcCalls[0]?.fn).toBe('bulk_update_sort_order')
    expect(mockState.rpcCalls[0]?.params.p_table).toBe('lists')
  })
})

describe('bulk reorder payload shape', () => {
  it('passes exactly id + sort_order through; extra fields on input rows are not forwarded', async () => {
    // bulkUpdateSortOrder is generic over `{id, sort_order} & ...`; the
    // wrappers don't widen the SQL payload. The RPC accepts ONLY
    // p_table / p_ids / p_orders. Catching a regression here prevents a
    // future refactor from accidentally forwarding e.g. `name` into the
    // RPC call's params (the function is SECURITY INVOKER since
    // 20260514202025_reduce_security_definer).
    await reorderCategories([
      // @ts-expect-error -- the helper accepts T extends {id, sort_order}
      // but the wrappers are narrowed. Cast through to simulate a caller
      // accidentally passing a wider row shape.
      { id: 'c1', sort_order: 5, name: 'leaked-name', user_id: 'leaked-uid' },
      // @ts-expect-error -- same reason
      { id: 'c2', sort_order: 6, name: 'also-leaked' },
    ])

    expect(mockState.rpcCalls).toHaveLength(1)
    const params = mockState.rpcCalls[0]?.params ?? {}
    // Exactly these keys, nothing else.
    expect(Object.keys(params).sort()).toEqual(['p_ids', 'p_orders', 'p_table'])
    expect(params.p_ids).toEqual(['c1', 'c2'])
    expect(params.p_orders).toEqual([5, 6])
  })

  it('preserves input order in p_ids / p_orders (paired by index, not sorted)', async () => {
    await reorderGearItems([
      { id: 'g3', sort_order: 20 },
      { id: 'g1', sort_order: 10 },
      { id: 'g2', sort_order: 30 },
    ])
    const params = mockState.rpcCalls[0]?.params ?? {}
    expect(params.p_ids).toEqual(['g3', 'g1', 'g2'])
    expect(params.p_orders).toEqual([20, 10, 30])
  })

  it('is a no-op for an empty updates array (no rpc call)', async () => {
    await reorderCategories([])
    await reorderGearItems([])
    await reorderListItems([])
    await reorderLists([])
    expect(mockState.rpcCalls).toHaveLength(0)
  })
})

describe('bulk reorder error handling', () => {
  it('propagates Supabase errors verbatim, preserving the pg error code', async () => {
    // Reorder error paths feed makeOptimisticReorder.onError, which
    // surfaces a toast and rolls back the optimistic cache. The error
    // object must reach the caller intact -- our optimistic rollback
    // tests check the rollback contract, but only this test pins that
    // the wrappers do not swallow / rewrap the PostgrestError.
    const pgError = { code: '42501', message: 'row violates RLS' }
    mockState.nextResponse = { error: pgError }

    await expect(
      reorderCategories([{ id: 'c1', sort_order: 0 }]),
    ).rejects.toMatchObject({ code: '42501', message: 'row violates RLS' })
  })

  it('propagates errors from each wrapper (not just the first)', async () => {
    const pgError = { code: 'P0002', message: 'no row matches' }
    mockState.nextResponse = { error: pgError }

    await expect(reorderGearItems([{ id: 'g1', sort_order: 0 }])).rejects.toMatchObject({
      code: 'P0002',
    })
    mockState.nextResponse = { error: pgError }
    await expect(reorderListItems([{ id: 'li1', sort_order: 0 }])).rejects.toMatchObject({
      code: 'P0002',
    })
    mockState.nextResponse = { error: pgError }
    await expect(reorderLists([{ id: 'l1', sort_order: 0 }])).rejects.toMatchObject({
      code: 'P0002',
    })
  })
})
