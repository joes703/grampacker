import type { GearItem, Category } from '../types'
import { toCsv, parseCsv, MAX_CSV_ROWS } from './core'
import { toGrams } from './units'
import { MAX_NAME_LENGTH } from '../caps'

export type GearCsvRow = {
  name: string
  description: string | null
  weight_grams: number
  category: string
  cost: number | null
  purchase_date: string | null
}

export function gearItemsToCsv(items: GearItem[], categories: Category[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  // Lighterpack-compatible base 10 columns so users can re-import a
  // grampacker gear-library export into Lighterpack without manual header
  // massaging (Lighterpack ignores unknown columns). The gear library has
  // no list-item context (no quantity / worn / consumable), so those get
  // Lighterpack defaults: qty=1, worn/consumable empty. url is empty
  // since grampacker doesn't store it; price stays at the Lighterpack
  // default 0 (its own field, not aliased to cost). cost and
  // purchase_date are grampacker-specific extension columns appended
  // after the Lighterpack 10; Lighterpack ignores them on its import.
  // Both blank for null, never 0 or epoch.
  const rows = items.map((item) => ({
    'Item Name': item.name,
    Category: item.category_id ? (catMap.get(item.category_id) ?? '') : '',
    desc: item.description ?? '',
    qty: 1,
    weight: item.weight_grams,
    unit: 'gram',
    url: '',
    price: 0,
    worn: '',
    consumable: '',
    cost: item.cost ?? '',
    purchase_date: item.purchase_date ?? '',
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
  // matter. Our own export has price=0 and cost=N side by side, and the
  // user-set cost must always win over the Lighterpack-default price.
  const costKey   = keys.find((k) => k === 'cost') ?? keys.find((k) => k === 'price')
  const dateKey   = keys.find((k) => k === 'purchase_date' || k === 'purchase date')

  if (!nameKey)   return 'Missing required column: "name" or "Item Name"'
  if (!weightKey) return 'Missing required column: "weight_grams" or "weight"'

  return rows
    .map((row) => {
      const unit = unitKey ? (row[unitKey] ?? 'g') : 'g'
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, MAX_NAME_LENGTH),
        description:  descKey ? (row[descKey] || null) : null,
        weight_grams: toGrams(row[weightKey] ?? '0', unit),
        category:     catKey ? (row[catKey] ?? '') : '',
        cost:         costKey ? parseCost(row[costKey]) : null,
        purchase_date: dateKey ? parseIsoDate(row[dateKey]) : null,
      }
    })
    .filter((r) => r.name.length > 0)
}

// Empty/whitespace cells become null (gifts and unknown values stay
// unknown, never coerced to 0). Negative or unparseable inputs also
// drop to null rather than corrupting the row.
function parseCost(raw: string | undefined): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  // Round to cents; numeric(10,2) in the DB rejects extra precision.
  // Cap at the column's max (99,999,999.99); without this, an over-cap
  // row would abort the entire bulk INSERT with Postgres 22003
  // numeric_value_out_of_range, taking the whole batch with it.
  return Math.min(Math.round(n * 100) / 100, 99_999_999.99)
}

// Strict ISO YYYY-MM-DD; anything else (or empty) is null. We deliberately
// don't accept locale formats: silent ambiguity (07/04/2024 = July 4 or
// April 7?) is worse than rejecting. Users can re-format their CSV.
function parseIsoDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}
