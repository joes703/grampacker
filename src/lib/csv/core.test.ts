import { describe, it, expect } from 'vitest'
import { parseCsv, toCsv } from './core'

describe('parseCsv', () => {
  it('parses a basic CSV with a header and two data rows', () => {
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
    // Regression: Excel on Windows and Numbers prefix UTF-8 CSV exports
    // with U+FEFF. Without BOM stripping, the first header becomes
    // "﻿name" and downstream alias lookups (e.g. parseGearCsv,
    // parseListCsv) silently miss the column.
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
    // Prior implementation split the input into lines BEFORE parsing
    // cells, with a separate state machine that didn't recognize the
    // `""` escape as an escape. A row carrying both an embedded newline
    // and a doubled-quote escape would shred into two corrupt rows.
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

  it('keeps the trailing row when the input ends without a final newline', () => {
    // Some hand-edited CSVs and tool exports omit the trailing newline.
    // The final row must still be emitted.
    const csv = 'name,weight\nTent,1300\nStakes,80'
    expect(parseCsv(csv)).toEqual([
      { name: 'Tent', weight: '1300' },
      { name: 'Stakes', weight: '80' },
    ])
  })

  it('round-trips a value containing comma, quote, and newline through toCsv -> parseCsv', () => {
    const original = { name: 'Tent', description: 'sleeps 2,\nuses "DAC" poles' }
    const csv = toCsv([original])
    expect(parseCsv(csv)).toEqual([original])
  })
})
