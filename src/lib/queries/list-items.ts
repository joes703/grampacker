import { supabase } from '../supabase'
import type { Category, GearItem, ListItem, ListItemWithGear, PublicListItem } from '../types'
import type { ListImportRow } from '../csv'
import { bulkUpdateSortOrder } from './bulk-reorder'
import { nextGearItemSortOrder } from './gear'
import { resolveOrCreateCategories, resolveOrCreateGearForImport } from './import-helpers'
import { GEAR_ITEM_AUTH_SELECT, GEAR_ITEM_PUBLIC_SELECT } from './projections'

// Owner-scoped private read. See queries/index.ts for the convention.
// Uses the list_items.user_id column added in 20260506000002.
export async function fetchListItems(listId: string, userId: string): Promise<ListItemWithGear[]> {
  const { data, error } = await supabase
    .from('list_items')
    .select(`*, ${GEAR_ITEM_AUTH_SELECT}`)
    .eq('user_id', userId)
    .eq('list_id', listId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data as ListItemWithGear[]
}

// Every list_item across every list owned by this user, in one round-trip.
// Used by Settings → Download all data to avoid an N+1 fetch loop. RLS already
// scopes to the caller's lists, but the explicit `.eq('list.user_id', userId)`
// keeps export correctness independent of policy state.
export async function fetchAllUserListItems(userId: string): Promise<ListItemWithGear[]> {
  const { data, error } = await supabase
    .from('list_items')
    .select(`*, ${GEAR_ITEM_AUTH_SELECT}, list:lists!inner(user_id)`)
    .eq('list.user_id', userId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data as ListItemWithGear[]
}

// Public read (shared list, no auth). Returns only the columns the share
// view renders: no list_id (viewer already has it), no is_packed (owner's
// packing state), no created_at/updated_at. See SECURITY.md "Public read
// paths" for the allowlist.
export async function fetchSharedListItems(listId: string): Promise<PublicListItem[]> {
  const { data, error } = await supabase
    .from('list_items')
    .select(
      `id, gear_item_id, quantity, is_worn, is_consumable, sort_order, ${GEAR_ITEM_PUBLIC_SELECT}`,
    )
    .eq('list_id', listId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  // Runtime guard for the TS/runtime contract: PostgREST returns gear_item
  // as a single object (one-to-one via FK) but TS infers it as an array
  // from the explicit-column SELECT; the previous `as unknown as` cast
  // silently accepted any shape. This assert turns a future PostgREST
  // shape change (or a leaked private column) into a loud error instead.
  // Authorization stays at RLS + the narrow SELECT above + the
  // shared-projections.test.ts allowlist; this is a maintainability
  // guard, not a security boundary.
  assertPublicListItems(data)
  return data
}

// Forbidden columns on the public share response. Defense-in-depth
// against a leaked private field from a broken SELECT, an RLS rule that
// returned more than expected, or a developer who appended a column to
// GEAR_ITEM_PUBLIC_SELECT without thinking. SECURITY.md's "Public read
// column allowlist" is the source of truth; this is the runtime mirror.
const FORBIDDEN_LIST_ITEM_KEYS: readonly string[] = [
  'is_packed',
  'is_ready',
  'user_id',
  'list_id',
  'created_at',
  'updated_at',
]
const FORBIDDEN_GEAR_ITEM_KEYS: readonly string[] = [
  'user_id',
  'status',
  'cost',
  'purchase_date',
  'sort_order',
  'created_at',
  'updated_at',
]

function shapeError(index: number, field: string, expected: string): Error {
  return new Error(
    `Unexpected public list item response shape: row ${index} field "${field}" is not ${expected}`,
  )
}

function forbiddenKeyError(index: number, scope: string, key: string): Error {
  return new Error(
    `Unexpected public list item response shape: row ${index} ${scope} carries forbidden key "${key}"`,
  )
}

// Type-narrowing assertion: callers can use `data` as PublicListItem[]
// after this returns. Error messages name the row index and the field,
// never values, so a thrown error never echoes user data into logs.
//
// Required keys are covered by the per-field `typeof` checks below
// (missing → undefined → wrong type → throw). Private-column leaks are
// caught by an explicit blocklist. Extra benign keys (e.g. an
// internal `_etag` or `__typename` added by a future PostgREST upgrade)
// pass through so a transitive dep bump does not brick every share
// page; the wire allowlist test in shared-projections.test.ts is what
// keeps the SELECT honest.
function assertPublicListItems(data: unknown): asserts data is PublicListItem[] {
  if (!Array.isArray(data)) {
    throw new Error('Unexpected public list item response shape: payload is not an array')
  }
  for (let i = 0; i < data.length; i++) {
    assertPublicListItemRow(data[i], i)
  }
}

function assertPublicListItemRow(row: unknown, index: number): void {
  if (!row || typeof row !== 'object') {
    throw new Error(
      `Unexpected public list item response shape: row ${index} is not an object`,
    )
  }
  const r = row as Record<string, unknown>
  for (const forbidden of FORBIDDEN_LIST_ITEM_KEYS) {
    if (forbidden in r) throw forbiddenKeyError(index, 'list_item', forbidden)
  }
  if (typeof r.id !== 'string') throw shapeError(index, 'id', 'string')
  if (typeof r.gear_item_id !== 'string') throw shapeError(index, 'gear_item_id', 'string')
  if (typeof r.quantity !== 'number') throw shapeError(index, 'quantity', 'number')
  if (typeof r.sort_order !== 'number') throw shapeError(index, 'sort_order', 'number')
  if (typeof r.is_worn !== 'boolean') throw shapeError(index, 'is_worn', 'boolean')
  if (typeof r.is_consumable !== 'boolean') throw shapeError(index, 'is_consumable', 'boolean')
  assertPublicGearItem(r.gear_item, index)
}

function assertPublicGearItem(g: unknown, index: number): void {
  if (!g || typeof g !== 'object') {
    throw new Error(
      `Unexpected public list item response shape: row ${index} gear_item is null or not an object`,
    )
  }
  const gr = g as Record<string, unknown>
  for (const forbidden of FORBIDDEN_GEAR_ITEM_KEYS) {
    if (forbidden in gr) throw forbiddenKeyError(index, 'gear_item', forbidden)
  }
  if (typeof gr.id !== 'string') throw shapeError(index, 'gear_item.id', 'string')
  if (typeof gr.name !== 'string') throw shapeError(index, 'gear_item.name', 'string')
  if (typeof gr.weight_grams !== 'number') {
    throw shapeError(index, 'gear_item.weight_grams', 'number')
  }
  if (gr.description !== null && typeof gr.description !== 'string') {
    throw shapeError(index, 'gear_item.description', 'string or null')
  }
  if (gr.category_id !== null && typeof gr.category_id !== 'string') {
    throw shapeError(index, 'gear_item.category_id', 'string or null')
  }
}

export async function addGearItemToList(
  listId: string,
  userId: string,
  gearItemId: string,
  sortOrder: number,
  fields: Partial<Pick<ListItem, 'quantity' | 'is_worn' | 'is_consumable' | 'is_packed'>> = {},
): Promise<ListItem> {
  const { data, error } = await supabase
    .from('list_items')
    .insert({
      user_id: userId,
      list_id: listId,
      gear_item_id: gearItemId,
      sort_order: sortOrder,
      ...fields,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export type ListItemPatch = Partial<
  Pick<ListItem, 'quantity' | 'is_worn' | 'is_consumable' | 'is_packed' | 'is_ready'>
>

export async function updateListItem(id: string, patch: ListItemPatch): Promise<void> {
  const { error } = await supabase.from('list_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteListItem(id: string): Promise<void> {
  const { error } = await supabase.from('list_items').delete().eq('id', id)
  if (error) throw error
}

export async function reorderListItems(updates: { id: string; sort_order: number }[]): Promise<void> {
  await bulkUpdateSortOrder('list_items', updates)
}

// Clear is_packed on every packed item in this list in a single round-trip,
// gated by `is_packed = true` so we touch only rows that need updating.
export async function resetPackedForList(listId: string): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .update({ is_packed: false })
    .eq('list_id', listId)
    .eq('is_packed', true)
  if (error) throw error
}

// Mirror of resetPackedForList for the Ready Checks column. Gated on
// `is_ready = true` so the PATCH touches only rows that need updating.
// The two reset paths are intentionally independent: Reset Ready must
// NEVER clear is_packed, and Reset Packed must NEVER clear is_ready.
export async function resetReadyForList(listId: string): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .update({ is_ready: false })
    .eq('list_id', listId)
    .eq('is_ready', true)
  if (error) throw error
}

// ── CSV list import ───────────────────────────────────────────────────────────

// Imports CSV rows into a freshly-created list. Gear resolution goes through
// the shared resolveOrCreateGearForImport helper: rows whose (category +
// name + weight) matches an existing gear item link the new list_item to
// that gear without inserting a duplicate. Within-CSV duplicates create
// separate gear items (typing two rows means two items). Per-row CSV
// fields (quantity, is_worn, is_consumable) are written through to the
// list_item insert verbatim.
export async function importCsvRowsToList(
  listId: string,
  userId: string,
  rows: ListImportRow[],
  existingGearItems: GearItem[],
  existingCategories: Category[],
): Promise<void> {
  const catByName = await resolveOrCreateCategories(userId, rows, existingCategories)
  const { gearIdByRow } = await resolveOrCreateGearForImport({
    userId,
    rows,
    existingGearItems,
    catByName,
    startSortOrder: nextGearItemSortOrder(existingGearItems),
  })

  // The list was just created in the calling flow, so it has no
  // pre-existing items; list_item sort_order starts at 0 for the first
  // imported row. If this helper ever grows to support importing into an
  // existing list, swap to nextListItemSortOrder against the existing
  // list_items here.
  const listItemRows = rows
    .map((row, i) => {
      const gearId = gearIdByRow[i]
      if (!gearId) return null
      return {
        user_id: userId,
        list_id: listId,
        gear_item_id: gearId,
        quantity: row.quantity,
        is_worn: row.is_worn,
        is_consumable: row.is_consumable,
        sort_order: i,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (listItemRows.length === 0) return
  const { error } = await supabase.from('list_items').insert(listItemRows)
  if (error) throw error
}
