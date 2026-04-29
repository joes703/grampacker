import { supabase } from '../supabase'
import type { Category, GearItem } from '../types'
import type { GearCsvRow } from '../csv'
import { createCategory } from './categories'

export async function fetchGearItems(): Promise<GearItem[]> {
  const { data, error } = await supabase
    .from('gear_items')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

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
