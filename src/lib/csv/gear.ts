import type { GearItem, Category } from '../types'
import { toCsv } from './core'
import { commonRowFields, parseCsvWithCommonColumns } from './parse-common'
import { isoDateSchema } from '../../../shared/gear'

// Parse output. The CSV column HEADERS stay snake_case (Lighterpack-shaped),
// but the parsed TS row is camelCase because every consumer speaks camelCase.
// categoryName is the category's display name; the import planner resolves
// it to an existing id or a new category.
export type GearCsvRow = {
  name: string
  description: string | null
  weightGrams: number
  categoryName: string
  cost: number | null
  purchaseDate: string | null
}

export function gearItemsToCsv(items: GearItem[], categories: Category[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  // Lighterpack-shaped so a grampacker export re-imports there without
  // manual header massaging. The gear library has no list-item context (no
  // quantity / worn / consumable), so those take Lighterpack defaults:
  // qty=1, worn/consumable empty. url is empty since grampacker doesn't
  // store it. cost and purchase_date are grampacker extension columns;
  // Lighterpack ignores columns it doesn't know. Both blank for null,
  // never 0 or epoch - "unknown" must not render as "free".
  //
  // COLUMN ORDER 0-5 IS A COMPATIBILITY CONTRACT, not cosmetic. Lighterpack's
  // importer is POSITIONAL and reads exactly row[0..5]:
  //   name: row[0], category: row[1], description: row[2],
  //   qty: row[3], weight: row[4], unit: row[5]
  // (client/components/import-csv.vue upstream). Reordering these six breaks
  // Lighterpack import silently - the file still loads, with wrong fields.
  // gear.test.ts pins them by position.
  //
  // There is deliberately ONE money column. Do not add a `price` column
  // hardcoded to 0 as a "Lighterpack default": Lighterpack never reads a
  // price column at all (see the positional list above), so it would carry
  // no interoperability and only mislead people and spreadsheets reading the
  // file. Prices cannot be carried INTO Lighterpack by any column choice;
  // that is a limitation of its importer, not ours.
  const rows = items.map((item) => ({
    'Item Name': item.name,
    Category: item.categoryId ? (catMap.get(item.categoryId) ?? '') : '',
    desc: item.description ?? '',
    qty: 1,
    weight: item.weightGrams,
    unit: 'gram',
    url: '',
    worn: '',
    consumable: '',
    cost: item.cost ?? '',
    purchase_date: item.purchaseDate ?? '',
  }))
  return toCsv(rows)
}

// Returns parsed rows ready for import, or an error string.
// Accepts our own export format AND the Lighterpack format:
//   Item Name, Category, desc, qty, weight, unit, url, price, worn, consumable
// The shared preamble (size gate, column resolution incl. the load-bearing
// cost-over-price precedence) lives in parse-common.ts.
export function parseGearCsv(text: string): GearCsvRow[] | string {
  const parsed = parseCsvWithCommonColumns(text)
  if (typeof parsed === 'string') return parsed
  const { rows, cols } = parsed
  const dateKey = cols.keys.find((k) => k === 'purchase_date' || k === 'purchase date')

  return rows
    .map((row) => ({
      ...commonRowFields(row, cols),
      purchaseDate: dateKey ? parseIsoDate(row[dateKey]) : null,
    }))
    .filter((r) => r.name.length > 0)
}

// Strict ISO YYYY-MM-DD; anything else (or empty) is null. We deliberately
// don't accept locale formats: silent ambiguity (07/04/2024 = July 4 or
// April 7?) is worse than rejecting. Users can re-format their CSV.
//
// A regex alone is not enough: only REAL calendar dates survive
// (2026-02-30 drops to null). The import DTO's isoDateSchema
// (shared/gear.ts) re-validates with the same round-trip check, and one
// impossible date would 400 the entire atomic import.
function parseIsoDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  return isoDateSchema.safeParse(s).success ? s : null
}
