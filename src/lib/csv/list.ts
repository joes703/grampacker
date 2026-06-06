import type { Category, ListItemWithGear } from '../types'
import { toCsv, parseCsv, MAX_CSV_ROWS } from './core'
import { toGrams } from './units'
import { MAX_LIST_ITEM_QUANTITY, MAX_NAME_LENGTH } from '../queries/caps'

export type ListImportRow = {
  name: string
  description: string | null
  weight_grams: number
  category: string
  quantity: number
  is_worn: boolean
  is_consumable: boolean
}

function toBool(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase()
  // 1/yes/true: traditional CSV boolean conventions.
  // worn/consumable: Lighterpack's literal column-value style. A
  // worn-flag column carries the string "Worn" when true and empty
  // when false; same for consumable. Recognising both literals here
  // (rather than column-aware parsing) keeps toBool a single function
  // and is harmless since no tool emits cross-column values.
  return s === '1' || s === 'yes' || s === 'true' || s === 'worn' || s === 'consumable'
}

// Parses a Lighterpack-style CSV into list import rows.
// Accepts: Item Name, Category, desc, qty, weight, unit, url, price, worn, consumable
// Also accepts our own list export format.
export function parseListCsv(text: string): ListImportRow[] | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'
  if (rows.length > MAX_CSV_ROWS) {
    return `This file has more than ${MAX_CSV_ROWS.toLocaleString('en-US')} rows, which is too many to import at once. Split it into smaller files and import them one at a time.`
  }

  const keys = Object.keys(sample)

  const nameKey     = keys.find((k) => k === 'name' || k === 'item name')
  const weightKey   = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')
  const unitKey     = keys.find((k) => k === 'unit')
  const descKey     = keys.find((k) => k === 'description' || k === 'desc' || k === 'notes')
  const catKey      = keys.find((k) => k === 'category')
  const qtyKey      = keys.find((k) => k === 'quantity' || k === 'qty')
  const wornKey     = keys.find((k) => k === 'worn' || k === 'is_worn')
  const consumKey   = keys.find((k) => k === 'consumable' || k === 'is_consumable')

  if (!nameKey)   return 'Missing required column: "name" or "Item Name"'
  if (!weightKey) return 'Missing required column: "weight_grams" or "weight"'

  return rows
    .map((row) => {
      const unit = unitKey ? (row[unitKey] ?? 'g') : 'g'
      const rawQty = qtyKey ? parseInt(row[qtyKey] ?? '1', 10) : 1
      const isWorn = wornKey ? toBool(row[wornKey]) : false
      const isConsumable = consumKey ? toBool(row[consumKey]) : false
      // worn_xor_consumable is a DB CHECK constraint; if both are truthy in
      // the CSV the insert fails with a generic error. Silently normalize
      // by clearing both. The user can re-flag the right one in the UI.
      const bothSet = isWorn && isConsumable
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, MAX_NAME_LENGTH),
        description:  descKey ? (row[descKey] || null) : null,
        weight_grams: toGrams(row[weightKey] ?? '0', unit),
        category:     catKey ? (row[catKey] ?? '') : '',
        quantity:     isNaN(rawQty) || rawQty < 1 ? 1 : Math.min(rawQty, MAX_LIST_ITEM_QUANTITY),
        is_worn:      bothSet ? false : isWorn,
        is_consumable: bothSet ? false : isConsumable,
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

// Lighterpack-compatible 10-column header (Item Name, Category, desc, qty,
// weight, unit, url, price, worn, consumable) so users can re-import a
// grampacker list export into Lighterpack and so users coming from
// Lighterpack see a familiar shape. is_packed is excluded because
// Lighterpack has no equivalent and it's per-user runtime checklist state. url and
// price are emitted as Lighterpack defaults ('' and 0) since grampacker
// doesn't store them. Boolean values use Lighterpack's "Worn" /
// "Consumable" literals (capitalized when true, empty when false). The
// import-side toBool recognizes both literals (case-insensitive) for
// round-trip parity.
export function listItemsToCsv(items: ListItemWithGear[], categories: Category[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  const rows = items.map((item) => ({
    'Item Name': item.gear_item.name,
    Category: item.gear_item.category_id ? (catMap.get(item.gear_item.category_id) ?? '') : '',
    desc: item.gear_item.description ?? '',
    qty: item.quantity,
    weight: item.gear_item.weight_grams,
    unit: 'gram',
    url: '',
    price: 0,
    worn: item.is_worn ? 'Worn' : '',
    consumable: item.is_consumable ? 'Consumable' : '',
  }))
  return toCsv(rows)
}
