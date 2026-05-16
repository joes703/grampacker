import { describe, it, expect, beforeEach, vi } from 'vitest'

// These tests lock the public share-view column allowlist at the unit
// level. The three helpers under test feed unauthenticated /r/<slug>
// rendering. A future refactor that swaps an explicit `select(cols)` for
// `select('*')` would silently widen the wire response to include
// owner-only columns (is_packed, user_id, slug, is_shared, is_default,
// created_at, updated_at). RLS still gates which rows return, but per
// SECURITY.md "Public read column allowlist" we also gate which COLUMNS
// return so the auth context never leaks into the share-view payload.
//
// The mock captures:
//   - the table name passed to supabase.from(table)
//   - the column list passed to .select(cols)
// and returns the data the test wires up. Each test then asserts both
// the requested column string AND the shape of the returned object, so a
// regression that adds a forbidden column to the select string fails
// loudly even if the runtime data didn't include it.

const mockState = vi.hoisted(() => ({
  // Per-call records, written in order; tests clear before each case.
  calls: [] as { table: string; selectCols: string | null }[],
  // Response for the next call. Tests overwrite per case. `single` is
  // what `.single()` resolves to; `list` is what the awaited builder
  // resolves to when no `.single()` is chained.
  nextSingle: { data: null as unknown, error: null as { message: string } | null },
  nextList: { data: [] as unknown[], error: null as { message: string } | null },
}))

vi.mock('../supabase', () => ({
  supabase: {
    from(table: string) {
      const state = { table, selectCols: null as string | null }
      mockState.calls.push(state)
      // Chainable builder. Every filter-style method (eq, in, order)
      // returns the same builder. The builder is `thenable` so callers
      // can `await` it directly without a terminal .single().
      const builder: Record<string, unknown> = {
        select(cols: string) {
          state.selectCols = cols
          return builder
        },
        eq() {
          return builder
        },
        in() {
          return builder
        },
        order() {
          return builder
        },
        single() {
          return Promise.resolve(mockState.nextSingle)
        },
        then(
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown,
        ) {
          return Promise.resolve(mockState.nextList).then(resolve, reject)
        },
      }
      return builder
    },
  },
}))

import { fetchSharedList } from './lists'
import { fetchSharedListItems } from './list-items'
import { fetchSharedListCategories } from './categories'

beforeEach(() => {
  mockState.calls.length = 0
  mockState.nextSingle = { data: null, error: null }
  mockState.nextList = { data: [], error: null }
})

// Columns SECURITY.md "Public read column allowlist" forbids on the share
// view wire response. Any of these appearing in a select() string is a
// regression.
const FORBIDDEN_PUBLIC_COLUMNS = [
  'is_packed',
  'user_id',
  'slug',
  'is_shared',
  'is_default',
  'created_at',
  'updated_at',
]

describe('fetchSharedList (public share view list projection)', () => {
  it('reads from public.lists with an explicit, narrow select string', async () => {
    mockState.nextSingle = {
      data: {
        id: 'list-1',
        name: 'Trip',
        description: 'Notes',
        group_worn: false,
      },
      error: null,
    }

    const result = await fetchSharedList('abc123')

    expect(mockState.calls).toHaveLength(1)
    expect(mockState.calls[0]?.table).toBe('lists')
    const cols = mockState.calls[0]?.selectCols ?? ''
    // Explicit allowlist matches SECURITY.md "Public read column allowlist".
    expect(cols).toBe('id, name, description, group_worn')
    // Defense in depth: no wildcard or forbidden columns.
    expect(cols).not.toContain('*')
    for (const forbidden of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(cols).not.toContain(forbidden)
    }
    // Returned shape is exactly the allowlist (mock returns what helper
    // requested; this also pins the PublicList key set).
    expect(result).not.toBeNull()
    expect(Object.keys(result!).sort()).toEqual(
      ['description', 'group_worn', 'id', 'name'],
    )
  })

  it('returns null on a Supabase error (e.g. unknown slug)', async () => {
    mockState.nextSingle = {
      data: null,
      error: { message: 'no rows' },
    }
    const result = await fetchSharedList('missing')
    expect(result).toBeNull()
  })
})

describe('fetchSharedListItems (public share view list_items projection)', () => {
  it('reads from public.list_items with the narrow allowlist plus nested gear_item allowlist', async () => {
    mockState.nextList = {
      data: [
        {
          id: 'li-1',
          gear_item_id: 'g-1',
          quantity: 2,
          is_worn: false,
          is_consumable: false,
          sort_order: 0,
          gear_item: {
            id: 'g-1',
            name: 'Tent',
            description: null,
            weight_grams: 1200,
            category_id: 'cat-1',
          },
        },
      ],
      error: null,
    }

    const result = await fetchSharedListItems('list-1')

    expect(mockState.calls).toHaveLength(1)
    expect(mockState.calls[0]?.table).toBe('list_items')
    const cols = mockState.calls[0]?.selectCols ?? ''

    // No wildcard. SECURITY.md forbids select('*') on share-view paths
    // because anon would receive every column the RLS policy permits.
    expect(cols).not.toContain('*')

    // None of the owner-only / personal columns appear in the select.
    for (const forbidden of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(cols).not.toContain(forbidden)
    }
    // Note: list_id is excluded from list_items, but the join syntax
    // does include `gear_items` (the joined table) and `gear_item:` (the
    // alias). `list_id` itself must not appear as a list_items column.
    expect(cols).not.toMatch(/(^|,|\s)list_id(\s|,|$)/)

    // The exact projection on list_items: the documented allowlist.
    expect(cols).toContain('id')
    expect(cols).toContain('gear_item_id')
    expect(cols).toContain('quantity')
    expect(cols).toContain('is_worn')
    expect(cols).toContain('is_consumable')
    expect(cols).toContain('sort_order')

    // Nested gear_item join uses an explicit column list, not a wildcard.
    expect(cols).toContain('gear_item:gear_items(')
    const gearCols = cols.match(/gear_item:gear_items\(([^)]+)\)/)?.[1] ?? ''
    expect(gearCols).not.toContain('*')
    expect(gearCols).toContain('id')
    expect(gearCols).toContain('name')
    expect(gearCols).toContain('description')
    expect(gearCols).toContain('weight_grams')
    expect(gearCols).toContain('category_id')
    // Gear-item columns excluded from the public view (per SECURITY.md):
    expect(gearCols).not.toContain('user_id')
    expect(gearCols).not.toContain('sort_order')
    expect(gearCols).not.toContain('cost')
    expect(gearCols).not.toContain('purchase_date')
    // status is advisory inventory metadata (needs_repair, loaned_out).
    // Surfaced in private views only; share viewers must not see it.
    expect(gearCols).not.toContain('status')

    // Returned PublicListItem shape: exactly the allowlist keys.
    expect(result).toHaveLength(1)
    expect(Object.keys(result[0]!).sort()).toEqual(
      [
        'gear_item',
        'gear_item_id',
        'id',
        'is_consumable',
        'is_worn',
        'quantity',
        'sort_order',
      ],
    )
    // Nested gear_item shape pinned.
    expect(Object.keys(result[0]!.gear_item).sort()).toEqual(
      ['category_id', 'description', 'id', 'name', 'weight_grams'],
    )
  })
})

describe('fetchSharedListCategories (public share view categories projection)', () => {
  it('returns an empty array without hitting Supabase when no category ids are provided', async () => {
    const result = await fetchSharedListCategories([])
    expect(result).toEqual([])
    expect(mockState.calls).toHaveLength(0)
  })

  it('reads from public.categories with the narrow allowlist when ids are present', async () => {
    mockState.nextList = {
      data: [
        { id: 'cat-1', name: 'Shelter', sort_order: 0 },
        { id: 'cat-2', name: 'Kitchen', sort_order: 1 },
      ],
      error: null,
    }

    const result = await fetchSharedListCategories(['cat-1', 'cat-2'])

    expect(mockState.calls).toHaveLength(1)
    expect(mockState.calls[0]?.table).toBe('categories')
    const cols = mockState.calls[0]?.selectCols ?? ''

    // Explicit allowlist per SECURITY.md "Public read column allowlist".
    expect(cols).toBe('id, name, sort_order')
    expect(cols).not.toContain('*')
    for (const forbidden of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(cols).not.toContain(forbidden)
    }

    expect(result).toHaveLength(2)
    expect(Object.keys(result[0]!).sort()).toEqual(['id', 'name', 'sort_order'])
  })
})
