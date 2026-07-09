// Generic CSV format primitives. Format-agnostic: knows about commas,
// quotes, newlines, and the Excel/Google Sheets formula-injection
// escape, but knows NOTHING about gear-library or list-import column
// shapes. The format-specific adapters live in ./gear and ./list.

// Hard cap on parsed DATA rows (header excluded; blank rows are already
// dropped by parseCsv). Bounds both the in-memory parsed array and the
// import preview tables, which render one DOM node per row with no
// virtualization. The 2 MB byte cap in use-csv-file-input can still hold
// far more rows than any realistic gear library or packing list, so this
// rejects pathological inputs before they jank the tab. Sits well above
// the DB per-user caps (500 gear items, 300 list items/list) so it never
// blocks a legitimate import; it's a DoS/DOM bound, not a business rule.
export const MAX_CSV_ROWS = 2000

function escapeCell(v: string | number | boolean | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v)
  // Formula-injection neutralization. Excel, Google Sheets, and Numbers
  // evaluate cells whose first character is =, +, -, @, tab, or CR as a
  // formula. A leading single apostrophe is the standard "treat as text"
  // escape: it strips on display in those tools and is not interpreted
  // as part of the cell value. Applied uniformly at the cell-writer
  // layer so every export path inherits it.
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
  // Wrap in quotes if the value contains a comma, quote, or any
  // newline character. Bare \r must be quoted alongside \n now that
  // parseCsv's single-pass state machine treats a lone \r as a row
  // break (it consumes \r\n as one terminator, but a standalone \r is
  // still a break). Without this, toCsv({ note: 'a\rb' }) emits an
  // unquoted CR that parseCsv reads as a second row.
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`
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
//
// Single-pass state machine. The prior implementation split the input
// into lines first, then parsed each line into cells with a separate
// state machine; the two passes both had to agree on quote semantics
// and `splitLines` didn't recognize the `""` escape as an escape (it
// just toggled inQuote on every `"` and relied on the toggles netting
// out). That worked for well-formed input but kept two implementations
// in lockstep, with no enforcement of the invariant. Folding the
// passes into one state machine collapses the duplication: cells emit
// on `,` and rows emit on `\n` / `\r\n` only when outside a quoted
// field, and `""` inside a quoted field is the literal `"` per RFC.
export function parseCsv(text: string): Record<string, string>[] {
  // Strip a leading UTF-8 BOM (U+FEFF). Excel, Numbers, and many
  // Windows tools prefix UTF-8 CSV exports with a BOM; without this
  // the first header cell becomes "﻿item name" and misses every
  // case-insensitive alias lookup downstream.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.length === 0) return []

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuote = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // RFC-4180 escape: doubled quote inside a quoted field is one literal quote.
          cell += '"'
          i++
        } else {
          // Field-closing quote.
          inQuote = false
        }
      } else {
        cell += ch
      }
    } else {
      if (ch === '"') {
        inQuote = true
      } else if (ch === ',') {
        row.push(cell)
        cell = ''
      } else if (ch === '\n' || ch === '\r') {
        row.push(cell)
        rows.push(row)
        row = []
        cell = ''
        if (ch === '\r' && text[i + 1] === '\n') i++
      } else {
        cell += ch
      }
    }
  }
  // Flush the trailing cell/row. A file that ends without a terminating
  // newline still yields its final row; an empty trailing line (the
  // input ended in \n) leaves cell='' and row=[] so we skip pushing.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  const [headerRow, ...dataRows] = rows
  if (!headerRow || dataRows.length === 0) return []
  const headers = headerRow.map((h) => h.trim().toLowerCase())

  const result: Record<string, string>[] = []
  for (const cells of dataRows) {
    // Skip a row that's structurally blank (all cells trim to '').
    // Matches the prior parser's "skip blank data lines" behavior so a
    // trailing newline or a stray empty line between rows doesn't insert
    // an empty record.
    if (cells.every((c) => c.trim() === '')) continue
    const r: Record<string, string> = {}
    headers.forEach((h, j) => {
      r[h] = (cells[j] ?? '').trim()
    })
    result.push(r)
  }

  return result
}
