import { supabase } from '../supabase'
import type { Category, PublicCategory } from '../types'
import { bulkUpdateSortOrder } from './bulk-reorder'

// Owner-scoped private read. See queries/index.ts for the convention.
export async function fetchCategories(userId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

// Categories referenced by the items in a shared list (public read). Reads
// through a curated DB view that physically omits private base-table columns
// (user_id, is_default, created_at). See SECURITY.md "Public read paths" for
// the allowlist.
export async function fetchSharedListCategories(categoryIds: string[]): Promise<PublicCategory[]> {
  if (categoryIds.length === 0) return []
  const { data, error } = await supabase
    .from('public_gear_categories')
    .select('id, name, sort_order')
    .in('id', categoryIds)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data
}

// nextCategorySortOrder now lives in the Supabase-free sort-keys module so
// the pure import planner can use it without a cycle. Re-exported here for
// back-compat with existing import sites.
export { nextCategorySortOrder } from './sort-keys'

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

export async function updateCategory(id: string, patch: Partial<Pick<Category, 'name'>>): Promise<void> {
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
