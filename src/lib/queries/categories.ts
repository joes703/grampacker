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

// Categories referenced by the items in a shared list (public read). Relies
// on the categories_public_select_via_shared_list RLS policy. Returns only
// the columns the share view renders: no user_id, no is_default, no
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

// Next sort_order slot for a newly-created category. Robust to gaps:
// deleteCategory does NOT compact remaining rows, so the existing
// sequence is sparse whenever a delete has happened, and naive
// length-based slot picking (the original convention everywhere a
// category was created) collides with an existing row. Reads order by
// (sort_order, name), so the collision either ties or rearranges
// silently.
//
// `offset` is for batched callers (CSV import): pass 0 for the first
// new category in a single client-side gesture, 1 for the next, etc.,
// so they walk off the end of the existing max without recomputing it
// against partially-inserted state.
export function nextCategorySortOrder(
  existing: Pick<Category, 'sort_order'>[],
  offset = 0,
): number {
  let max = -1
  for (const c of existing) if (c.sort_order > max) max = c.sort_order
  return max + 1 + offset
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
