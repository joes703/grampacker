import { supabase } from '../supabase'
import type { Category, GearItem, ListItem, ListItemWithGear } from '../types'
import type { ListImportRow } from '../csv'
import { createCategory } from './categories'
import { bulkUpdateSortOrder } from './optimistic'

export async function fetchListItems(listId: string): Promise<ListItemWithGear[]> {
  const { data, error } = await supabase
    .from('list_items')
    .select('*, gear_item:gear_items(id, name, description, weight_grams, category_id)')
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
      '*, gear_item:gear_items(id, name, description, weight_grams, category_id), list:lists!inner(user_id)',
    )
    .eq('list.user_id', userId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data as ListItemWithGear[]
}

export async function fetchSharedListItems(listId: string): Promise<ListItemWithGear[]> {
  const { data, error } = await supabase
    .from('list_items')
    .select('*, gear_item:gear_items(id, name, description, weight_grams, category_id)')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data as ListItemWithGear[]
}

export async function addGearItemToList(
  listId: string,
  gearItemId: string,
  sortOrder: number,
  fields: Partial<Pick<ListItem, 'quantity' | 'is_worn' | 'is_consumable' | 'is_packed'>> = {},
): Promise<ListItem> {
  const { data, error } = await supabase
    .from('list_items')
    .insert({
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
  Pick<ListItem, 'quantity' | 'is_worn' | 'is_consumable' | 'is_packed' | 'sort_order'>
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

// ── CSV list import ───────────────────────────────────────────────────────────

export async function importCsvRowsToList(
  listId: string,
  userId: string,
  rows: ListImportRow[],
  existingGearItems: GearItem[],
  existingCategories: Category[],
  currentListItemCount: number,
): Promise<void> {
  // 1. Resolve/create categories
  const catByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]))

  const uniqueCatNames = [...new Set(rows.map((r) => r.category.trim()).filter(Boolean))]
  for (const name of uniqueCatNames) {
    if (!catByName.has(name.toLowerCase())) {
      const created = await createCategory(userId, name, existingCategories.length + catByName.size)
      catByName.set(name.toLowerCase(), created.id)
    }
  }

  // 2. Resolve/create gear items (match by name, case-insensitive). We only
  // need each gear's id downstream — track that, not the whole row, so the
  // freshly-inserted partial selects don't have to be cast to a full GearItem.
  const gearIdByName = new Map<string, string>(
    existingGearItems.map((g) => [g.name.toLowerCase(), g.id]),
  )

  const newGearRows: {
    user_id: string
    name: string
    description: string | null
    weight_grams: number
    category_id: string | null
    sort_order: number
  }[] = []
  for (const row of rows) {
    if (!gearIdByName.has(row.name.toLowerCase())) {
      const categoryId = row.category.trim() ? (catByName.get(row.category.trim().toLowerCase()) ?? null) : null
      newGearRows.push({
        user_id: userId,
        name: row.name,
        description: row.description,
        weight_grams: row.weight_grams,
        category_id: categoryId,
        sort_order: existingGearItems.length + newGearRows.length,
      })
    }
  }

  if (newGearRows.length > 0) {
    const { data: created, error } = await supabase
      .from('gear_items')
      .insert(newGearRows)
      .select('id, name')
    if (error) throw error
    for (const g of created) {
      gearIdByName.set(g.name.toLowerCase(), g.id)
    }
  }

  // 3. Add all rows to the list (gear_item_id is required; if a row had no name/match, skip it)
  const listItemRows = rows
    .map((row, i) => {
      const gearId = gearIdByName.get(row.name.toLowerCase())
      if (!gearId) return null
      return {
        list_id: listId,
        gear_item_id: gearId,
        quantity: row.quantity,
        is_worn: row.is_worn,
        is_consumable: row.is_consumable,
        sort_order: currentListItemCount + i,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const { error: liErr } = await supabase.from('list_items').insert(listItemRows)
  if (liErr) throw liErr
}
