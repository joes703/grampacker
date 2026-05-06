import { supabase } from '../supabase'
import type { Category, PublicCategory } from '../types'
import { bulkUpdateSortOrder } from './optimistic'

// Owner-scoped private read. Explicit user_id filter is defense in depth
// against the cross-channel leak from categories_public_select_via_shared_list
// — see SECURITY.md "Query-level owner scoping". userId is required so a
// missing-session caller fails loudly rather than returning own +
// transitively-readable shared rows.
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

// Categories referenced by the items in a shared list (public read). Relies
// on the categories_public_select_via_shared_list RLS policy. Returns only
// the columns the share view renders — no user_id, no is_default, no
// created_at. See SECURITY.md "Public read paths" for the allowlist.
export async function fetchSharedListCategories(categoryIds: string[]): Promise<PublicCategory[]> {
  if (categoryIds.length === 0) return []
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, sort_order')
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
