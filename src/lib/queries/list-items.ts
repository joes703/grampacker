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

  // 2. Resolve/create gear items. Dedup is keyed by category_id + lowercase
  // name — same name in different categories means different gear items
  // (sleeping bag in "Sleeping" vs "Loaner kit" really are different things).
  // The map is also updated as we go so duplicate (name + category) rows
  // within ONE CSV collapse to a single insert; the second row finds the
  // first's queued key and skips. UUIDs can't contain ':', so the composite
  // key is collision-free.
  function resolveCategoryId(rawCategory: string): string | null {
    const trimmed = rawCategory.trim()
    if (!trimmed) return null
    return catByName.get(trimmed.toLowerCase()) ?? null
  }
  function gearKey(categoryId: string | null, name: string): string {
    return `${categoryId ?? ''}:${name.toLowerCase()}`
  }

  const gearIdByKey = new Map<string, string>(
    existingGearItems.map((g) => [gearKey(g.category_id, g.name), g.id]),
  )
  // Tracks keys queued for insert in this CSV but not yet inserted. After
  // insert, gearIdByKey has the real ids and this set is unused.
  const queuedKeys = new Set<string>()

  const newGearRows: {
    user_id: string
    name: string
    description: string | null
    weight_grams: number
    category_id: string | null
    sort_order: number
  }[] = []
  for (const row of rows) {
    const categoryId = resolveCategoryId(row.category)
    const key = gearKey(categoryId, row.name)
    if (gearIdByKey.has(key) || queuedKeys.has(key)) continue
    queuedKeys.add(key)
    newGearRows.push({
      user_id: userId,
      name: row.name,
      description: row.description,
      weight_grams: row.weight_grams,
      category_id: categoryId,
      sort_order: existingGearItems.length + newGearRows.length,
    })
  }

  if (newGearRows.length > 0) {
    const { data: created, error } = await supabase
      .from('gear_items')
      .insert(newGearRows)
      .select('id, name, category_id')
    if (error) throw error
    for (const g of created) {
      gearIdByKey.set(gearKey(g.category_id, g.name), g.id)
    }
  }

  // 3. Add all rows to the list (gear_item_id is required; if a row had no name/match, skip it)
  const listItemRows = rows
    .map((row, i) => {
      const categoryId = resolveCategoryId(row.category)
      const gearId = gearIdByKey.get(gearKey(categoryId, row.name))
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
