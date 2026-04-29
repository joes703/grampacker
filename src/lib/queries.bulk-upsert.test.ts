import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { bulkUpdateSortOrder } from './queries'

// Integration test for bulkUpdateSortOrder. Verifies that an upsert with only
// {id, sort_order} touches sort_order and nothing else. Hits the real Supabase
// project from .env. Requires TEST_USER_EMAIL + TEST_USER_PASSWORD to be set
// (a user account whose seeded data we can poke). Skips otherwise so the
// regular `npm run test` invocation stays usable.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const email = import.meta.env.TEST_USER_EMAIL as string | undefined
const password = import.meta.env.TEST_USER_PASSWORD as string | undefined

const canRun = Boolean(url && key && email && password)
const d = canRun ? describe : describe.skip

d('bulkUpdateSortOrder preserves untouched columns', () => {
  const supabase = createClient(url!, key!)

  beforeAll(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: email!, password: password! })
    if (error) throw error
  })

  afterAll(async () => {
    await supabase.auth.signOut()
  })

  it('only sort_order changes for gear_items', async () => {
    const { data: row, error: pickErr } = await supabase
      .from('gear_items')
      .select('*')
      .order('sort_order', { ascending: true })
      .limit(1)
      .single()
    if (pickErr) throw pickErr

    const before = row
    const newSort = before.sort_order + 100000

    try {
      await bulkUpdateSortOrder('gear_items', [{ id: before.id, sort_order: newSort }])

      const { data: after, error: refetchErr } = await supabase
        .from('gear_items')
        .select('*')
        .eq('id', before.id)
        .single()
      if (refetchErr) throw refetchErr

      // sort_order should have changed:
      expect(after.sort_order).toBe(newSort)

      // every other user-facing column should be untouched:
      expect(after.name).toBe(before.name)
      expect(after.description).toBe(before.description)
      expect(after.weight_grams).toBe(before.weight_grams)
      expect(after.category_id).toBe(before.category_id)
      expect(after.user_id).toBe(before.user_id)
      expect(after.created_at).toBe(before.created_at)
    } finally {
      // Always restore the original sort_order so the test is idempotent.
      await bulkUpdateSortOrder('gear_items', [{ id: before.id, sort_order: before.sort_order }])
    }
  })

  it('only sort_order changes for list_items', async () => {
    const { data: row, error: pickErr } = await supabase
      .from('list_items')
      .select('*')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (pickErr) throw pickErr
    if (!row) {
      // No list_items in the test account — nothing to verify here.
      return
    }

    const before = row
    const newSort = before.sort_order + 100000

    try {
      await bulkUpdateSortOrder('list_items', [{ id: before.id, sort_order: newSort }])

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
      await bulkUpdateSortOrder('list_items', [{ id: before.id, sort_order: before.sort_order }])
    }
  })
})
