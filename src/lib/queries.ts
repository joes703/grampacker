import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Category, GearItem, List, ListItem, ListItemWithGear } from './types'
import { generateShareToken } from './share-token'
import type { GearCsvRow, ListImportRow } from './csv'

export const queryKeys = {
  categories: () => ['categories'] as const,
  gearItems: () => ['gear-items'] as const,
  lists: () => ['lists'] as const,
  listItems: (listId: string) => ['list-items', listId] as const,
}

// ── Bulk helpers ──────────────────────────────────────────────────────────────

// Single-round-trip sort_order rewrite for any reorder flow. Uses upsert with
// onConflict: 'id' so every row in `updates` hits the UPDATE path (every id
// already exists in the table — we never insert here). Empty updates list is a
// no-op so callers don't have to guard.
type ReorderableTable = 'lists' | 'list_items' | 'categories' | 'gear_items'

export async function bulkUpdateSortOrder(
  table: ReorderableTable,
  updates: { id: string; sort_order: number }[],
): Promise<void> {
  if (updates.length === 0) return
  const { error } = await supabase.from(table).upsert(updates, { onConflict: 'id' })
  if (error) throw error
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
  await bulkUpdateSortOrder('categories', updates)
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

// Categories referenced by the items in a shared list (public read).
// Relies on the categories_public_select_via_shared_list RLS policy.
export async function fetchSharedListCategories(categoryIds: string[]): Promise<Category[]> {
  if (categoryIds.length === 0) return []
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .in('id', categoryIds)
    .order('sort_order', { ascending: true })
  if (error) throw error
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
  description: string | null = null,
): Promise<List> {
  const { data, error } = await supabase
    .from('lists')
    .insert({
      user_id: userId,
      name,
      description,
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
  await bulkUpdateSortOrder('lists', updates)
}

// Create a new list and immediately populate it with the given gear items.
// Used by the "Create list from selection" flow in the gear library.
export async function createListFromSelection(
  userId: string,
  name: string,
  description: string | null,
  gearItemIds: string[],
  sortOrder: number,
): Promise<List> {
  const newList = await createList(userId, name, sortOrder, description)

  if (gearItemIds.length > 0) {
    const rows = gearItemIds.map((id, i) => ({
      list_id: newList.id,
      gear_item_id: id,
      sort_order: i,
    }))
    const { error } = await supabase.from('list_items').insert(rows)
    if (error) throw error
  }
  return newList
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
    // Copy only the user-editable fields onto the new list. id / list_id /
    // created_at / updated_at are owned by the database. Destructure with
    // an inline ListItem annotation so the supabase row type lines up
    // without a whole-array cast.
    const copies = items.map(
      ({
        gear_item_id,
        quantity,
        is_worn,
        is_consumable,
        is_packed,
        sort_order,
      }: ListItem) => ({
        list_id: newList.id,
        gear_item_id,
        quantity,
        is_worn,
        is_consumable,
        is_packed,
        sort_order,
      }),
    )
    const { error: insertErr } = await supabase.from('list_items').insert(copies)
    if (insertErr) throw insertErr
  }

  return newList
}

// ── ListItem mutations ────────────────────────────────────────────────────────

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

// ── CSV gear import ───────────────────────────────────────────────────────────

// Bulk-import gear items from CSV rows. Creates any categories that don't
// exist yet (matched by name, case-insensitive), then inserts every row.
export async function importGearItems(
  userId: string,
  rows: GearCsvRow[],
  existingCategories: Category[],
  currentItemCount: number,
): Promise<void> {
  const catByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]))

  const uniqueNames = [...new Set(rows.map((r) => r.category.trim()).filter(Boolean))]
  for (const name of uniqueNames) {
    if (!catByName.has(name.toLowerCase())) {
      const created = await createCategory(userId, name, existingCategories.length + catByName.size)
      catByName.set(name.toLowerCase(), created.id)
    }
  }

  const items = rows.map((row, i) => ({
    user_id: userId,
    name: row.name.trim().slice(0, 256),
    description: row.description ? row.description.slice(0, 2000) : null,
    weight_grams: row.weight_grams,
    category_id: row.category.trim()
      ? (catByName.get(row.category.trim().toLowerCase()) ?? null)
      : null,
    sort_order: currentItemCount + i,
  }))

  const { error } = await supabase.from('gear_items').insert(items)
  if (error) throw error
}

// ── Reorder mutation lifecycle ────────────────────────────────────────────────

// Canonical optimistic-update lifecycle for any reorder mutation that takes
// `{id, sort_order}[]`. Handles cancel → snapshot → optimistic write → roll
// back on error → settle (invalidate). Drop into a useMutation alongside its
// mutationFn:
//
//   useMutation({
//     mutationFn: reorderCategories,
//     ...makeOptimisticReorder<Category>(qc, queryKeys.categories()),
//   })
//
// The cached array gets each affected item's sort_order rewritten in place
// and is then re-sorted by sort_order so the visual order matches.
//
// IMPORTANT: `updates` must be a permutation of an existing subset of the
// cached rows — i.e. every id in `updates` must already exist in the cache,
// and the sort_order values must be a permutation of those rows' existing
// sort_order values. Passing a partial subset with arbitrary values can
// silently corrupt the cache: rows you didn't touch keep their old
// sort_order, the merged + sorted result then puts them in surprising
// positions, and the optimistic state diverges from the eventual server
// truth until the next refetch. `assignSortOrderSlots` (in grouping.ts) is
// the canonical way to build a safe `updates` array.
export function makeOptimisticReorder<T extends { id: string; sort_order: number }>(
  qc: QueryClient,
  queryKey: QueryKey,
) {
  return {
    onMutate: async (updates: { id: string; sort_order: number }[]) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<T[]>(queryKey)
      const byId = new Map(updates.map((u) => [u.id, u.sort_order]))
      qc.setQueryData<T[]>(queryKey, (curr) => {
        if (!curr) return curr
        return curr
          .map((item) => (byId.has(item.id) ? { ...item, sort_order: byId.get(item.id)! } : item))
          .sort((a, b) => a.sort_order - b.sort_order)
      })
      return { previous }
    },
    onError: (
      _err: unknown,
      _vars: unknown,
      ctx: { previous: T[] | undefined } | undefined,
    ) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey })
    },
  }
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
