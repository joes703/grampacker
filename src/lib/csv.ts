// ── Stringify ─────────────────────────────────────────────────────────────────

function escapeCell(v: string | number | boolean | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  // Wrap in quotes if the value contains a comma, quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv(rows: Record<string, string | number | boolean | null | undefined>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
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
  const lines = splitLines(text)
  if (lines.length < 2) return []

  const headers = parseRow(lines[0]).map((h) => h.trim().toLowerCase())
  const result: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cells = parseRow(lines[i])
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
}

export function gearItemsToCsv(items: GearItem[], categories: Category[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  const rows = items.map((item) => ({
    name: item.name,
    description: item.description ?? '',
    weight_grams: item.weight_grams,
    category: item.category_id ? (catMap.get(item.category_id) ?? '') : '',
  }))
  return toCsv(rows)
}

function toGrams(value: string, unit: string): number {
  const n = parseFloat(value)
  if (isNaN(n) || n < 0) return 0
  let grams: number
  switch (unit.trim().toLowerCase()) {
    case 'oz':  grams = n * 28.3495; break
    case 'lb':  grams = n * 453.592; break
    case 'kg':  grams = n * 1000;    break
    default:    grams = n            // g or unknown — treat as grams
  }
  return Math.min(Math.round(grams), 100000)
}

// Returns parsed rows ready for import, or an error string.
// Accepts our own export format AND the Lighterpack format:
//   Item Name, Category, desc, qty, weight, unit, url, price, worn, consumable
export function parseGearCsv(text: string): GearCsvRow[] | string {
  const rows = parseCsv(text)
  if (rows.length === 0) return 'File appears empty or has no data rows.'

  const sample = rows[0]
  const keys = Object.keys(sample)

  // Resolve column names (case-insensitive, support aliases)
  const nameKey   = keys.find((k) => k === 'name' || k === 'item name')
  const weightKey = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')
  const unitKey   = keys.find((k) => k === 'unit')
  const descKey   = keys.find((k) => k === 'description' || k === 'desc')
  const catKey    = keys.find((k) => k === 'category')

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
      }
    })
    .filter((r) => r.name.length > 0)
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
  const s = (v ?? '').trim()
  return s === '1' || s.toLowerCase() === 'yes' || s.toLowerCase() === 'true'
}

// Parses a Lighterpack-style CSV into list import rows.
// Accepts: Item Name, Category, desc, qty, weight, unit, url, price, worn, consumable
// Also accepts our own list export format.
export function parseListCsv(text: string): ListImportRow[] | string {
  const rows = parseCsv(text)
  if (rows.length === 0) return 'File appears empty or has no data rows.'

  const sample = rows[0]
  const keys = Object.keys(sample)

  const nameKey     = keys.find((k) => k === 'name' || k === 'item name')
  const weightKey   = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')
  const unitKey     = keys.find((k) => k === 'unit')
  const descKey     = keys.find((k) => k === 'description' || k === 'desc')
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
      return {
        name:         (row[nameKey] ?? '').trim().slice(0, 256),
        description:  descKey ? (row[descKey] || null) : null,
        weight_grams: toGrams(row[weightKey] ?? '0', unit),
        category:     catKey ? (row[catKey] ?? '') : '',
        quantity:     isNaN(rawQty) || rawQty < 1 ? 1 : Math.min(rawQty, 99),
        is_worn:      wornKey ? toBool(row[wornKey]) : false,
        is_consumable: consumKey ? toBool(row[consumKey]) : false,
      }
    })
    .filter((r) => r.name.length > 0)
}

// ── List export helpers ───────────────────────────────────────────────────────

import type { ListItemWithGear } from './types'

export function listItemsToCsv(items: ListItemWithGear[], categories: Category[]): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  const rows = items.map((item) => ({
    name: item.gear_item?.name ?? '(deleted item)',
    description: item.gear_item?.description ?? '',
    weight_grams: item.weight_grams,
    quantity: item.quantity,
    worn: item.is_worn ? 'yes' : 'no',
    consumable: item.is_consumable ? 'yes' : 'no',
    packed: item.is_packed ? 'yes' : 'no',
    category: item.gear_item?.category_id ? (catMap.get(item.gear_item.category_id) ?? '') : '',
  }))
  return toCsv(rows)
}
