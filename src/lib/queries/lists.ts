import { supabase } from '../supabase'
import type { List, ListItem, PublicList } from '../types'
import { generateSlug } from '../slug'
import { bulkUpdateSortOrder } from './optimistic'

// Insert helper that retries on a unique-violation against lists.slug.
// Slug collisions are astronomically rare (6 chars × base62 = ~57B values
// vs. ≤100 lists per user), but the UNIQUE constraint demands the retry
// exist for correctness. After 5 attempts something is genuinely wrong;
// surface it loudly rather than silently failing the insert.
async function withSlugRetry<T>(insert: (slug: string) => Promise<T>, max = 5): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await insert(generateSlug())
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code !== '23505') throw err
      lastErr = err
    }
  }
  throw lastErr ?? new Error('slug generation: exhausted retries')
}

// Owner-scoped private read. Explicit user_id filter is defense in depth
// against the cross-channel leak from public *_select_shared policies — see
// SECURITY.md "Query-level owner scoping". userId is required (not optional)
// so a missing-session caller fails loudly rather than silently returning
// the union of own + shared rows.
export async function fetchLists(userId: string): Promise<List[]> {
  const { data, error } = await supabase
    .from('lists')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

// Public read (shared list, no auth). Returns only the columns the share
// view renders — no user_id, no slug echo, no is_shared / sort_order /
// timestamps. See SECURITY.md "Public read paths" for the allowlist.
export async function fetchSharedList(slug: string): Promise<PublicList | null> {
  const { data, error } = await supabase
    .from('lists')
    .select('id, name, description')
    .eq('slug', slug)
    .eq('is_shared', true)
    .single()
  if (error) return null
  return data
}

export async function createList(
  userId: string,
  name: string,
  sortOrder: number,
  description: string | null = null,
): Promise<List> {
  return withSlugRetry(async (slug) => {
    const { data, error } = await supabase
      .from('lists')
      .insert({
        user_id: userId,
        name,
        description,
        sort_order: sortOrder,
        slug,
      })
      .select()
      .single()
    if (error) throw error
    return data
  })
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
//
// Phase 8 (M3a): one SECURITY DEFINER RPC replaces the previous
// createList + bulk list_items insert pair. Two RTT -> one. Slug retry
// stays client-side via withSlugRetry — the RPC takes p_slug and the
// 23505 propagates through supabase.rpc()'s PostgrestError.
//
// Atomicity is now visible: previously the parent list could persist
// even if the bulk list_items insert failed (cap trigger, FK on a stale
// gear_item_id). The RPC wraps both inserts in one transaction, so any
// failure rolls back the whole gesture — no orphan list rows.
export async function createListFromSelection(
  userId: string,
  name: string,
  description: string | null,
  gearItemIds: string[],
  sortOrder: number,
): Promise<List> {
  return withSlugRetry(async (slug) => {
    const { data, error } = await supabase.rpc('create_list_from_selection', {
      p_user_id: userId,
      p_name: name,
      p_description: description,
      p_slug: slug,
      p_sort_order: sortOrder,
      p_gear_item_ids: gearItemIds,
    })
    if (error) throw error
    return data as List
  })
}

export async function duplicateList(source: List, userId: string, sortOrder: number): Promise<List> {
  const newList = await withSlugRetry(async (slug) => {
    const { data, error } = await supabase
      .from('lists')
      .insert({
        user_id: userId,
        name: `${source.name} (copy)`,
        description: source.description,
        sort_order: sortOrder,
        slug,
      })
      .select()
      .single()
    if (error) throw error
    return data
  })

  const { data: items, error: itemsErr } = await supabase
    .from('list_items')
    .select('*')
    .eq('user_id', userId)
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
        user_id: userId,
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
