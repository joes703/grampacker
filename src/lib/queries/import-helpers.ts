import { supabase } from '../supabase'
import { DEFAULT_GEAR_STATUS, type GearStatus } from '../gear-status'
import type { Category, GearItem } from '../types'
import { createCategory, nextCategorySortOrder } from './categories'

// Shared CSV-import helpers used by both list-import (importCsvRowsToList)
// and gear-only-import (importGearItems). The two paths differ only in
// whether they go on to insert list_items afterwards; gear resolution and
// dedup are identical.

// Composite dedup key: a CSV row matches an existing gear item when its
// category + lowercase name + weight all agree. Same shape used to seed the
// existing-gear map and to look up each row.
//
// Unicode normalization: NFC before lowercase so visually identical names
// that happen to be encoded differently (e.g. "café" with a precomposed
// `é` vs. "café" composed as `e` + combining acute) compare equal.
// Without this, a re-import from a tool that emits NFD created duplicate
// gear rows for the same item. NFC + toLowerCase (not toLocaleLowerCase)
// stays locale-independent so the key is identical in every runtime.
export function gearKey(categoryId: string | null, name: string, weight_grams: number): string {
  return `${categoryId ?? ''}:${name.trim().normalize('NFC').toLowerCase()}:${weight_grams}`
}

// Per-user / per-list resource caps. The DB triggers are the source of
// truth (check_gear_item_limit in 20260425000001, check_list_item_limit
// in 20260425000002); these mirror them so the import paths can preflight
// and surface a specific, friendly message BEFORE writing anything.
// Without the preflight an over-cap bulk insert aborts at the trigger
// with a generic error AFTER resolveOrCreateCategories has already
// committed new categories (orphaning them) and, for list import, after
// the new list row was created (orphaning it). These constants are for
// UX only; they do not replace the authoritative DB enforcement.
export const GEAR_ITEM_CAP = 500
export const LIST_ITEM_CAP = 300

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
  const catByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]))
  const uniqueCatNames = [...new Set(rows.map((r) => r.category.trim()).filter(Boolean))]
  // Walk off the end of the existing max sort_order, not the existing
  // count. Deletes leave gaps (categories.deleteCategory does not
  // compact), so `existing.length` would tie an existing row whenever a
  // category had been deleted. `nextCategorySortOrder` snapshots the max
  // once; we increment a local counter per insert so a batch of new
  // categories gets a strictly-ascending block past the existing tail.
  let newCount = 0
  for (const name of uniqueCatNames) {
    if (!catByName.has(name.toLowerCase())) {
      const created = await createCategory(
        userId,
        name,
        nextCategorySortOrder(existingCategories, newCount),
      )
      catByName.set(name.toLowerCase(), created.id)
      newCount++
    }
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
  const gearIdByExistingKey = new Map<string, string>()
  for (const g of existingGearItems) {
    gearIdByExistingKey.set(gearKey(g.category_id, g.name, g.weight_grams), g.id)
  }

  // queueIndices[i] === null means row i resolved to existing gear (id is in
  // gearIdByRow[i] already). Otherwise row i is queued at newGearRows[that index].
  const gearIdByRow: (string | null)[] = []
  const queueIndices: (number | null)[] = []
  const newGearRows: {
    user_id: string
    name: string
    description: string | null
    weight_grams: number
    category_id: string | null
    cost: number | null
    purchase_date: string | null
    status: GearStatus
    sort_order: number
  }[] = []
  let matchedCount = 0

  for (const row of rows) {
    const trimmedName = row.name.trim()
    if (!trimmedName) {
      gearIdByRow.push(null)
      queueIndices.push(null)
      continue
    }
    const categoryId = resolveCategoryId(row.category, catByName)
    // Dedup key intentionally excludes cost/purchase_date. Those are
    // display-only metadata and can change over time without making an
    // item "different". Matching on (category, name, weight) keeps a
    // re-import from duplicating the same physical item.
    const key = gearKey(categoryId, trimmedName, row.weight_grams)
    const existing = gearIdByExistingKey.get(key)
    if (existing) {
      gearIdByRow.push(existing)
      queueIndices.push(null)
      matchedCount++
    } else {
      gearIdByRow.push(null)
      queueIndices.push(newGearRows.length)
      newGearRows.push({
        user_id: userId,
        name: trimmedName.slice(0, 256),
        description: row.description ? row.description.slice(0, 2000) : null,
        weight_grams: row.weight_grams,
        category_id: categoryId,
        cost: row.cost ?? null,
        purchase_date: row.purchase_date ?? null,
        // Status is app-internal only; CSV import does not carry it.
        // Imported gear always gets the default, matching the DB default
        // and the GearItemDialog default.
        status: DEFAULT_GEAR_STATUS,
        sort_order: startSortOrder + newGearRows.length,
      })
    }
  }

  if (newGearRows.length > 0) {
    const { data: created, error } = await supabase
      .from('gear_items')
      .insert(newGearRows)
      .select('id')
    if (error) throw error
    // Supabase preserves insertion order: created[i] is newGearRows[i]'s id.
    for (let i = 0; i < gearIdByRow.length; i++) {
      const qi = queueIndices[i]
      if (typeof qi !== 'number') continue
      const createdRow = created[qi]
      if (createdRow) gearIdByRow[i] = createdRow.id
    }
  }

  return { gearIdByRow, newCount: newGearRows.length, matchedCount }
}

function resolveCategoryId(rawCategory: string, catByName: Map<string, string>): string | null {
  const trimmed = rawCategory.trim()
  if (!trimmed) return null
  return catByName.get(trimmed.toLowerCase()) ?? null
}
