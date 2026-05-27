import { describe, it, expect } from 'vitest'
import { parseCsv } from './core'

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
})
