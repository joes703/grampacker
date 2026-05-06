// Generic CSV format primitives. Format-agnostic — knows about commas,
// quotes, newlines, and the Excel/Google Sheets formula-injection
// escape, but knows NOTHING about gear-library or list-import column
// shapes. The format-specific adapters live in ./gear and ./list.

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
