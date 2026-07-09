// Pure, cycle-free planner for CSV gear-library import.
//
// Computes which categories and gear items a parsed CSV would create,
// WITHOUT performing any writes, so it can be unit tested deterministically
// and handed straight to the import endpoint. It imports only pure modules
// (./sort-keys, ../random-temp-id, ../caps) and the GearCsvRow type; it must
// never import anything that performs I/O.
//
// Dedup semantics (reproduced from the old repo's import path):
//   - categories dedup by lowercased name, against BOTH the existing
//     library and other new categories in the same CSV;
//   - gear dedups against the EXISTING library only, by
//     gearKey(category, NFC-lowercased name, weight), so within-CSV
//     duplicates create separate gear items.
//
// TRANSPLANT NOTES (adapted from the old buildListImportPlan path):
//   - The server assigns sortOrder (max+1) and the gear id, so the plan
//     carries neither. Only NEW categories get a client-minted tempId,
//     used purely to link an item to its not-yet-created category in the
//     request body.
//   - status is server-assigned (defaults to 'active'), so planned items
//     do not carry it.
//   - The old planner also built list_items; that belongs to the list
//     slice and is not ported here.
//
// PLAN / ENDPOINT SHAPE
// ---------------------
// planGearImport returns a GearImportPlan whose two arrays map 1:1 onto the
// POST /api/gear-items/import request body:
//
//   POST /api/gear-items/import
//   {
//     categories: plan.newCategories,   // [{ tempId, name }]
//     items:      plan.newItems,        // [{ name, description, weightGrams,
//                                        //    cost, purchaseDate, category }]
//   }
//
// where each item's `category` is one of:
//   { kind: 'existing', id }   -> attach to an existing category
//   { kind: 'new', tempId }    -> attach to a category being created in the
//                                 same request (matched by tempId)
//   null                       -> uncategorized
//
// plan.skippedCount is UI-only: the number of CSV rows that already matched
// an item in the library and were therefore not re-created.

import type { GearCsvRow } from './gear'
import type { Category, GearItem } from '../types'
import { MAX_NAME_LENGTH, MAX_DESC_LENGTH } from '../caps'
import { randomTempId } from '../random-temp-id'
import { gearKey } from './sort-keys'

export type CategoryRef =
  | { kind: 'existing'; id: string }
  | { kind: 'new'; tempId: string }

export type PlannedNewCategory = { tempId: string; name: string }

export type PlannedGearItem = {
  name: string
  description: string | null
  weightGrams: number
  cost: number | null
  purchaseDate: string | null
  category: CategoryRef | null
}

export type GearImportPlan = {
  newCategories: PlannedNewCategory[]
  newItems: PlannedGearItem[]
  skippedCount: number
}

// The id a CategoryRef contributes to gearKey. Existing categories use their
// real id; a new category uses its tempId, which never collides with an
// existing gear item's categoryId, so a row in a brand-new category can
// never match an existing item (and is therefore never a skip).
function categoryRefId(ref: CategoryRef | null): string | null {
  if (!ref) return null
  return ref.kind === 'existing' ? ref.id : ref.tempId
}

// Resolve the categories referenced by the rows. Returns the NEW categories
// to create plus a lowercase-name -> ref map covering both pre-existing and
// newly-planned categories. Dedups case-insensitively against the existing
// library and against earlier new categories in the same CSV.
export function planNewCategories(
  rows: { categoryName: string }[],
  existingCategories: Category[],
  genId: () => string,
): { newCategories: PlannedNewCategory[]; refByLowerName: Map<string, CategoryRef> } {
  const refByLowerName = new Map<string, CategoryRef>(
    existingCategories.map((c) => [c.name.toLowerCase(), { kind: 'existing', id: c.id }]),
  )
  const newCategories: PlannedNewCategory[] = []
  for (const row of rows) {
    const name = row.categoryName.trim()
    if (!name) continue
    const lower = name.toLowerCase()
    if (refByLowerName.has(lower)) continue
    const tempId = genId()
    newCategories.push({ tempId, name })
    refByLowerName.set(lower, { kind: 'new', tempId })
  }
  return { newCategories, refByLowerName }
}

// Resolve each row to either a skip (it matches an existing library item) or
// a new gear item. Matches the EXISTING library only, so within-CSV
// duplicates become separate new items. Empty-name rows are ignored
// defensively (parseGearCsv already drops them upstream).
export function planGearResolution(
  rows: GearCsvRow[],
  existingGearItems: GearItem[],
  refByLowerName: Map<string, CategoryRef>,
): { newItems: PlannedGearItem[]; skippedCount: number } {
  const existingKeys = new Set<string>()
  for (const g of existingGearItems) {
    existingKeys.add(gearKey(g.categoryId, g.name, g.weightGrams))
  }

  const newItems: PlannedGearItem[] = []
  let skippedCount = 0

  for (const row of rows) {
    const trimmedName = row.name.trim()
    if (!trimmedName) continue
    const ref = refByLowerName.get(row.categoryName.trim().toLowerCase()) ?? null
    // Dedup key intentionally excludes cost/purchaseDate (display-only
    // metadata). Matching on (category, name, weight) keeps a re-import from
    // duplicating the same physical item.
    const key = gearKey(categoryRefId(ref), trimmedName, row.weightGrams)
    if (existingKeys.has(key)) {
      skippedCount++
      continue
    }
    newItems.push({
      name: trimmedName.slice(0, MAX_NAME_LENGTH),
      description: row.description ? row.description.slice(0, MAX_DESC_LENGTH) : null,
      weightGrams: row.weightGrams,
      cost: row.cost ?? null,
      purchaseDate: row.purchaseDate ?? null,
      category: ref,
    })
  }

  return { newItems, skippedCount }
}

// Compose the full gear-import plan: resolve categories, then resolve gear
// against the existing library. Every planned new category is guaranteed to
// have at least one new item referencing it: a row in a new category can
// never match an existing item (see categoryRefId), and empty-name rows
// are filtered BEFORE category planning - parseGearCsv already drops them,
// but a direct caller passing one must not plan an orphan category the
// import endpoint would reject (it 400s unreferenced tempIds).
export function planGearImport(
  rows: GearCsvRow[],
  existingCategories: Category[],
  existingGearItems: GearItem[],
  genId: () => string = randomTempId,
): GearImportPlan {
  const named = rows.filter((r) => r.name.trim().length > 0)
  const { newCategories, refByLowerName } = planNewCategories(named, existingCategories, genId)
  const { newItems, skippedCount } = planGearResolution(named, existingGearItems, refByLowerName)
  return { newCategories, newItems, skippedCount }
}
