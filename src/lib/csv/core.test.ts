import { describe, it, expect } from 'vitest'
import { parseCsv, toCsv } from './core'

describe('parseCsv', () => {
  it('parses a basic CSV with a header and two data rows', () => {
    // No final newline, as in some hand-edited CSVs and tool exports: the
    // last row must still be emitted.
    const csv = 'name,weight\nTent,1300\nStakes,80'
    expect(parseCsv(csv)).toEqual([
      { name: 'Tent', weight: '1300' },
      { name: 'Stakes', weight: '80' },
    ])
  })

  it('lowercases and trims header names', () => {
    const csv = '  Name  ,  Weight  \nTent,1300'
    expect(parseCsv(csv)).toEqual([{ name: 'Tent', weight: '1300' }])
  })

  it('strips a leading UTF-8 BOM so Excel/Numbers exports parse correctly', () => {
    // Excel on Windows and Numbers prefix UTF-8 CSV exports with U+FEFF.
    // Left on the first header, it would make alias lookups (parseGearCsv,
    // parseListCsv) silently miss the column. parseCsv strips it, and the
    // header trim also removes it, so this test fails only if both go.
    const csv = '﻿name,weight\nTent,1300'
    expect(parseCsv(csv)).toEqual([{ name: 'Tent', weight: '1300' }])
  })

  it('handles CRLF line endings (Windows / Excel default)', () => {
    const csv = 'name,weight\r\nTent,1300\r\nStakes,80'
    expect(parseCsv(csv)).toEqual([
      { name: 'Tent', weight: '1300' },
      { name: 'Stakes', weight: '80' },
    ])
  })

  it('returns [] for an empty input', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('returns [] when there is a header but no data rows', () => {
    expect(parseCsv('name,weight')).toEqual([])
  })

  it('skips blank data lines without inserting empty rows', () => {
    const csv = 'name,weight\nTent,1300\n\nStakes,80'
    expect(parseCsv(csv)).toEqual([
      { name: 'Tent', weight: '1300' },
      { name: 'Stakes', weight: '80' },
    ])
  })

  it('parses quoted fields containing commas', () => {
    const csv = 'name,description\nTent,"sleeps 2, vestibule"'
    expect(parseCsv(csv)).toEqual([
      { name: 'Tent', description: 'sleeps 2, vestibule' },
    ])
  })

  it('parses a quoted field with escaped quotes AND an embedded newline (regression)', () => {
    // A parser that splits the input into lines BEFORE parsing cells, or
    // does not read `""` as an escape, shreds a row carrying both an
    // embedded newline and a doubled-quote escape into two corrupt rows.
    const csv = 'name,description\nTent,"He said ""hello\nworld"""'
    expect(parseCsv(csv)).toEqual([
      { name: 'Tent', description: 'He said "hello\nworld"' },
    ])
  })

  it('parses CRLF inside a quoted field as a literal CRLF, not a row break', () => {
    const csv = 'name,description\nTent,"line one\r\nline two"\r\nStakes,80'
    expect(parseCsv(csv)).toEqual([
      { name: 'Tent', description: 'line one\r\nline two' },
      { name: 'Stakes', description: '80' },
    ])
  })

  it('round-trips a value containing comma, quote, and newline through toCsv -> parseCsv', () => {
    const original = { name: 'Tent', description: 'sleeps 2,\nuses "DAC" poles' }
    const csv = toCsv([original])
    expect(parseCsv(csv)).toEqual([original])
  })

  it('round-trips a value containing a bare carriage return', () => {
    // parseCsv treats a lone \r as a row break; toCsv must quote any
    // cell containing one so the round-trip doesn't split the value
    // across two rows.
    const original = { name: 'Note', body: 'before\rafter' }
    const csv = toCsv([original])
    expect(parseCsv(csv)).toEqual([original])
  })
})

describe('toCsv formula-injection escaping', () => {
  // SECURITY: Excel, Google Sheets, and Numbers evaluate a cell whose
  // first character is one of = + - @ \t \r as a formula. escapeCell
  // neutralizes this by prepending a single apostrophe ("treat as
  // text"). These tests pin the guard char-by-char so a regression in
  // the /^[=+\-@\t\r]/ regex (a one-char edit, e.g. dropping a metachar)
  // fails loudly instead of silently re-opening the injection vector.

  // The header is the first '\r\n'-delimited line; the data row follows.
  const dataRow = (csv: string) => csv.split('\r\n')[1]

  it.each([
    ['equals', '=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['plus', '+1+1', "'+1+1"],
    ['minus', '-2+3', "'-2+3"],
    // A negative number serialized as a string is still read as a formula.
    ['numeric minus', '-5', "'-5"],
    ['at', '@SUM(1)', "'@SUM(1)"],
  ])('prefixes a leading %s with an apostrophe', (_label, input, expected) => {
    expect(dataRow(toCsv([{ name: input }]))).toBe(expected)
  })

  it('prefixes a leading tab without additional quoting (tab is not comma/quote/newline)', () => {
    // A leading \t triggers the apostrophe prefix. The cell does not
    // contain a comma/quote/newline, so it is NOT additionally quoted.
    expect(dataRow(toCsv([{ name: '\tcmd' }]))).toBe("'\tcmd")
  })

  it('prefixes a leading carriage return AND quotes the cell (bare \\r forces quoting)', () => {
    // A leading \r triggers the apostrophe prefix; the cell then
    // contains a \r, so escapeCell also wraps it in quotes.
    expect(dataRow(toCsv([{ name: '\rcmd' }]))).toBe('"\'\rcmd"')
  })

  it('does NOT escape a dangerous char that is not in the leading position', () => {
    // Only the first character matters to spreadsheet formula parsers,
    // so "a=b" is safe and must round-trip unescaped.
    expect(dataRow(toCsv([{ name: 'a=b' }]))).toBe('a=b')
  })
})
