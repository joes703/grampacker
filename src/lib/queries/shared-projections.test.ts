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
  nextSingle: { data: null as unknown, error: null as { message: string; code?: string } | null },
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
import { fetchSharedListItems, fetchListItems, fetchAllUserListItems } from './list-items'
import { fetchSharedListCategories } from './categories'
import { GEAR_ITEM_AUTH_SELECT, GEAR_ITEM_PUBLIC_SELECT } from './projections'
import { patchAffectsListItemsView } from '../../lists/list-items-fan-out'

// Helper: parse the column list inside the `gear_item:gear_items(...)`
// nested join substring and return a trimmed, sorted array. Lets tests
// assert exact set equality rather than substring containment.
function gearColumnList(selectString: string): string[] {
  const inner = selectString.match(/gear_item:gear_items\(([^)]+)\)/)?.[1] ?? ''
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
}

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
  'is_ready',
  'ready_checks_enabled',
  'user_id',
  'slug',
  'is_shared',
  'is_default',
  'created_at',
  'updated_at',
]

describe('gear-item projection constants', () => {
  // The constants are the wire-level allowlist for the gear_item join.
  // Locking their literal values here means: any widening (new column) is
  // a deliberate, reviewable diff in this test file, not a silent change
  // somewhere in the queries layer.
  it('GEAR_ITEM_PUBLIC_SELECT contains only the public allowlist', () => {
    expect(GEAR_ITEM_PUBLIC_SELECT).toBe(
      'gear_item:gear_items(id, name, description, weight_grams, category_id)',
    )
    expect(gearColumnList(GEAR_ITEM_PUBLIC_SELECT)).toEqual([
      'category_id',
      'description',
      'id',
      'name',
      'weight_grams',
    ])
    // Defense in depth: re-enumerate the forbidden private columns so a
    // future widening that adds one trips this test directly on the
    // constant, not just at a call site.
    const inner = GEAR_ITEM_PUBLIC_SELECT
    for (const forbidden of ['cost', 'purchase_date', 'status', 'is_ready', 'user_id', 'sort_order']) {
      expect(inner).not.toContain(forbidden)
    }
    expect(inner).not.toContain('*')
  })

  it('GEAR_ITEM_AUTH_SELECT extends the public allowlist with status only', () => {
    expect(GEAR_ITEM_AUTH_SELECT).toBe(
      'gear_item:gear_items(id, name, description, weight_grams, category_id, status)',
    )
    expect(gearColumnList(GEAR_ITEM_AUTH_SELECT)).toEqual([
      'category_id',
      'description',
      'id',
      'name',
      'status',
      'weight_grams',
    ])
    // Cost and purchase_date stay out of joins on principle: they're
    // gear-library-only columns. Authenticated users read them directly
    // from gear_items, not via the list_items join.
    expect(GEAR_ITEM_AUTH_SELECT).not.toContain('cost')
    expect(GEAR_ITEM_AUTH_SELECT).not.toContain('purchase_date')
    expect(GEAR_ITEM_AUTH_SELECT).not.toContain('user_id')
    expect(GEAR_ITEM_AUTH_SELECT).not.toContain('*')
  })
})

// The list_items.gear_item join (GEAR_ITEM_AUTH_SELECT) and the private
// EMBEDDED_GEAR_FIELDS set inside list-items-fan-out.ts must stay in sync:
// EMBEDDED_GEAR_FIELDS is exactly the set of gear_items columns a gear-edit
// patch can change that the list view actually renders. patchAffectsListItemsView
// is the public gate that consumes that set to decide whether a gear mutation
// must fan out across the ['list-items', *] caches. If a column is added to
// the auth join but NOT to EMBEDDED_GEAR_FIELDS, a patch touching it would
// (wrongly) skip the fan-out and leave the list-detail row stale.
//
// We test the sync BEHAVIORALLY through patchAffectsListItemsView rather than
// exporting the private const: for every gear column in the auth select except
// `id` (the join key, never the target of an edit and intentionally absent
// from the embedded set), a single-field patch must report "affects view".
// A field NOT in the select (sort_order, cost) must report false. The column
// list is extracted from the select string via gearColumnList so this test
// self-updates if the select widens - a new auth column with no matching
// embedded field fails the loop, catching add-a-column drift.
describe('EMBEDDED_GEAR_FIELDS stays in sync with GEAR_ITEM_AUTH_SELECT', () => {
  it('treats every auth-select gear column (except id) as affecting the list view', () => {
    const embeddable = gearColumnList(GEAR_ITEM_AUTH_SELECT).filter((c) => c !== 'id')
    // Guard: the loop is meaningless if extraction yielded nothing.
    expect(embeddable.length).toBeGreaterThan(0)
    for (const col of embeddable) {
      expect(patchAffectsListItemsView({ [col]: 'x' })).toBe(true)
    }
  })

  it('treats gear columns NOT in the auth select as not affecting the list view', () => {
    // sort_order and cost are real gear_items columns deliberately kept out
    // of the join (sort_order is list-ordering-irrelevant; cost is library-
    // only). A patch touching only these must skip the list-items fan-out.
    expect(patchAffectsListItemsView({ sort_order: 3 })).toBe(false)
    expect(patchAffectsListItemsView({ cost: 12.5 })).toBe(false)
    // id is in the select but is the join key, never edited; it is not an
    // embedded field, so a patch touching only id does not affect the view.
    expect(patchAffectsListItemsView({ id: 'g-1' })).toBe(false)
  })
})

describe('fetchSharedList (public share view list projection)', () => {
  it('reads from public.lists with an explicit, narrow select string', async () => {
    mockState.nextSingle = {
      data: {
        id: 'list-1',
        name: 'Trip',
        description: 'Notes',
        group_worn: false,
        is_draft: true,
      },
      error: null,
    }

    const result = await fetchSharedList('abc123')

    expect(mockState.calls).toHaveLength(1)
    expect(mockState.calls[0]?.table).toBe('lists')
    const cols = mockState.calls[0]?.selectCols ?? ''
    // Explicit allowlist matches SECURITY.md "Public read column allowlist".
    expect(cols).toBe('id, name, description, group_worn, is_draft')
    // Defense in depth: no wildcard or forbidden columns.
    expect(cols).not.toContain('*')
    for (const forbidden of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(cols).not.toContain(forbidden)
    }
    // Returned shape is exactly the allowlist (mock returns what helper
    // requested; this also pins the PublicList key set).
    expect(result).not.toBeNull()
    expect(Object.keys(result!).sort()).toEqual(
      ['description', 'group_worn', 'id', 'is_draft', 'name'],
    )
  })

  it('returns null on PGRST116 (unknown or unshared slug)', async () => {
    mockState.nextSingle = {
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    }
    const result = await fetchSharedList('missing')
    expect(result).toBeNull()
  })

  it('throws on a non-PGRST116 Supabase error so the page can surface "Couldn\'t load"', async () => {
    mockState.nextSingle = {
      data: null,
      error: { code: '500', message: 'gateway timeout' },
    }
    await expect(fetchSharedList('abc123')).rejects.toMatchObject({
      code: '500',
      message: 'gateway timeout',
    })
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
    // The select embeds the shared constant verbatim. Any divergence (a
    // local hand-written join that drifted from the constant) fails here.
    expect(cols).toContain(GEAR_ITEM_PUBLIC_SELECT)

    const gearCols = cols.match(/gear_item:gear_items\(([^)]+)\)/)?.[1] ?? ''
    expect(gearCols).not.toContain('*')
    // Exact-set equality: the public gear projection is ONLY the
    // allowlist below. Adding a column to the join (even one already
    // visible to authed users) requires updating this list deliberately.
    expect(gearColumnList(cols)).toEqual([
      'category_id',
      'description',
      'id',
      'name',
      'weight_grams',
    ])
    // Gear-item columns excluded from the public view (per SECURITY.md):
    expect(gearCols).not.toContain('user_id')
    expect(gearCols).not.toContain('sort_order')
    expect(gearCols).not.toContain('cost')
    expect(gearCols).not.toContain('purchase_date')
    // status is advisory inventory metadata (needs_repair, loaned_out, need_to_buy).
    // Surfaced in private views only; share viewers must not see it.
    expect(gearCols).not.toContain('status')
    // is_ready lives on list_items (not gear_items), but assert absence
    // here too: a typo that put it inside the gear_item parens would
    // surface as a runtime PostgREST error in prod. Catch at unit level.
    expect(gearCols).not.toContain('is_ready')

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

// Runtime shape guard inside fetchSharedListItems. Locks the
// TS/runtime contract (PostgREST response matches PublicListItem) so a
// future shape drift or accidental column widening fails the share page
// loudly instead of silently propagating into the renderer. NOT a
// security boundary — that's RLS + the narrow SELECT + the projection
// constant tests above.
describe('fetchSharedListItems runtime shape guard', () => {
  // Canonical valid row. Tests below mutate one field at a time so each
  // negative case isolates a single failure mode.
  function validPublicRow() {
    return {
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
    }
  }

  it('returns the rows normally for a well-shaped payload', async () => {
    mockState.nextList = { data: [validPublicRow()], error: null }
    const result = await fetchSharedListItems('list-1')
    expect(result).toHaveLength(1)
    expect(result[0]?.gear_item.name).toBe('Tent')
  })

  it('throws when gear_item is null', async () => {
    const row = { ...validPublicRow(), gear_item: null }
    mockState.nextList = { data: [row], error: null }
    await expect(fetchSharedListItems('list-1')).rejects.toThrow(
      /gear_item is null or not an object/,
    )
  })

  it('throws when gear_item carries a private column (status)', async () => {
    const row = validPublicRow()
    const tampered = { ...row, gear_item: { ...row.gear_item, status: 'active' } }
    mockState.nextList = { data: [tampered], error: null }
    await expect(fetchSharedListItems('list-1')).rejects.toThrow(
      /gear_item carries forbidden key "status"/,
    )
  })

  it('throws when gear_item carries a private column (cost)', async () => {
    const row = validPublicRow()
    const tampered = { ...row, gear_item: { ...row.gear_item, cost: 199.99 } }
    mockState.nextList = { data: [tampered], error: null }
    await expect(fetchSharedListItems('list-1')).rejects.toThrow(
      /gear_item carries forbidden key "cost"/,
    )
  })

  it('throws when the list_item carries a private column (is_packed)', async () => {
    const tampered = { ...validPublicRow(), is_packed: true }
    mockState.nextList = { data: [tampered], error: null }
    await expect(fetchSharedListItems('list-1')).rejects.toThrow(
      /list_item carries forbidden key "is_packed"/,
    )
  })

  it('throws when the list_item carries a private column (user_id)', async () => {
    const tampered = { ...validPublicRow(), user_id: 'owner-1' }
    mockState.nextList = { data: [tampered], error: null }
    await expect(fetchSharedListItems('list-1')).rejects.toThrow(
      /list_item carries forbidden key "user_id"/,
    )
  })

  it('tolerates a benign extra key not on the forbidden list (e.g. a PostgREST internal field)', async () => {
    const tampered = { ...validPublicRow(), _etag: 'abc123' }
    mockState.nextList = { data: [tampered], error: null }
    const result = await fetchSharedListItems('list-1')
    expect(result).toHaveLength(1)
    expect(result[0]?.gear_item.name).toBe('Tent')
  })

  it('throws when a primitive field is the wrong type (quantity as string)', async () => {
    const tampered = { ...validPublicRow(), quantity: '2' }
    mockState.nextList = { data: [tampered], error: null }
    await expect(fetchSharedListItems('list-1')).rejects.toThrow(
      /field "quantity" is not number/,
    )
  })

  it('throws when gear_item.weight_grams is the wrong type', async () => {
    const row = validPublicRow()
    const tampered = { ...row, gear_item: { ...row.gear_item, weight_grams: '1200' } }
    mockState.nextList = { data: [tampered], error: null }
    await expect(fetchSharedListItems('list-1')).rejects.toThrow(
      /field "gear_item.weight_grams" is not number/,
    )
  })
})

describe('fetchListItems (authenticated list view list_items projection)', () => {
  it('embeds GEAR_ITEM_AUTH_SELECT with status in the list_items SELECT', async () => {
    mockState.nextList = { data: [], error: null }

    await fetchListItems('list-1', 'user-1')

    expect(mockState.calls).toHaveLength(1)
    expect(mockState.calls[0]?.table).toBe('list_items')
    const cols = mockState.calls[0]?.selectCols ?? ''
    // The list_items row itself is fetched with `*` (authenticated path
    // exposes the owner's full row to the owner). What we lock is the
    // *nested* gear projection: status is included for authed views.
    expect(cols).toContain(GEAR_ITEM_AUTH_SELECT)
    const gearCols = gearColumnList(cols)
    expect(gearCols).toEqual([
      'category_id',
      'description',
      'id',
      'name',
      'status',
      'weight_grams',
    ])
  })
})

describe('fetchAllUserListItems (authenticated export list_items projection)', () => {
  it('embeds GEAR_ITEM_AUTH_SELECT alongside the lists!inner ownership join', async () => {
    mockState.nextList = { data: [], error: null }

    await fetchAllUserListItems('user-1')

    expect(mockState.calls).toHaveLength(1)
    expect(mockState.calls[0]?.table).toBe('list_items')
    const cols = mockState.calls[0]?.selectCols ?? ''
    expect(cols).toContain(GEAR_ITEM_AUTH_SELECT)
    // Settings export path also pulls the lists row for the user_id
    // ownership filter. Lock that bit too so a "tidy-up" diff that drops
    // it (and turns the export into a leaky cross-user query in the
    // absence of RLS) is caught at the unit level.
    expect(cols).toContain('list:lists!inner(user_id)')
    const gearCols = gearColumnList(cols)
    expect(gearCols).toEqual([
      'category_id',
      'description',
      'id',
      'name',
      'status',
      'weight_grams',
    ])
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
