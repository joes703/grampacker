import { supabase } from '../supabase'
import type { Category, GearItem } from '../types'
import { createCategory } from './categories'
import { planNewCategories, planGearResolution } from './import-plan'
import { randomTempId } from '../random-temp-id'

// Shared CSV-import helpers used by both list-import (importListFromCsv)
// and gear-only-import (importGearItems). The two paths differ only in
// whether they go on to attach list_items afterwards; gear resolution and
// dedup are identical.

// gearKey now lives in the Supabase-free sort-keys module so the pure
// import planner can use it without a cycle. Re-exported here for
// back-compat with existing import sites.
export { gearKey } from './sort-keys'

// Per-user / per-list resource caps. Canonical definitions live in
// ../caps; re-exported here so existing import-path callers (and the
// queries barrel) keep their import sites unchanged. The DB triggers
// remain the source of truth (check_gear_item_limit in 20260425000001,
// check_list_item_limit in 20260425000002); these mirror them so the
// import paths can preflight and surface a specific, friendly message
// BEFORE writing anything. Without the preflight an over-cap bulk insert
// aborts at the trigger with a generic error AFTER resolveOrCreateCategories
// has already committed new categories (orphaning them) and, for list
// import, after the new list row was created (orphaning it).
export { GEAR_ITEM_CAP, LIST_ITEM_CAP } from '../caps'
import { GEAR_ITEM_CAP, LIST_ITEM_CAP } from '../caps'

// Dedup key for the preflight counter. Mirrors gearKey's name handling
// (trim + NFC + lowercase) but keys the category by NAME rather than id,
// so it can run before any not-yet-created category has an id. Category
// names are unique per user (resolveOrCreateCategories collapses by
// lowercased name), so this is equivalent to the id-based key the real
// import dedup uses.
function importDedupKey(categoryNameLower: string, name: string, weight_grams: number): string {
  return `${categoryNameLower}:${name.trim().normalize('NFC').toLowerCase()}:${weight_grams}`
}

// How many NEW gear items an import would create, computed WITHOUT any
// writes (mirrors resolveOrCreateGearForImport's dedup). Rows whose
// (category, name, weight) matches existing gear, and rows with empty
// names, create nothing. A row referencing a not-yet-existing category
// can never match existing gear, so it always counts as new. Used by the
// cap preflight; the real import still does the authoritative dedup.
export function countNewGearForImport(
  rows: { name: string; category: string; weight_grams: number }[],
  existingGearItems: GearItem[],
  existingCategories: Category[],
): number {
  // Match resolveOrCreateCategories' lookup: existing category names are
  // keyed lowercased (no trim); row categories are trimmed then lowercased.
  const catNameById = new Map(existingCategories.map((c) => [c.id, c.name.toLowerCase()]))
  const existingKeys = new Set(
    existingGearItems.map((g) =>
      importDedupKey(g.category_id ? (catNameById.get(g.category_id) ?? '') : '', g.name, g.weight_grams),
    ),
  )
  let newCount = 0
  for (const row of rows) {
    if (!row.name.trim()) continue
    const key = importDedupKey(row.category.trim().toLowerCase(), row.name, row.weight_grams)
    if (!existingKeys.has(key)) newCount++
  }
  return newCount
}

// Throws a friendly Error if importing `rows` would push the inventory
// over GEAR_ITEM_CAP. Call BEFORE any write (categories included) so a
// rejected import leaves nothing behind.
export function assertGearImportWithinCap(
  rows: { name: string; category: string; weight_grams: number }[],
  existingGearItems: GearItem[],
  existingCategories: Category[],
): void {
  const newGear = countNewGearForImport(rows, existingGearItems, existingCategories)
  if (existingGearItems.length + newGear > GEAR_ITEM_CAP) {
    throw new Error(
      `This import would add ${newGear} new gear item${newGear === 1 ? '' : 's'} to your ${existingGearItems.length} existing, exceeding the ${GEAR_ITEM_CAP}-item inventory limit. Remove some items or split the file into smaller batches.`,
    )
  }
}

// Throws a friendly Error if importing `rows` into a new list would
// exceed the per-list item cap or the inventory cap. Call BEFORE the new
// list is created so a rejected import leaves no orphan list/categories.
export function assertListImportWithinCaps(
  rows: { name: string; category: string; weight_grams: number }[],
  existingGearItems: GearItem[],
  existingCategories: Category[],
): void {
  const importable = rows.filter((r) => r.name.trim().length > 0).length
  if (importable > LIST_ITEM_CAP) {
    throw new Error(
      `A single list can hold at most ${LIST_ITEM_CAP} items; this file has ${importable}. Split it across multiple lists.`,
    )
  }
  assertGearImportWithinCap(rows, existingGearItems, existingCategories)
}

// Resolve/create categories referenced by the import rows. Returns a
// lowercase-name → category-id map covering both pre-existing categories
// and any newly-created ones.
export async function resolveOrCreateCategories(
  userId: string,
  rows: { category: string }[],
  existingCategories: Category[],
): Promise<Map<string, string>> {
  // Plan the new categories purely (dedup by lowercased name, gap-safe
  // sort_order off the existing max), then insert them in order. The map
  // we return covers both pre-existing categories and the newly-created
  // ids (keyed by lowercased name).
  const { newCategories } = planNewCategories(rows, existingCategories, randomTempId)
  const catByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]))
  for (const c of newCategories) {
    const created = await createCategory(userId, c.name, c.sort_order)
    catByName.set(c.name.toLowerCase(), created.id)
  }
  return catByName
}

// Resolve each CSV row to a gear_id, creating new gear items as needed.
// Match policy:
//   - Match against existing library only. Newly-created gear within this
//     import is NOT considered a match candidate for later rows (within-CSV
//     duplicates create separate gear items, matching user typing intent).
//   - Match key is gearKey(category_id, name, weight_grams), an exact triple.
//
// Returns gear ids in the same order as the input rows. Rows with empty
// names yield null (the list-items path filters them out before insert).
export async function resolveOrCreateGearForImport({
  userId,
  rows,
  existingGearItems,
  catByName,
  startSortOrder,
}: {
  userId: string
  rows: {
    name: string
    description: string | null
    weight_grams: number
    category: string
    cost?: number | null
    purchase_date?: string | null
  }[]
  existingGearItems: GearItem[]
  catByName: Map<string, string>
  startSortOrder: number
}): Promise<{ gearIdByRow: (string | null)[]; newCount: number; matchedCount: number }> {
  // Pass the caller's startSortOrder straight through; the planner owns the
  // dedup (match against existing library only) and the per-new sort_order
  // walk. We do NOT recompute startSortOrder here.
  const { newGear, gearRefByRow } = planGearResolution(
    rows,
    existingGearItems,
    catByName,
    startSortOrder,
    randomTempId,
  )
  const newIds = new Set(newGear.map((g) => g.id))
  // matchedCount = rows resolved to an existing gear id: non-null refs that
  // are not one of this import's planned placeholder ids. Empty-name rows
  // yield null refs (excluded); new-gear rows carry placeholder ids in
  // newIds (excluded). Equivalent to the prior per-existing-match counter.
  const matchedCount = gearRefByRow.filter((ref) => ref !== null && !newIds.has(ref)).length

  if (newGear.length === 0) {
    return { gearIdByRow: gearRefByRow, newCount: 0, matchedCount }
  }

  // NewGear omits user_id (it targets the atomic RPC), but this direct
  // gear_items insert needs it. Build each row explicitly (also drops the
  // planner's placeholder id so the DB assigns the real ids).
  const { data: created, error } = await supabase
    .from('gear_items')
    .insert(
      newGear.map((g) => ({
        user_id: userId,
        name: g.name,
        description: g.description,
        weight_grams: g.weight_grams,
        category_id: g.category_id,
        cost: g.cost,
        purchase_date: g.purchase_date,
        status: g.status,
        sort_order: g.sort_order,
      })),
    )
    .select('id')
  if (error) throw error

  // Supabase preserves insertion order: created[i] is newGear[i]'s id.
  const idByPlaceholder = new Map<string, string>()
  newGear.forEach((g, idx) => {
    const c = created[idx]
    if (c) idByPlaceholder.set(g.id, c.id)
  })
  const gearIdByRow = gearRefByRow.map((ref) => {
    if (ref === null) return null
    const realId = idByPlaceholder.get(ref)
    // ref is either an existing gear id (not in the map) or a placeholder
    // id that maps to a real server id.
    return realId ?? ref
  })

  return { gearIdByRow, newCount: newGear.length, matchedCount }
}
