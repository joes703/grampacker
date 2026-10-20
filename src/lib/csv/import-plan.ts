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
import type { ListCsvRow } from './list'
import type { Category, GearItem } from '../types'
import {
  CATEGORY_CAP,
  GEAR_ITEM_CAP,
  LIST_ITEM_CAP,
  MAX_NAME_LENGTH,
  MAX_DESC_LENGTH,
} from '../caps'
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

// ── list import ──────────────────────────────────────────────────────────────
//
// Same planning core as the gear import, with one semantic difference: a
// row that matches an existing library item is not a skip - it becomes a
// list item REFERENCING that gear (the whole point of the dedup is to
// reuse the library, not to drop the row). The plan's three arrays map
// 1:1 onto the POST /api/lists/import request body; new gear carries a
// client-minted tempId so items can reference not-yet-created gear, same
// as gear entries reference not-yet-created categories.

export type GearRef =
  | { kind: 'existing'; id: string }
  | { kind: 'new'; tempId: string }

export type PlannedListGear = {
  tempId: string
  name: string
  description: string | null
  weightGrams: number
  category: CategoryRef | null
  // Applied only to gear this import CREATES. A row matching existing
  // library gear resolves to an existing-id reference and never reaches
  // here, so an import can never overwrite a stored price.
  cost: number | null
}

export type PlannedListItem = {
  gear: GearRef
  quantity: number
  isWorn: boolean
  isConsumable: boolean
  sortOrder: number
}

export type ListImportPlan = {
  newCategories: PlannedNewCategory[]
  newGear: PlannedListGear[]
  items: PlannedListItem[]
  // UI-only: rows that resolved to existing library gear instead of
  // creating a new item ("Items already in the library won't be
  // duplicated").
  reusedGearCount: number
}

// Compose the full list-import plan: resolve categories, then resolve each
// row to an existing gear id or a planned new gear entry, and build the
// list item for every row. Item sortOrder is the row's index in the
// name-filtered array (parseListCsv drops empty-name rows upstream, so in
// practice this is contiguous - the server accepts gaps regardless).
//
// The endpoint's referential rules hold by construction: a row whose
// category is NEW can never match existing gear (categoryRefId feeds the
// tempId into gearKey), so every planned category is referenced by at
// least one planned gear entry; every planned gear entry is referenced by
// the item planned in the same iteration. Within-CSV duplicate rows
// create separate gear entries (dedup is against the EXISTING library
// only); the same existing gear matched twice becomes two list items,
// both allowed by the endpoint.
export function planListImport(
  rows: ListCsvRow[],
  existingCategories: Category[],
  existingGearItems: GearItem[],
  genId: () => string = randomTempId,
): ListImportPlan {
  const named = rows.filter((r) => r.name.trim().length > 0)
  const { newCategories, refByLowerName } = planNewCategories(named, existingCategories, genId)

  const existingByKey = new Map<string, string>()
  for (const g of existingGearItems) {
    existingByKey.set(gearKey(g.categoryId, g.name, g.weightGrams), g.id)
  }

  const newGear: PlannedListGear[] = []
  const items: PlannedListItem[] = []
  let reusedGearCount = 0

  for (let i = 0; i < named.length; i++) {
    const row = named[i]
    if (!row) continue
    const trimmedName = row.name.trim()
    const ref = refByLowerName.get(row.categoryName.trim().toLowerCase()) ?? null
    const key = gearKey(categoryRefId(ref), trimmedName, row.weightGrams)
    const existingId = existingByKey.get(key)
    let gear: GearRef
    if (existingId) {
      reusedGearCount++
      gear = { kind: 'existing', id: existingId }
    } else {
      const tempId = genId()
      newGear.push({
        tempId,
        name: trimmedName.slice(0, MAX_NAME_LENGTH),
        description: row.description ? row.description.slice(0, MAX_DESC_LENGTH) : null,
        weightGrams: row.weightGrams,
        category: ref,
        // Only the new-gear branch carries cost. The existing branch above
        // deliberately drops row.cost on the floor: a list import must never
        // rewrite the price of gear already in the library.
        cost: row.cost,
      })
      gear = { kind: 'new', tempId }
    }
    items.push({
      gear,
      quantity: row.quantity,
      isWorn: row.isWorn,
      isConsumable: row.isConsumable,
      sortOrder: i,
    })
  }

  return { newCategories, newGear, items, reusedGearCount }
}

// The account-wide cap checks both import kinds share (both can create gear
// AND categories; the messages were a twin block kept in step by hand).
// They run BEFORE the POST so a rejected over-cap import never reaches the
// server (the DB triggers remain authoritative; this just yields a specific,
// actionable message instead of a generic limit error).
function assertAccountCaps(
  newGearCount: number,
  newCategoryCount: number,
  existingGearCount: number,
  existingCategoryCount: number,
): void {
  if (existingGearCount + newGearCount > GEAR_ITEM_CAP) {
    throw new Error(
      `This import would add ${newGearCount} new gear item${newGearCount === 1 ? '' : 's'} to your ${existingGearCount} existing, exceeding the ${GEAR_ITEM_CAP}-item inventory limit. Reduce the new entries or delete unused gear from your inventory.`,
    )
  }
  if (existingCategoryCount + newCategoryCount > CATEGORY_CAP) {
    throw new Error(
      `This import would add ${newCategoryCount} new categor${newCategoryCount === 1 ? 'y' : 'ies'} to your ${existingCategoryCount} existing, exceeding the ${CATEGORY_CAP}-category limit. Reuse existing categories or trim the file.`,
    )
  }
}

// Throws a friendly Error if the planned import would exceed the caps.
// Gear imports can create categories too, so check both account-wide bounds.
export function assertGearImportWithinCaps(
  plan: GearImportPlan,
  existingGearCount: number,
  existingCategoryCount: number,
): void {
  assertAccountCaps(
    plan.newItems.length,
    plan.newCategories.length,
    existingGearCount,
    existingCategoryCount,
  )
}

export function assertListImportWithinCaps(
  plan: ListImportPlan,
  existingGearCount: number,
  existingCategoryCount: number,
): void {
  if (plan.items.length > LIST_ITEM_CAP) {
    throw new Error(
      `A single list can hold at most ${LIST_ITEM_CAP} items; this file has ${plan.items.length}. Split it across multiple lists.`,
    )
  }
  // A list import creates gear and categories too, and the 0021 trigger caps
  // categories per USER, not per list - so the schema's per-file bound
  // (LIST_ITEM_CAP categories) is not enough once the existing library is
  // large.
  assertAccountCaps(
    plan.newGear.length,
    plan.newCategories.length,
    existingGearCount,
    existingCategoryCount,
  )
}
