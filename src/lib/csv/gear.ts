import type { GearItem, Category } from '../types'
import { toCsv, parseCsv, MAX_CSV_ROWS } from './core'
import { parseCostFromColumn } from './money'
import { toGrams } from './units'
import { MAX_NAME_LENGTH } from '../caps'

// Parse output. The CSV column HEADERS stay snake_case (Lighterpack-shaped;
// no longer byte-identical to the old repo's export, which carried a second
// money column), but the parsed TS row is camelCase because every new-repo
// consumer speaks camelCase.
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
  // There is deliberately ONE money column. This used to emit a second,
  // `price`, hardcoded to 0 as a "Lighterpack default" - but Lighterpack
  // never reads a price column at all (see the positional list above), so
  // that column carried no interoperability and only misled humans and
  // spreadsheets reading the file. Prices cannot be carried INTO Lighterpack
  // by any column choice; that is a limitation of its importer, not ours.
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
export function parseGearCsv(text: string): GearCsvRow[] | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'
  if (rows.length > MAX_CSV_ROWS) {
    return `This file has more than ${MAX_CSV_ROWS.toLocaleString('en-US')} rows, which is too many to import at once. Split it into smaller files and import them one at a time.`
  }

  const keys = Object.keys(sample)

  // Resolve column names (case-insensitive, support aliases)
  const nameKey   = keys.find((k) => k === 'name' || k === 'item name')
  const weightKey = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')
  const unitKey   = keys.find((k) => k === 'unit')
  const descKey   = keys.find((k) => k === 'description' || k === 'desc' || k === 'notes')
  const catKey    = keys.find((k) => k === 'category')
  // cost: prefer our column name; fall back to Lighterpack's "price" so a
  // Lighterpack export imports its prices directly. Two-pass lookup (not
  // a single find with OR) so column order in the source CSV doesn't
  // matter.
  //
  // The precedence is load-bearing for BACKWARD COMPATIBILITY: exports
  // downloaded before the columns were collapsed carry price=0 alongside
  // the real cost=N, so cost must win or re-importing one of those older
  // files would read the fake 0 and wipe every price. Current exports emit
  // cost alone.
  //
  // WHICH column won also decides how a 0 reads: 0 in `cost` is genuinely
  // free, 0 in `price` is unset (see parseCostFromColumn).
  const ownCostKey = keys.find((k) => k === 'cost')
  const costKey   = ownCostKey ?? keys.find((k) => k === 'price')
  const costKind  = ownCostKey ? 'cost' as const : 'price' as const
  const dateKey   = keys.find((k) => k === 'purchase_date' || k === 'purchase date')

  if (!nameKey)   return 'Missing required column: "name" or "Item Name"'
  if (!weightKey) return 'Missing required column: "weight_grams" or "weight"'

  return rows
    .map((row) => {
      const unit = unitKey ? (row[unitKey] ?? 'g') : 'g'
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, MAX_NAME_LENGTH),
        description:  descKey ? (row[descKey] || null) : null,
        weightGrams:  toGrams(row[weightKey] ?? '0', unit),
        categoryName: catKey ? (row[catKey] ?? '') : '',
        cost:         costKey ? parseCostFromColumn(row[costKey], costKind) : null,
        purchaseDate: dateKey ? parseIsoDate(row[dateKey]) : null,
      }
    })
    .filter((r) => r.name.length > 0)
}

// Strict ISO YYYY-MM-DD; anything else (or empty) is null. We deliberately
// don't accept locale formats: silent ambiguity (07/04/2024 = July 4 or
// April 7?) is worse than rejecting. Users can re-format their CSV.
//
// Tightened over the old repo's regex-only check: only REAL calendar
// dates survive (2026-02-30 drops to null). The import DTO's
// isoDateSchema (shared/gear.ts) re-validates with the same round-trip
// check, and one impossible date would 400 the entire atomic import.
function parseIsoDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  return s
}
