import type { Category, ListItemWithGear } from '../types'
import { toCsv } from './core'
import { commonRowFields, parseCsvWithCommonColumns } from './parse-common'
import { MAX_LIST_ITEM_QUANTITY } from '../caps'

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
// Also accepts our own list export format. The shared preamble (size gate,
// column resolution incl. the load-bearing cost-over-price precedence)
// lives in parse-common.ts.
export function parseListCsv(text: string): ListCsvRow[] | string {
  const parsed = parseCsvWithCommonColumns(text)
  if (typeof parsed === 'string') return parsed
  const { rows, cols } = parsed
  const qtyKey    = cols.keys.find((k) => k === 'quantity' || k === 'qty')
  const wornKey   = cols.keys.find((k) => k === 'worn' || k === 'is_worn')
  const consumKey = cols.keys.find((k) => k === 'consumable' || k === 'is_consumable')

  return rows
    .map((row) => {
      const rawQty = qtyKey ? parseInt(row[qtyKey] ?? '1', 10) : 1
      const isWorn = wornKey ? toBool(row[wornKey]) : false
      const isConsumable = consumKey ? toBool(row[consumKey]) : false
      // worn/consumable exclusivity is a DB CHECK constraint; if both are
      // truthy in the CSV the import fails with a generic error. Silently
      // normalize by clearing both. The user can re-flag the right one in
      // the UI.
      const bothSet = isWorn && isConsumable
      return {
        ...commonRowFields(row, cols),
        quantity:     isNaN(rawQty) || rawQty < 1 ? 1 : Math.min(rawQty, MAX_LIST_ITEM_QUANTITY),
        isWorn:       bothSet ? false : isWorn,
        isConsumable: bothSet ? false : isConsumable,
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
