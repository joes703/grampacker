import { supabase } from '../supabase'
import { FOOD_ITEM_CAP } from '../caps'
import type { FoodItem } from '../types'

// The owner-editable column set (everything except identity/audit columns).
export type FoodItemInput = Pick<
  FoodItem,
  | 'name'
  | 'brand'
  | 'serving_description'
  | 'serving_weight_grams'
  | 'calories_per_serving'
  | 'servings_per_package'
  | 'fat_grams'
  | 'saturated_fat_grams'
  | 'carbs_grams'
  | 'fiber_grams'
  | 'sugar_grams'
  | 'protein_grams'
  | 'sodium_mg'
  | 'potassium_mg'
  | 'notes'
>

// Owner-scoped read: explicit user_id filter on top of RLS, per the
// queries/index.ts convention (defense against the cross-channel leak).
export async function fetchFoodItems(userId: string): Promise<FoodItem[]> {
  const { data, error } = await supabase
    .from('food_items')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function createFoodItem(
  userId: string,
  data: FoodItemInput,
  sortOrder: number,
): Promise<FoodItem> {
  const { data: row, error } = await supabase
    .from('food_items')
    .insert({ user_id: userId, sort_order: sortOrder, ...data })
    .select()
    .single()
  if (error) throw error
  return row
}

export async function updateFoodItem(id: string, patch: Partial<FoodItemInput>): Promise<void> {
  const { error } = await supabase.from('food_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteFoodItem(id: string): Promise<void> {
  const { error } = await supabase.from('food_items').delete().eq('id', id)
  if (error) throw error
}

// Pure helpers (unit-tested).
export function nextFoodItemSortOrder(items: FoodItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1
}

// Client-side preflight mirroring the DB cap trigger (friendly message
// before the write hits the DB).
export function assertFoodItemWithinCap(existing: FoodItem[]): void {
  if (existing.length >= FOOD_ITEM_CAP) {
    throw new Error(
      `Your food library is full (${FOOD_ITEM_CAP} foods max). Delete some foods to add more.`,
    )
  }
}

// Bulk-import cap preflight: the whole import must fit under FOOD_ITEM_CAP.
// The DB trigger remains authoritative; this turns a generic post-write
// failure into a specific, friendly message and avoids a partial write.
export function assertFoodImportWithinCap(existing: FoodItem[], incoming: number): void {
  if (existing.length + incoming > FOOD_ITEM_CAP) {
    throw new Error(
      `Importing ${incoming} food${incoming === 1 ? '' : 's'} would exceed your food library limit (${FOOD_ITEM_CAP} max). You have ${existing.length}. Remove some foods or split the import.`,
    )
  }
}

// Bulk-import food items from validated CSV rows. Single owner-scoped INSERT of
// full rows (every NOT NULL column is provided), so there is no partial-column
// upsert/RLS trap - a plain INSERT is correct here. New rows mint server-side
// ids and get sort_order appended after the existing library. No dedup: each
// valid CSV row becomes a new food item.
export async function importFoodItems(
  userId: string,
  items: FoodItemInput[],
  existing: FoodItem[],
): Promise<{ newCount: number }> {
  assertFoodImportWithinCap(existing, items.length)
  const start = nextFoodItemSortOrder(existing)
  const rows = items.map((item, i) => ({ user_id: userId, sort_order: start + i, ...item }))
  const { error } = await supabase.from('food_items').insert(rows)
  if (error) throw error
  return { newCount: rows.length }
}
