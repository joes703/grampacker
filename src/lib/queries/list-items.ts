import { supabase } from '../supabase'
import type { Category, GearItem, ListItem, ListItemWithGear, PublicListItem } from '../types'
import type { ListImportRow } from '../csv'
import { bulkUpdateSortOrder } from './optimistic'
import { resolveOrCreateCategories, resolveOrCreateGearForImport } from './import-helpers'

// Owner-scoped private read. See queries/index.ts for the convention.
// Uses the list_items.user_id column added in 20260506000002.
export async function fetchListItems(listId: string, userId: string): Promise<ListItemWithGear[]> {
  const { data, error } = await supabase
    .from('list_items')
    .select('*, gear_item:gear_items(id, name, description, weight_grams, category_id, status)')
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
    .select(
      '*, gear_item:gear_items(id, name, description, weight_grams, category_id, status), list:lists!inner(user_id)',
    )
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
    .select('id, gear_item_id, quantity, is_worn, is_consumable, sort_order, gear_item:gear_items(id, name, description, weight_grams, category_id)')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  // PostgREST returns the gear_item join as a single object (one-to-one
  // via the gear_item_id FK), but TypeScript infers it as an array from
  // the explicit-column SELECT. The `as unknown as` two-step matches the
  // pattern used by the authed fetchListItems below: the runtime shape
  // is correct; only the inferred TS shape needs the override.
  return data as unknown as PublicListItem[]
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
  currentListItemCount: number,
): Promise<void> {
  const catByName = await resolveOrCreateCategories(userId, rows, existingCategories)
  const { gearIdByRow } = await resolveOrCreateGearForImport({
    userId,
    rows,
    existingGearItems,
    catByName,
    startSortOrder: existingGearItems.length,
  })

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
        sort_order: currentListItemCount + i,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (listItemRows.length === 0) return
  const { error } = await supabase.from('list_items').insert(listItemRows)
  if (error) throw error
}
