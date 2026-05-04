// ── Stringify ─────────────────────────────────────────────────────────────────

function escapeCell(v: string | number | boolean | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v)
  // Formula-injection neutralization. Excel, Google Sheets, and Numbers
  // evaluate cells whose first character is =, +, -, @, tab, or CR as a
  // formula. A leading single apostrophe is the standard "treat as text"
  // escape — strips on display in those tools, not interpreted as part of
  // the cell value. Applied uniformly at the cell-writer layer so every
  // export path inherits it.
  //
  // We deliberately don't strip leading apostrophes on the import side
  // (parseCsv): third-party tools like Lighterpack may emit them
  // legitimately, and stripping would mangle those imports. The user's
  // own export → import round-trip preserves the apostrophe; that's
  // acceptable since names starting with =/+/-/@ are exotic enough that
  // round-trip purity isn't worth the data-mangling risk on third-party
  // CSVs.
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`
  }
  // Wrap in quotes if the value contains a comma, quote, or newline.
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv(rows: Record<string, string | number | boolean | null | undefined>[]): string {
  const [first, ...rest] = rows
  if (!first) return ''
  const headers = Object.keys(first)
  const lines = [
    headers.map(escapeCell).join(','),
    ...[first, ...rest].map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ]
  return lines.join('\r\n')
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Parse ─────────────────────────────────────────────────────────────────────

// Minimal RFC-4180-compliant CSV parser (no external dependency).
export function parseCsv(text: string): Record<string, string>[] {
  const [headerLine, ...dataLines] = splitLines(text)
  if (!headerLine || dataLines.length === 0) return []

  const headers = parseRow(headerLine).map((h) => h.trim().toLowerCase())
  const result: Record<string, string>[] = []

  for (const line of dataLines) {
    if (!line.trim()) continue
    const cells = parseRow(line)
    const row: Record<string, string> = {}
    headers.forEach((h, j) => {
      row[h] = (cells[j] ?? '').trim()
    })
    result.push(row)
  }

  return result
}

function splitLines(text: string): string[] {
  // Split on \r\n or \n, but not inside quoted fields
  const lines: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inQuote = !inQuote
      cur += ch
    } else if (!inQuote && (ch === '\n' || (ch === '\r' && text[i + 1] === '\n'))) {
      lines.push(cur)
      cur = ''
      if (ch === '\r') i++ // skip \n after \r
    } else {
      cur += ch
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function parseRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuote = false
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') {
        inQuote = true
      } else if (ch === ',') {
        cells.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
  }
  cells.push(cur)
  return cells
}

// ── Gear library helpers ──────────────────────────────────────────────────────

import type { GearItem, Category } from './types'

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
  // massaging — Lighterpack ignores unknown columns. The gear library has
  // no list-item context (no quantity / worn / consumable), so those get
  // Lighterpack defaults: qty=1, worn/consumable empty. url is empty
  // since grampacker doesn't store it; price stays at the Lighterpack
  // default 0 (its own field, not aliased to cost). cost and
  // purchase_date are grampacker-specific extension columns appended
  // after the Lighterpack 10; Lighterpack ignores them on its import.
  // Both blank for null — never 0 or epoch.
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

function toGrams(value: string, unit: string): number {
  const n = parseFloat(value)
  if (isNaN(n) || n < 0) return 0
  let grams: number
  switch (unit.trim().toLowerCase()) {
    case 'oz':
    case 'ounce':
    case 'ounces':
      grams = n * 28.3495
      break
    case 'lb':
    case 'pound':
    case 'pounds':
      grams = n * 453.592
      break
    case 'kg':
    case 'kilogram':
    case 'kilograms':
      grams = n * 1000
      break
    case '':
    case 'g':
    case 'gram':
    case 'grams':
    default:
      // Empty + g/gram/grams take the default; unknown units (typos
      // etc.) also default to grams as the most-tolerant fallback —
      // matches the previous behavior, just with the happy path now
      // explicit instead of hidden under `default`.
      grams = n
  }
  return Math.min(Math.round(grams), 100000)
}

// Returns parsed rows ready for import, or an error string.
// Accepts our own export format AND the Lighterpack format:
//   Item Name, Category, desc, qty, weight, unit, url, price, worn, consumable
export function parseGearCsv(text: string): GearCsvRow[] | string {
  const rows = parseCsv(text)
  const [sample] = rows
  if (!sample) return 'File appears empty or has no data rows.'

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
  // matter — our own export has price=0 and cost=N side by side, and the
  // user-set cost must always win over the Lighterpack-default price.
  const costKey   = keys.find((k) => k === 'cost') ?? keys.find((k) => k === 'price')
  const dateKey   = keys.find((k) => k === 'purchase_date' || k === 'purchase date')

  if (!nameKey)   return 'Missing required column: "name" or "Item Name"'
  if (!weightKey) return 'Missing required column: "weight_grams" or "weight"'

  return rows
    .map((row) => {
      const unit = unitKey ? (row[unitKey] ?? 'g') : 'g'
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, 256),
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
// unknown — never coerced to 0). Negative or unparseable inputs also
// drop to null rather than corrupting the row.
function parseCost(raw: string | undefined): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const n = parseFloat(s)
  if (!isFinite(n) || n < 0) return null
  // Round to cents — numeric(10,2) in the DB rejects extra precision.
  return Math.round(n * 100) / 100
}

// Strict ISO YYYY-MM-DD; anything else (or empty) is null. We deliberately
// don't accept locale formats — silent ambiguity (07/04/2024 = July 4 or
// April 7?) is worse than rejecting. Users can re-format their CSV.
function parseIsoDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

// ── List import helpers ───────────────────────────────────────────────────────

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
  // worn/consumable: Lighterpack's literal column-value style — a
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
      // by clearing both — the user can re-flag the right one in the UI.
      const bothSet = isWorn && isConsumable
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, 256),
        description:  descKey ? (row[descKey] || null) : null,
        weight_grams: toGrams(row[weightKey] ?? '0', unit),
        category:     catKey ? (row[catKey] ?? '') : '',
        quantity:     isNaN(rawQty) || rawQty < 1 ? 1 : Math.min(rawQty, 9999),
        is_worn:      bothSet ? false : isWorn,
        is_consumable: bothSet ? false : isConsumable,
      }
    })
    .filter((r) => r.name.length > 0)
}

// ── List export helpers ───────────────────────────────────────────────────────

import type { ListItemWithGear } from './types'

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
// Lighterpack see a familiar shape. is_packed is excluded — Lighterpack
// has no equivalent and it's per-user runtime checklist state. url and
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
