import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { reorderCategories, reorderGearItems, reorderListItems, reorderLists } from './queries'

// Integration test for the bulk reorder helpers. All four go through a
// SECURITY DEFINER RPC (bulk_update_sort_order) that runs UPDATE … SET
// sort_order against a whitelisted table — no INSERT path, no RLS WITH
// CHECK on a partial row, no NOT NULL trap. See migrations
// 20260430000000_bulk_reorder_rpc.sql (function shape),
// 20260501000000_bulk_reorder_rpc_ownership_check.sql (inline ownership),
// 20260502000000_add_gear_items_to_bulk_reorder.sql (gear_items branch),
// and 20260503000000_add_lists_to_bulk_reorder.sql (lists branch).
// Hits the real Supabase project from .env; requires TEST_USER_EMAIL +
// TEST_USER_PASSWORD set. Skips otherwise so the regular `npm run test`
// invocation stays usable.
//
// We exercise the wrappers, not bulkUpdateSortOrder directly — those are
// the code paths production uses for all four reorderable tables.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const email = import.meta.env.TEST_USER_EMAIL as string | undefined
const password = import.meta.env.TEST_USER_PASSWORD as string | undefined

const canRun = Boolean(url && key && email && password)
const d = canRun ? describe : describe.skip

d('bulk reorder helpers preserve untouched columns', () => {
  const supabase = createClient(url!, key!)

  beforeAll(async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email!,
      password: password!,
    })
    if (error) throw error
  })

  afterAll(async () => {
    await supabase.auth.signOut()
  })

  it('reorderCategories: only sort_order changes', async () => {
    const { data: row, error: pickErr } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (pickErr) throw pickErr
    if (!row) return // No categories in the test account.

    const before = row
    const newSort = before.sort_order + 100000

    try {
      await reorderCategories([{ id: before.id, sort_order: newSort }])

      const { data: after, error: refetchErr } = await supabase
        .from('categories')
        .select('*')
        .eq('id', before.id)
        .single()
      if (refetchErr) throw refetchErr

      expect(after.sort_order).toBe(newSort)

      // Every other column should be untouched — this is the regression we
      // were chasing: a partial upsert that violated RLS or blanked columns.
      expect(after.name).toBe(before.name)
      expect(after.is_default).toBe(before.is_default)
      expect(after.user_id).toBe(before.user_id)
      expect(after.created_at).toBe(before.created_at)
    } finally {
      // Always restore the original sort_order so the test is idempotent.
      await reorderCategories([{ id: before.id, sort_order: before.sort_order }])
    }
  })

  it('reorderGearItems: only sort_order changes', async () => {
    const { data: row, error: pickErr } = await supabase
      .from('gear_items')
      .select('*')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (pickErr) throw pickErr
    if (!row) return // No gear_items in the test account.

    const before = row
    const newSort = before.sort_order + 100000

    try {
      await reorderGearItems([{ id: before.id, sort_order: newSort }])

      const { data: after, error: refetchErr } = await supabase
        .from('gear_items')
        .select('*')
        .eq('id', before.id)
        .single()
      if (refetchErr) throw refetchErr

      expect(after.sort_order).toBe(newSort)

      expect(after.name).toBe(before.name)
      expect(after.description).toBe(before.description)
      expect(after.weight_grams).toBe(before.weight_grams)
      expect(after.category_id).toBe(before.category_id)
      expect(after.user_id).toBe(before.user_id)
      expect(after.created_at).toBe(before.created_at)
    } finally {
      await reorderGearItems([{ id: before.id, sort_order: before.sort_order }])
    }
  })

  it('reorderLists: only sort_order changes', async () => {
    const { data: row, error: pickErr } = await supabase
      .from('lists')
      .select('*')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (pickErr) throw pickErr
    if (!row) return // No lists in the test account.

    const before = row
    const newSort = before.sort_order + 100000

    try {
      await reorderLists([{ id: before.id, sort_order: newSort }])

      const { data: after, error: refetchErr } = await supabase
        .from('lists')
        .select('*')
        .eq('id', before.id)
        .single()
      if (refetchErr) throw refetchErr

      expect(after.sort_order).toBe(newSort)

      expect(after.name).toBe(before.name)
      expect(after.description).toBe(before.description)
      expect(after.share_token).toBe(before.share_token)
      expect(after.is_shared).toBe(before.is_shared)
      expect(after.user_id).toBe(before.user_id)
      expect(after.created_at).toBe(before.created_at)
    } finally {
      await reorderLists([{ id: before.id, sort_order: before.sort_order }])
    }
  })

  it('reorderListItems: only sort_order changes', async () => {
    const { data: row, error: pickErr } = await supabase
      .from('list_items')
      .select('*')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (pickErr) throw pickErr
    if (!row) return // No list_items in the test account.

    const before = row
    const newSort = before.sort_order + 100000

    try {
      await reorderListItems([{ id: before.id, sort_order: newSort }])

      const { data: after, error: refetchErr } = await supabase
        .from('list_items')
        .select('*')
        .eq('id', before.id)
        .single()
      if (refetchErr) throw refetchErr

      expect(after.sort_order).toBe(newSort)

      expect(after.quantity).toBe(before.quantity)
      expect(after.is_worn).toBe(before.is_worn)
      expect(after.is_consumable).toBe(before.is_consumable)
      expect(after.is_packed).toBe(before.is_packed)
      expect(after.gear_item_id).toBe(before.gear_item_id)
      expect(after.list_id).toBe(before.list_id)
      expect(after.created_at).toBe(before.created_at)
    } finally {
      await reorderListItems([{ id: before.id, sort_order: before.sort_order }])
    }
  })
})
