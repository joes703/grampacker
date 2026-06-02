import { supabase } from '../supabase'
import type { Category, GearItem } from '../types'
import type { GearCsvRow } from '../csv'
import {
  resolveOrCreateCategories,
  resolveOrCreateGearForImport,
  assertGearImportWithinCap,
} from './import-helpers'
import { bulkUpdateSortOrder } from './bulk-reorder'

// Owner-scoped private read. See queries/index.ts for the convention.
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

// Next sort_order slot for a newly-created gear item. Same rationale as
// nextCategorySortOrder: deleteGearItem (and bulkDeleteGearItems) do not
// compact, so the existing sequence is sparse after any delete, and
// length-based slot picking ties with an existing row. The (sort_order,
// name) read order then silently reshuffles the user's gear library.
// `offset` is for batched callers (CSV import): pass 0 for the first new
// row, 1 for the next, etc.
export function nextGearItemSortOrder(
  existing: Pick<GearItem, 'sort_order'>[],
  offset = 0,
): number {
  let max = -1
  for (const g of existing) if (g.sort_order > max) max = g.sort_order
  return max + 1 + offset
}

export async function createGearItem(
  userId: string,
  data: Pick<
    GearItem,
    'name' | 'description' | 'weight_grams' | 'category_id' | 'cost' | 'purchase_date' | 'status'
  >,
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
  patch: Partial<
    Pick<
      GearItem,
      'name' | 'description' | 'weight_grams' | 'category_id' | 'cost' | 'purchase_date' | 'status'
    >
  >,
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
// existing gear item are skipped silently. No new gear is inserted, no
// duplicates created. Within-CSV duplicates DO create separate gear items
// (typing two rows means two items). Returns import stats so the UI can
// report "X added, Y already in inventory."
export async function importGearItems(
  userId: string,
  rows: GearCsvRow[],
  existingCategories: Category[],
  existingGearItems: GearItem[],
): Promise<{ newCount: number; matchedCount: number }> {
  // Preflight the inventory cap BEFORE creating any categories, so a
  // rejected over-cap import leaves no orphan categories behind. The DB
  // trigger remains authoritative; this just turns a generic post-write
  // failure into a specific, friendly message.
  assertGearImportWithinCap(rows, existingGearItems, existingCategories)
  const catByName = await resolveOrCreateCategories(userId, rows, existingCategories)
  const { newCount, matchedCount } = await resolveOrCreateGearForImport({
    userId,
    rows,
    existingGearItems,
    catByName,
    startSortOrder: nextGearItemSortOrder(existingGearItems),
  })
  return { newCount, matchedCount }
}
