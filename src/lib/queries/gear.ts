import { supabase } from '../supabase'
import type { Category, GearItem } from '../types'
import type { GearCsvRow } from '../csv'
import { resolveOrCreateCategories, resolveOrCreateGearForImport } from './import-helpers'
import { bulkUpdateSortOrder } from './optimistic'

// Owner-scoped private read. Explicit user_id filter is defense in depth
// against the cross-channel leak from gear_items_public_select_via_shared_list
// — see SECURITY.md "Query-level owner scoping". userId is required so a
// missing-session caller fails loudly rather than returning own + transitively-
// readable shared rows.
export async function fetchGearItems(userId: string): Promise<GearItem[]> {
  const { data, error } = await supabase
    .from('gear_items')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function createGearItem(
  userId: string,
  data: Pick<GearItem, 'name' | 'description' | 'weight_grams' | 'category_id' | 'cost' | 'purchase_date'>,
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
  patch: Partial<Pick<GearItem, 'name' | 'description' | 'weight_grams' | 'category_id' | 'cost' | 'purchase_date' | 'sort_order'>>,
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

export async function reorderGearItems(updates: { id: string; sort_order: number }[]): Promise<void> {
  await bulkUpdateSortOrder('gear_items', updates)
}

// ── CSV gear import ───────────────────────────────────────────────────────────

// Bulk-import gear items from CSV rows. Goes through the shared
// resolveOrCreateGearForImport helper so dedup is identical to the
// list-import path: rows whose (category + name + weight) matches an
// existing gear item are skipped silently — no new gear is inserted, no
// duplicates created. Within-CSV duplicates DO create separate gear items
// (typing two rows means two items). Returns import stats so the UI can
// report "X added, Y already in inventory."
export async function importGearItems(
  userId: string,
  rows: GearCsvRow[],
  existingCategories: Category[],
  existingGearItems: GearItem[],
  currentItemCount: number,
): Promise<{ newCount: number; matchedCount: number }> {
  const catByName = await resolveOrCreateCategories(userId, rows, existingCategories)
  const { newCount, matchedCount } = await resolveOrCreateGearForImport({
    userId,
    rows,
    existingGearItems,
    catByName,
    startSortOrder: currentItemCount,
  })
  return { newCount, matchedCount }
}
