import { supabase } from '../supabase'
import type { List, PublicList } from '../types'
import { generateSlug } from '../slug'
import { bulkUpdateSortOrder } from './bulk-reorder'

// Typeguard for Postgres unique-violation errors propagated through
// supabase.from(...) and supabase.rpc(...). PostgrestError carries the
// pg error code on .code; checking explicitly avoids a soft cast.
function isPgUniqueViolation(err: unknown): err is { code: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  )
}

// Insert helper that retries on a unique-violation against lists.slug.
// Slug collisions are astronomically rare (6 chars × base62 = ~57B values
// vs. ≤100 lists per user), but the UNIQUE constraint demands the retry
// exist for correctness. After 5 attempts something is genuinely wrong;
// surface it loudly rather than silently failing the insert.
async function withSlugRetry<T>(insert: (slug: string) => Promise<T>, max = 5): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await insert(generateSlug())
    } catch (err: unknown) {
      if (!isPgUniqueViolation(err)) throw err
      lastErr = err
    }
  }
  // Reachable when (a) `max` 23505 collisions in a row, which is
  // astronomically unlikely, or (b) the caller passes `max <= 0` so the
  // loop body never runs and `lastErr` stays undefined. The explicit
  // Error fallback covers (b) so toast/error-handling that expects a
  // real Error doesn't see a thrown undefined.
  throw lastErr ?? new Error('slug generation: exhausted retries')
}

// Owner-scoped private read. See queries/index.ts for the convention.
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
// view renders: no user_id, no slug echo, no is_shared / sort_order /
// timestamps. See SECURITY.md "Public read paths" for the allowlist.
// group_worn is included so the share view honors the owner's worn-grouping
// preference (see PublicList in types.ts).
//
// PGRST116 (`.single()` returned 0 rows) is the legitimate "this slug
// isn't a shared list" signal and maps to `null` so the share page can
// render its friendly "List not found" copy. Any other error (network,
// 5xx, an RLS misconfiguration that would otherwise silently masquerade
// as not-found) propagates so TanStack Query exposes the failure and the
// share page distinguishes a real outage from a bad link.
export async function fetchSharedList(slug: string): Promise<PublicList | null> {
  const { data, error } = await supabase
    .from('lists')
    .select('id, name, description, group_worn')
    .eq('slug', slug)
    .eq('is_shared', true)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
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
  patch: Partial<
    Pick<List, 'name' | 'description' | 'is_shared' | 'group_worn' | 'ready_checks_enabled'>
  >,
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
// Phase 8 (M3a): one RPC replaces the previous createList + bulk
// list_items insert pair. Two RTT -> one. Slug retry stays client-side
// via withSlugRetry; the RPC takes p_slug and the 23505 propagates
// through supabase.rpc()'s PostgrestError. The function is SECURITY
// INVOKER as of 20260514202025_reduce_security_definer (was DEFINER
// when introduced); ownership is enforced by the inline auth.uid()
// check on p_user_id plus RLS on lists/list_items running under the
// invoker.
//
// Atomicity is now visible: previously the parent list could persist
// even if the bulk list_items insert failed (cap trigger, FK on a stale
// gear_item_id). The RPC wraps both inserts in one transaction, so any
// failure rolls back the whole gesture and no orphan list rows are left
// behind.
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

// Phase 8 (M3b): one RPC replaces the previous 3-call chain (lists
// insert + list_items SELECT + bulk list_items insert). Three RTT ->
// one. The "(copy)" name suffix and per-row field copying happen
// inside the RPC; this function passes only the source id, slug, and
// sort_order. The `source: List` parameter shape is preserved for
// caller compatibility; passing the whole row is harmless even though
// only `source.id` is read here. SECURITY INVOKER as of
// 20260514202025_reduce_security_definer (was DEFINER when
// introduced); ownership is enforced by the inline auth.uid() check on
// p_user_id plus RLS on lists/list_items running under the invoker.
export async function duplicateList(source: List, userId: string, sortOrder: number): Promise<List> {
  return withSlugRetry(async (slug) => {
    const { data, error } = await supabase.rpc('duplicate_list', {
      p_user_id: userId,
      p_source_list_id: source.id,
      p_slug: slug,
      p_sort_order: sortOrder,
    })
    if (error) throw error
    return data as List
  })
}
