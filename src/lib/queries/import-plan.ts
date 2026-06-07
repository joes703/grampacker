// Pure, cycle-free planner for atomic CSV list import.
//
// This module computes a fully-resolved import plan (which categories to
// create, which gear to create, and the list_items to attach) WITHOUT
// performing any writes. It must stay Supabase-free so it can be unit
// tested deterministically and so later tasks can hand the plan to an
// atomic RPC. It therefore imports ONLY pure modules: ./sort-keys, the
// types, gear-status, caps, and the ListImportRow type. It must NOT import
// import-helpers.ts, categories.ts, or gear.ts (all of which pull in
// `supabase`).
//
// The dedup semantics reproduce the existing import path exactly
// (resolveOrCreateCategories / resolveOrCreateGearForImport in
// import-helpers.ts): categories dedup by lowercased name; gear dedups
// against the EXISTING library only by gearKey(category, NFC-lower name,
// weight) so within-CSV duplicates create separate gear items; list_item
// sort_order is the original row index so dropped empty rows leave gaps.

import type { Category, GearItem } from '../types'
import type { ListImportRow } from '../csv'
import { DEFAULT_GEAR_STATUS, type GearStatus } from '../gear-status'
import { MAX_NAME_LENGTH, MAX_DESC_LENGTH } from '../caps'
import { gearKey, nextCategorySortOrder, nextGearItemSortOrder } from './sort-keys'

export type NewCategory = { id: string; name: string; sort_order: number }
export type CategoryPlan = { newCategories: NewCategory[]; refByLowerName: Map<string, string> }
export type NewGear = {
  id: string
  name: string
  description: string | null
  weight_grams: number
  category_id: string | null
  cost: number | null
  purchase_date: string | null
  status: GearStatus
  sort_order: number
}
export type GearPlan = { newGear: NewGear[]; gearRefByRow: (string | null)[] }
export type ListItemPlan = {
  gear_item_id: string
  quantity: number
  is_worn: boolean
  is_consumable: boolean
  sort_order: number
}
export type ListImportPlan = {
  newCategories: NewCategory[]
  newGear: NewGear[]
  listItems: ListItemPlan[]
}

// Resolve the categories referenced by the rows. Returns the new categories
// to create plus a lowercase-name -> id map covering both pre-existing and
// newly-planned categories. New categories get strictly-ascending
// sort_order past the existing max (gap-safe; see nextCategorySortOrder).
export function planNewCategories(
  rows: { category: string }[],
  existingCategories: Category[],
  genId: () => string,
): CategoryPlan {
  const refByLowerName = new Map<string, string>(
    existingCategories.map((c) => [c.name.toLowerCase(), c.id]),
  )
  const newCategories: NewCategory[] = []
  // Increment per NEW category only so the inserted block walks off the end
  // of the existing max without recomputing against partially-planned state.
  let n = 0
  for (const row of rows) {
    const name = row.category.trim()
    if (!name) continue
    const lower = name.toLowerCase()
    if (refByLowerName.has(lower)) continue
    const id = genId()
    newCategories.push({ id, name, sort_order: nextCategorySortOrder(existingCategories, n) })
    refByLowerName.set(lower, id)
    n++
  }
  return { newCategories, refByLowerName }
}

// Resolve each row to a gear id, planning new gear as needed. Matches the
// EXISTING library only (within-CSV duplicates create separate gear). Empty
// trimmed names resolve to null. New gear sort_order starts at the explicit
// startSortOrder and increments per new gear; the caller supplies it (this
// function does NOT recompute it).
export function planGearResolution(
  rows: {
    name: string
    description: string | null
    weight_grams: number
    category: string
    cost?: number | null
    purchase_date?: string | null
  }[],
  existingGearItems: GearItem[],
  refByLowerName: Map<string, string>,
  startSortOrder: number,
  genId: () => string,
): GearPlan {
  const existingByKey = new Map<string, string>()
  for (const g of existingGearItems) {
    existingByKey.set(gearKey(g.category_id, g.name, g.weight_grams), g.id)
  }

  const newGear: NewGear[] = []
  const gearRefByRow: (string | null)[] = []

  for (const row of rows) {
    const trimmedName = row.name.trim()
    if (!trimmedName) {
      gearRefByRow.push(null)
      continue
    }
    const categoryId = refByLowerName.get(row.category.trim().toLowerCase()) ?? null
    // Dedup key intentionally excludes cost/purchase_date (display-only
    // metadata). Matching on (category, name, weight) keeps a re-import
    // from duplicating the same physical item.
    const key = gearKey(categoryId, trimmedName, row.weight_grams)
    const existing = existingByKey.get(key)
    if (existing) {
      gearRefByRow.push(existing)
      continue
    }
    const id = genId()
    newGear.push({
      id,
      name: trimmedName.slice(0, MAX_NAME_LENGTH),
      description: row.description ? row.description.slice(0, MAX_DESC_LENGTH) : null,
      weight_grams: row.weight_grams,
      category_id: categoryId,
      cost: row.cost ?? null,
      purchase_date: row.purchase_date ?? null,
      // Status is app-internal only; CSV import does not carry it. Imported
      // gear always gets the default, matching the DB default.
      status: DEFAULT_GEAR_STATUS,
      sort_order: startSortOrder + newGear.length,
    })
    gearRefByRow.push(id)
  }

  return { newGear, gearRefByRow }
}

// Compose the full list-import plan: resolve categories, resolve gear (new
// gear sort_order starts past the existing gear max), then build list_items
// for every row that resolved to a gear id. list_item sort_order is the
// ORIGINAL row index, so dropped empty rows leave gaps - this is intentional.
export function buildListImportPlan(
  rows: ListImportRow[],
  existingGearItems: GearItem[],
  existingCategories: Category[],
  genId: () => string,
): ListImportPlan {
  const { newCategories, refByLowerName } = planNewCategories(rows, existingCategories, genId)
  const { newGear, gearRefByRow } = planGearResolution(
    rows,
    existingGearItems,
    refByLowerName,
    nextGearItemSortOrder(existingGearItems),
    genId,
  )

  const listItems: ListItemPlan[] = []
  for (let i = 0; i < rows.length; i++) {
    const gearId = gearRefByRow[i]
    if (gearId == null) continue
    const row = rows[i]
    if (!row) continue
    listItems.push({
      gear_item_id: gearId,
      quantity: row.quantity,
      is_worn: row.is_worn,
      is_consumable: row.is_consumable,
      sort_order: i,
    })
  }

  return { newCategories, newGear, listItems }
}
