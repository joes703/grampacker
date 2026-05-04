import { supabase } from '../supabase'
import type { Category, GearItem } from '../types'
import { createCategory } from './categories'

// Shared CSV-import helpers used by both list-import (importCsvRowsToList)
// and gear-only-import (importGearItems). The two paths differ only in
// whether they go on to insert list_items afterwards; gear resolution and
// dedup are identical.

// Composite dedup key: a CSV row matches an existing gear item when its
// category + lowercase name + weight all agree. Same shape used to seed the
// existing-gear map and to look up each row.
export function gearKey(categoryId: string | null, name: string, weight_grams: number): string {
  return `${categoryId ?? ''}:${name.trim().toLowerCase()}:${weight_grams}`
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
  for (const name of uniqueCatNames) {
    if (!catByName.has(name.toLowerCase())) {
      const created = await createCategory(userId, name, existingCategories.length + catByName.size)
      catByName.set(name.toLowerCase(), created.id)
    }
  }
  return catByName
}

// Resolve each CSV row to a gear_id, creating new gear items as needed.
// Match policy:
//   - Match against existing library only — newly-created gear within this
//     import is NOT considered a match candidate for later rows (within-CSV
//     duplicates create separate gear items, matching user typing intent).
//   - Match key is gearKey(category_id, name, weight_grams) — exact triple.
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
    // Dedup key intentionally excludes cost/purchase_date — they're
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
