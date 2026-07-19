import type { Category, ListItemWithGear } from '../types'
import { toCsv, parseCsv, MAX_CSV_ROWS } from './core'
import { parseCostFromColumn } from './money'
import { toGrams } from './units'
import { MAX_LIST_ITEM_QUANTITY, MAX_NAME_LENGTH } from '../caps'

// Parse output. The CSV column HEADERS keep the Lighterpack shape
// (byte-identical to the old repo's export), but the parsed TS row is
// camelCase because every new-repo consumer speaks camelCase.
// categoryName is the category's display name; the import planner
// resolves it to an existing id or a new category.
export type ListCsvRow = {
  name: string
  description: string | null
  weightGrams: number
  categoryName: string
  quantity: number
  isWorn: boolean
  isConsumable: boolean
  // Cost of the gear item this row will create. Only ever applied to NEWLY
  // created gear - a row matching an item already in the library leaves that
  // item's stored cost untouched (see planListImport).
  cost: number | null
}

function toBool(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase()
  // 1/yes/true: traditional CSV boolean conventions.
  // worn/consumable: Lighterpack's literal column-value style. A
  // worn-flag column carries the string "Worn" when true and empty
  // when false; same for consumable. Recognizing both literals here
  // (rather than column-aware parsing) keeps toBool a single function
  // and is harmless since no tool emits cross-column values.
  return s === '1' || s === 'yes' || s === 'true' || s === 'worn' || s === 'consumable'
}

// Parses a Lighterpack-style CSV into list import rows.
// Accepts: Item Name, Category, desc, qty, weight, unit, url, price, worn, consumable
// Also accepts our own list export format.
export function parseListCsv(text: string): ListCsvRow[] | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'
  if (rows.length > MAX_CSV_ROWS) {
    return `This file has more than ${MAX_CSV_ROWS.toLocaleString('en-US')} rows, which is too many to import at once. Split it into smaller files and import them one at a time.`
  }

  const keys = Object.keys(sample)

  const nameKey   = keys.find((k) => k === 'name' || k === 'item name')
  const weightKey = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')
  const unitKey   = keys.find((k) => k === 'unit')
  const descKey   = keys.find((k) => k === 'description' || k === 'desc' || k === 'notes')
  const catKey    = keys.find((k) => k === 'category')
  const qtyKey    = keys.find((k) => k === 'quantity' || k === 'qty')
  const wornKey   = keys.find((k) => k === 'worn' || k === 'is_worn')
  const consumKey = keys.find((k) => k === 'consumable' || k === 'is_consumable')
  // Same two-pass precedence as the gear importer: our own `cost` wins over
  // Lighterpack's `price`, and column order in the source file is irrelevant.
  // WHICH column won also decides how a 0 reads - 0 in `cost` is genuinely
  // free, 0 in `price` is unset (see parseCostFromColumn). That matters most
  // here: list exports downloaded before this change hardcoded price=0 on
  // EVERY row, so reading those as real would import a whole list as free.
  const ownCostKey = keys.find((k) => k === 'cost')
  const costKey   = ownCostKey ?? keys.find((k) => k === 'price')
  const costKind  = ownCostKey ? 'cost' as const : 'price' as const

  if (!nameKey)   return 'Missing required column: "name" or "Item Name"'
  if (!weightKey) return 'Missing required column: "weight_grams" or "weight"'

  return rows
    .map((row) => {
      const unit = unitKey ? (row[unitKey] ?? 'g') : 'g'
      const rawQty = qtyKey ? parseInt(row[qtyKey] ?? '1', 10) : 1
      const isWorn = wornKey ? toBool(row[wornKey]) : false
      const isConsumable = consumKey ? toBool(row[consumKey]) : false
      // worn/consumable exclusivity is a DB CHECK constraint; if both are
      // truthy in the CSV the import fails with a generic error. Silently
      // normalize by clearing both. The user can re-flag the right one in
      // the UI.
      const bothSet = isWorn && isConsumable
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, MAX_NAME_LENGTH),
        description:  descKey ? (row[descKey] || null) : null,
        weightGrams:  toGrams(row[weightKey] ?? '0', unit),
        categoryName: catKey ? (row[catKey] ?? '') : '',
        quantity:     isNaN(rawQty) || rawQty < 1 ? 1 : Math.min(rawQty, MAX_LIST_ITEM_QUANTITY),
        isWorn:       bothSet ? false : isWorn,
        isConsumable: bothSet ? false : isConsumable,
        cost:         costKey ? parseCostFromColumn(row[costKey], costKind) : null,
      }
    })
    .filter((r) => r.name.length > 0)
}

// Strip the .csv extension and any path prefix from a filename, fall back
// to a generic label if the result is empty. Used to derive a default
// list name when importing a CSV into a brand-new list.
export function nameFromCsvFilename(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, '').replace(/\.csv$/i, '').trim()
  return base || 'Imported list'
}

// Lighterpack-shaped 10-column header (Item Name, Category, desc, qty,
// weight, unit, url, cost, worn, consumable) so users can re-import a
// grampacker list export into Lighterpack and so users coming from
// Lighterpack see a familiar shape. is_packed/is_ready are excluded
// because Lighterpack has no equivalent and they are per-user runtime
// checklist state. url stays empty since grampacker doesn't store it.
// Boolean values use Lighterpack's "Worn" / "Consumable" literals
// (capitalized when true, empty when false). The import-side toBool
// recognizes both literals (case-insensitive) for round-trip parity.
//
// COLUMN ORDER 0-5 IS A COMPATIBILITY CONTRACT, not cosmetic. Lighterpack's
// importer is POSITIONAL and reads exactly row[0..5]:
//   name: row[0], category: row[1], description: row[2],
//   qty: row[3], weight: row[4], unit: row[5]
// (client/components/import-csv.vue upstream). Reordering these six does not
// fail an import - it succeeds with the wrong fields. list.test.ts pins them
// by position.
//
// Column 7 carries the REAL cost of the underlying gear item. It used to be
// `price` hardcoded to 0 - a fabricated value that made every exported list
// look like it cost nothing. A list item has no price of its own; the gear
// item it points at does, which is the value emitted here. Blank for null,
// never 0: "unknown" must not render as "free".
export function listItemsToCsv(items: ListItemWithGear[], categories: Category[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  const rows = items.map((item) => ({
    'Item Name': item.gearItem.name,
    Category: item.gearItem.categoryId ? (catMap.get(item.gearItem.categoryId) ?? '') : '',
    desc: item.gearItem.description ?? '',
    qty: item.quantity,
    weight: item.gearItem.weightGrams,
    unit: 'gram',
    url: '',
    cost: item.gearItem.cost ?? '',
    worn: item.isWorn ? 'Worn' : '',
    consumable: item.isConsumable ? 'Consumable' : '',
  }))
  return toCsv(rows)
}
