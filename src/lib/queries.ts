import { supabase } from './supabase'
import type { Category, GearItem, List, ListItem, ListItemWithGear } from './types'
import { generateShareToken } from './share-token'
import type { ListImportRow } from './csv'

export const queryKeys = {
  categories: () => ['categories'] as const,
  gearItems: () => ['gear-items'] as const,
  lists: () => ['lists'] as const,
  listItems: (listId: string) => ['list-items', listId] as const,
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function fetchGearItems(): Promise<GearItem[]> {
  const { data, error } = await supabase
    .from('gear_items')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

// ── Category mutations ────────────────────────────────────────────────────────

export async function createCategory(
  userId: string,
  name: string,
  sortOrder: number,
  isDefault = false,
): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: userId, name, sort_order: sortOrder, is_default: isDefault })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'sort_order'>>): Promise<void> {
  const { error } = await supabase.from('categories').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

export async function reorderCategories(updates: { id: string; sort_order: number }[]): Promise<void> {
  await Promise.all(updates.map(({ id, sort_order }) => updateCategory(id, { sort_order })))
}

// ── Gear item mutations ───────────────────────────────────────────────────────

export async function createGearItem(
  userId: string,
  data: Pick<GearItem, 'name' | 'description' | 'weight_grams' | 'category_id'>,
  sortOrder: number,
): Promise<GearItem> {
  const { data: row, error } = await supabase
    .from('gear_items')
    .insert({ user_id: userId, sort_order: sortOrder, ...data })
    .select()
    .single()
  if (error) throw error
  return row
}

export async function updateGearItem(
  id: string,
  patch: Partial<Pick<GearItem, 'name' | 'description' | 'weight_grams' | 'category_id' | 'sort_order'>>,
): Promise<void> {
  const { error } = await supabase.from('gear_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteGearItem(id: string): Promise<void> {
  const { error } = await supabase.from('gear_items').delete().eq('id', id)
  if (error) throw error
}

export async function bulkDeleteGearItems(ids: string[]): Promise<void> {
  const { error } = await supabase.from('gear_items').delete().in('id', ids)
  if (error) throw error
}

export async function bulkMoveToCategoryGearItems(
  ids: string[],
  categoryId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('gear_items')
    .update({ category_id: categoryId })
    .in('id', ids)
  if (error) throw error
}

// ── List fetchers ─────────────────────────────────────────────────────────────

export async function fetchLists(): Promise<List[]> {
  const { data, error } = await supabase
    .from('lists')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function fetchListItems(listId: string): Promise<ListItemWithGear[]> {
  const { data, error } = await supabase
    .from('list_items')
    .select('*, gear_item:gear_items(id, name, description, weight_grams, category_id)')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data as ListItemWithGear[]
}

// Public read (shared list, no auth)
export async function fetchSharedList(token: string): Promise<List | null> {
  const { data, error } = await supabase
    .from('lists')
    .select('*')
    .eq('share_token', token)
    .eq('is_shared', true)
    .single()
  if (error) return null
  return data
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

// ── List mutations ────────────────────────────────────────────────────────────

export async function createList(
  userId: string,
  name: string,
  sortOrder: number,
): Promise<List> {
  const { data, error } = await supabase
    .from('lists')
    .insert({
      user_id: userId,
      name,
      sort_order: sortOrder,
      share_token: generateShareToken(),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateList(
  id: string,
  patch: Partial<Pick<List, 'name' | 'description' | 'is_shared' | 'sort_order'>>,
): Promise<void> {
  const { error } = await supabase.from('lists').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteList(id: string): Promise<void> {
  const { error } = await supabase.from('lists').delete().eq('id', id)
  if (error) throw error
}

export async function reorderLists(updates: { id: string; sort_order: number }[]): Promise<void> {
  await Promise.all(updates.map(({ id, sort_order }) => updateList(id, { sort_order })))
}

export async function duplicateList(source: List, userId: string, sortOrder: number): Promise<List> {
  const { data: newList, error: listErr } = await supabase
    .from('lists')
    .insert({
      user_id: userId,
      name: `${source.name} (copy)`,
      description: source.description,
      sort_order: sortOrder,
      share_token: generateShareToken(),
    })
    .select()
    .single()
  if (listErr) throw listErr

  const { data: items, error: itemsErr } = await supabase
    .from('list_items')
    .select('*')
    .eq('list_id', source.id)
  if (itemsErr) throw itemsErr

  if (items.length > 0) {
    const copies = items.map(({ id: _id, list_id: _lid, created_at: _ca, updated_at: _ua, ...rest }: ListItem) => ({
      ...rest,
      list_id: newList.id,
    }))
    const { error: insertErr } = await supabase.from('list_items').insert(copies)
    if (insertErr) throw insertErr
  }

  return newList
}

// ── ListItem mutations ────────────────────────────────────────────────────────

export async function addGearItemToList(
  listId: string,
  gearItem: Pick<GearItem, 'id' | 'weight_grams'>,
  sortOrder: number,
): Promise<ListItem> {
  const { data, error } = await supabase
    .from('list_items')
    .insert({
      list_id: listId,
      gear_item_id: gearItem.id,
      weight_grams: gearItem.weight_grams,
      sort_order: sortOrder,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateListItem(
  id: string,
  patch: Partial<Pick<ListItem, 'quantity' | 'weight_grams' | 'is_worn' | 'is_consumable' | 'is_packed' | 'sort_order'>>,
): Promise<void> {
  const { error } = await supabase.from('list_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteListItem(id: string): Promise<void> {
  const { error } = await supabase.from('list_items').delete().eq('id', id)
  if (error) throw error
}

export async function reorderListItems(updates: { id: string; sort_order: number }[]): Promise<void> {
  await Promise.all(updates.map(({ id, sort_order }) => updateListItem(id, { sort_order })))
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

  // 2. Resolve/create gear items (match by name, case-insensitive)
  const gearByName = new Map(existingGearItems.map((g) => [g.name.toLowerCase(), g]))

  const newGearRows: object[] = []
  for (const row of rows) {
    if (!gearByName.has(row.name.toLowerCase())) {
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
      gearByName.set(g.name.toLowerCase(), g as GearItem)
    }
  }

  // 3. Add all rows to the list
  const listItemRows = rows.map((row, i) => {
    const gear = gearByName.get(row.name.toLowerCase())
    return {
      list_id: listId,
      gear_item_id: gear?.id ?? null,
      weight_grams: row.weight_grams,
      quantity: row.quantity,
      is_worn: row.is_worn,
      is_consumable: row.is_consumable,
      sort_order: currentListItemCount + i,
    }
  })

  const { error: liErr } = await supabase.from('list_items').insert(listItemRows)
  if (liErr) throw liErr
}

// ── Default categories ────────────────────────────────────────────────────────

const DEFAULT_CATEGORY_NAMES = [
  'Pack', 'Shelter', 'Sleep', 'Kitchen', 'Water', 'Clothing', 'Hygiene',
]

export async function seedDefaultCategories(userId: string): Promise<void> {
  const rows = DEFAULT_CATEGORY_NAMES.map((name, i) => ({
    user_id: userId,
    name,
    sort_order: i,
    is_default: true,
  }))
  const { error } = await supabase.from('categories').insert(rows)
  if (error) throw error
}
