import { supabase } from '../supabase'
import type { Category } from '../types'
import { bulkUpdateSortOrder } from './optimistic'

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
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
