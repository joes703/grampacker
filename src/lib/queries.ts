import { supabase } from './supabase'
import type { Category, GearItem } from './types'

export const queryKeys = {
  categories: () => ['categories'] as const,
  gearItems: () => ['gear-items'] as const,
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
