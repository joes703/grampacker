import { describe, it, expect } from 'vitest'
import { gearItemsToCsv, parseGearCsv, parseCsv, MAX_CSV_ROWS } from './index'
import type { Category, GearItem } from '../types'

// camelCase DTO builders (the new repo speaks camelCase end-to-end; unlike
// the old repo these ARE the API response shapes, with no user_id).
function makeCategory(over: Partial<Category> & { id: string; name: string }): Category {
  return {
    id: over.id,
    name: over.name,
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2024-01-01',
  }
}

function makeGear(over: Partial<GearItem> & { id: string; name: string }): GearItem {
  return {
    id: over.id,
    // Default to cat-shelter only when categoryId is omitted; an explicit
    // `categoryId: null` must survive (?? would swallow it).
    categoryId: 'categoryId' in over ? over.categoryId ?? null : 'cat-shelter',
    name: over.name,
    description: over.description ?? null,
    weightGrams: over.weightGrams ?? 100,
    cost: over.cost ?? null,
    purchaseDate: over.purchaseDate ?? null,
    status: over.status ?? 'active',
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2024-01-01',
    updatedAt: over.updatedAt ?? '2024-01-01',
  }
}

// The 12-column export header is a Lighterpack-compatible layout with two
// grampacker extension columns (cost, purchase_date) appended. The column
// HEADERS stay byte-identical to the old repo's snake_case export so a
// grampacker export re-imports cleanly into Lighterpack and back.
describe('gearItemsToCsv export format', () => {
  const categories: Category[] = [
    makeCategory({ id: 'cat-shelter', name: 'Shelter', sortOrder: 0 }),
    makeCategory({ id: 'cat-kitchen', name: 'Kitchen', sortOrder: 1 }),
  ]

  const items: GearItem[] = [
    makeGear({
      id: 'g-1', name: 'Tarp', description: 'cuben fiber', weightGrams: 240,
      categoryId: 'cat-shelter', cost: 89.99, purchaseDate: '2024-04-15',
    }),
    makeGear({
      id: 'g-2', name: 'Stove fuel canister', description: null, weightGrams: 100,
      categoryId: 'cat-kitchen', cost: null, purchaseDate: null,
    }),
    makeGear({
      id: 'g-3', name: 'Rain jacket, "shell"',
      description: 'with comma + quotes for escapeCell', weightGrams: 320,
      categoryId: null, cost: 250, purchaseDate: null,
    }),
  ]

  it('emits the exact 12-column header', () => {
    const lines = gearItemsToCsv(items, categories).split('\r\n')
    expect(lines[0]).toBe(
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable,cost,purchase_date',
    )
  })

  it('emits byte-exact rows (qty=1, gram unit, price=0, blank null extensions)', () => {
    const lines = gearItemsToCsv(items, categories).split('\r\n')
    // Populated cost + purchase_date; category resolved from id.
    expect(lines[1]).toBe('Tarp,Shelter,cuben fiber,1,240,gram,,0,,,89.99,2024-04-15')
    // Null description/cost/purchase_date all blank (never 0 / epoch).
    expect(lines[2]).toBe('Stove fuel canister,Kitchen,,1,100,gram,,0,,,,')
    // Null category -> empty Category; name with comma + embedded quotes
    // exercises escapeCell's quote-doubling; the "+" in desc is NOT leading
    // so it is not formula-escaped. cost populated, purchase_date blank.
    expect(lines[3]).toBe(
      '"Rain jacket, ""shell""",,with comma + quotes for escapeCell,1,320,gram,,0,,,250,',
    )
  })
})

// cost and purchase_date are inventory-only metadata, nullable. Empty CSV
// cells must round-trip as null (never 0 or epoch); populated cells must
// round-trip as the same number / ISO date.
describe('gear csv with cost and purchaseDate', () => {
  const categories: Category[] = [makeCategory({ id: 'cat-shelter', name: 'Shelter', sortOrder: 0 })]

  it('parses a CSV row with both fields populated', () => {
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable,cost,purchase_date',
      'Tarp,Shelter,,1,240,gram,,0,,,89.99,2024-04-15',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]).toMatchObject({
      name: 'Tarp',
      weightGrams: 240,
      cost: 89.99,
      purchaseDate: '2024-04-15',
    })
  })

  it('parses a CSV row with both fields blank as null (not 0 / not epoch)', () => {
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable,cost,purchase_date',
      'Mystery item,Shelter,,1,150,gram,,,,,,',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]).toMatchObject({
      name: 'Mystery item',
      weightGrams: 150,
      cost: null,
      purchaseDate: null,
    })
  })

  it('prefers the "cost" column over "price" when both are present', () => {
    // The export emits price=0 alongside the real cost column. Re-importing
    // a grampacker export must not pick up the Lighterpack-default 0.
    const csv = [
      'Item Name,Category,weight,price,cost',
      'Tarp,Shelter,240,0,89.99',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(89.99)
  })

  it('round-trips a mix of populated and empty cost/purchaseDate values', () => {
    const items: GearItem[] = [
      makeGear({ id: 'g-1', name: 'Tarp', cost: 89.99, purchaseDate: '2024-04-15' }),
      makeGear({ id: 'g-2', name: 'Old stove', cost: null, purchaseDate: null }),
      makeGear({ id: 'g-3', name: 'Sleeping bag', cost: 250, purchaseDate: null }),
      makeGear({ id: 'g-4', name: 'Headlamp', cost: null, purchaseDate: '2020-12-01' }),
    ]
    const csv = gearItemsToCsv(items, categories)
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed).toHaveLength(items.length)
    parsed.forEach((row, i) => {
      const src = items[i]!
      expect(row.name).toBe(src.name)
      expect(row.cost).toBe(src.cost)
      expect(row.purchaseDate).toBe(src.purchaseDate)
    })
  })

  it('falls back to the "price" column on import (Lighterpack compatibility)', () => {
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable',
      'Tarp,Shelter,,1,240,gram,,42.50,,',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(42.5)
  })

  it('rejects unparseable cost or non-ISO / negative values as null', () => {
    const csv = [
      'Item Name,Category,weight,cost,purchase_date',
      'A,Shelter,100,not-a-number,not-a-date',
      'B,Shelter,100,-5,04/15/2024',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]).toMatchObject({ cost: null, purchaseDate: null })
    // Negative cost dropped to null; locale date format also rejected.
    expect(parsed[1]).toMatchObject({ cost: null, purchaseDate: null })
  })

  it('drops regex-valid but impossible calendar dates to null (2026-02-30)', () => {
    // The import DTO's isoDateSchema rejects impossible dates, and one bad
    // date would 400 the entire atomic import - so the parser must drop
    // them client-side. Real dates (incl. a leap day) survive untouched.
    const csv = [
      'Item Name,Category,weight,purchase_date',
      'A,Shelter,100,2026-02-30',
      'B,Shelter,100,2026-13-01',
      'C,Shelter,100,2024-02-29',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.purchaseDate).toBeNull()
    expect(parsed[1]?.purchaseDate).toBeNull()
    expect(parsed[2]?.purchaseDate).toBe('2024-02-29')
  })

  it('caps cost at 99,999,999.99 to keep the row under the server cost cap', () => {
    const csv = [
      'Item Name,Category,weight,cost',
      'Way too expensive widget,Shelter,100,99999999999.99',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(99_999_999.99)
  })
})

describe('parseGearCsv unit conversion and column handling', () => {
  it('converts oz / lb / kg and spelled-out unit aliases to grams', () => {
    const csv = [
      'name,weight,unit',
      'Item A,3,ounce', // 3 oz -> 85 g
      'Item B,2.5,ounces', // 2.5 oz -> 71 g
      'Item C,1,pound', // 1 lb -> 454 g
      'Item D,2,pounds', // 2 lb -> 907 g
      'Item E,1.5,kilogram', // 1.5 kg -> 1500 g
      'Item F,0.5,kilograms', // 0.5 kg -> 500 g
      'Item G,100,gram', // 100 g -> 100 g
      'Item H,200,grams', // 200 g -> 200 g
      'Item I,50,', // empty unit -> 50 g
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.weightGrams)).toEqual([85, 71, 454, 907, 1500, 500, 100, 200, 50])
  })

  it('resolves the "name" / "Item Name" and "weight" / "weight_grams" aliases', () => {
    const csv = ['name,weight_grams', 'Tent,1300'].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]).toMatchObject({ name: 'Tent', weightGrams: 1300 })
  })

  it('returns an error string when the required name column is missing', () => {
    const parsed = parseGearCsv(['weight,cost', '100,5'].join('\r\n'))
    expect(parsed).toBe('Missing required column: "name" or "Item Name"')
  })

  it('returns an error string when the required weight column is missing', () => {
    const parsed = parseGearCsv(['Item Name,cost', 'Tent,5'].join('\r\n'))
    expect(parsed).toBe('Missing required column: "weight_grams" or "weight"')
  })

  it('silently drops rows with an empty name', () => {
    const csv = ['Item Name,weight', ',100', 'Real,200', '   ,300'].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('Real')
  })
})

// Edge cases: BOM-prefixed CSVs from Excel/Windows, embedded CRLF inside a
// quoted field (multi-line descriptions), and header-only CSVs with no data
// rows. These lock the contracts so a future parser refactor can't silently
// break Lighterpack/Excel imports.
describe('parseGearCsv parser edge cases', () => {
  it('strips a BOM (U+FEFF) from a Windows-saved CSV header', () => {
    const csv = '﻿Item Name,weight\nFoo,100'
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('Foo')
    expect(parsed[0]?.weightGrams).toBe(100)
  })

  it('preserves an embedded CRLF inside a quoted description as a single cell', () => {
    const csv = 'Item Name,desc,weight\r\n"Foo","line one\r\nline two",100\r\n'
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('Foo')
    expect(parsed[0]?.description).toBe('line one\r\nline two')
    expect(parsed[0]?.weightGrams).toBe(100)
  })

  it('returns the user-facing error string for header-only CSVs (no data rows)', () => {
    const parsed = parseGearCsv('Item Name,weight\n')
    expect(parsed).toBe('File appears empty or has no data rows.')
  })
})

// A 2 MB file (the byte cap in use-csv-file-input) can hold far more rows
// than any realistic library. parseGearCsv rejects over-cap files with an
// error string BEFORE building the per-row payload.
describe('parseGearCsv row cap (MAX_CSV_ROWS)', () => {
  const gearCsv = (dataRowCount: number) =>
    'Item Name,weight\n' +
    Array.from({ length: dataRowCount }, (_, i) => `Item ${i},100`).join('\n')

  it('accepts a file with exactly MAX_CSV_ROWS data rows', () => {
    const parsed = parseGearCsv(gearCsv(MAX_CSV_ROWS))
    expect(Array.isArray(parsed)).toBe(true)
    expect((parsed as unknown[]).length).toBe(MAX_CSV_ROWS)
  })

  it('rejects a file with more than MAX_CSV_ROWS data rows', () => {
    const parsed = parseGearCsv(gearCsv(MAX_CSV_ROWS + 1))
    expect(typeof parsed).toBe('string')
    expect(parsed).toContain('too many to import')
  })

  it('does not count blank rows toward the cap (parseCsv drops them first)', () => {
    // MAX_CSV_ROWS real rows + trailing blank lines is still under the cap.
    const parsed = parseGearCsv(gearCsv(MAX_CSV_ROWS) + '\n\n')
    expect(Array.isArray(parsed)).toBe(true)
    expect((parsed as unknown[]).length).toBe(MAX_CSV_ROWS)
  })

  it('parseCsv drops blank rows so they never reach the adapter', () => {
    // Guards the "blank rows don't count" invariant at the primitive layer.
    expect(parseCsv('Item Name,weight\nTent,100\n\n\nStakes,80')).toHaveLength(2)
  })
})
