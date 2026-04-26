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

// Returns parsed rows ready for import, or an error string.
export function parseGearCsv(text: string): GearCsvRow[] | string {
  const rows = parseCsv(text)
  if (rows.length === 0) return 'File appears empty or has no data rows.'

  // Accept common column name variants
  const sample = rows[0]
  const keys = Object.keys(sample)
  const hasName = keys.some((k) => k === 'name')
  const weightKey = keys.find((k) => k === 'weight_grams' || k === 'weight (g)' || k === 'weight')

  if (!hasName) return 'Missing required column: name'
  if (!weightKey) return 'Missing required column: weight_grams (or weight)'

  return rows.map((row) => {
    const rawWeight = row[weightKey] ?? '0'
    const parsed = parseInt(rawWeight, 10)
    return {
      name: row['name'] ?? '',
      description: row['description'] || null,
      weight_grams: isNaN(parsed) || parsed < 0 ? 0 : Math.min(parsed, 100000),
      category: row['category'] ?? '',
    }
  }).filter((r) => r.name.trim().length > 0)
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
