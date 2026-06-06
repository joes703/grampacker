import { describe, it, expect } from 'vitest'
import {
  gearItemsToCsv,
  listItemsToCsv,
  parseCsv,
  parseGearCsv,
  parseListCsv,
  MAX_CSV_ROWS,
} from './csv'
import type { Category, GearItem, ListItemWithGear } from './types'

// Smoke test: representative gear-list rows should round-trip through
// listItemsToCsv → parseListCsv with the user-visible columns intact.
// The DB-only fields (ids, list_id, sort_order, packed) aren't in the parse
// output by design — parseListCsv targets imports from third-party tools too
// (Lighterpack), so it normalizes to ListImportRow's shape.
describe('csv round-trip', () => {
  const categories: Category[] = [
    {
      id: 'cat-shelter',
      user_id: 'u',
      name: 'Shelter',
      sort_order: 0,
      is_default: true,
      created_at: '2024-01-01',
    },
    {
      id: 'cat-kitchen',
      user_id: 'u',
      name: 'Kitchen',
      sort_order: 1,
      is_default: true,
      created_at: '2024-01-01',
    },
  ]

  const items: ListItemWithGear[] = [
    {
      id: 'li-1',
      list_id: 'l-1',
      user_id: 'u',
      gear_item_id: 'g-1',
      quantity: 1,
      is_worn: false,
      is_consumable: false,
      is_packed: false,
      is_ready: false,
      sort_order: 0,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      gear_item: {
        id: 'g-1',
        name: 'Tarp',
        description: 'cuben fiber',
        weight_grams: 240,
        category_id: 'cat-shelter',
        status: 'active',
      },
    },
    {
      id: 'li-2',
      list_id: 'l-1',
      user_id: 'u',
      gear_item_id: 'g-2',
      quantity: 2,
      is_worn: false,
      is_consumable: true,
      is_packed: false,
      is_ready: false,
      sort_order: 1,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      gear_item: {
        id: 'g-2',
        name: 'Stove fuel canister',
        description: null,
        weight_grams: 100,
        category_id: 'cat-kitchen',
        status: 'active',
      },
    },
    {
      id: 'li-3',
      list_id: 'l-1',
      user_id: 'u',
      gear_item_id: 'g-3',
      quantity: 1,
      is_worn: true,
      is_consumable: false,
      is_packed: false,
      is_ready: false,
      sort_order: 2,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      gear_item: {
        id: 'g-3',
        name: 'Rain jacket, "shell"',
        description: 'with comma + quotes for escapeCell',
        weight_grams: 320,
        category_id: null,
        status: 'active',
      },
    },
  ]

  it('parses quantity from common header names and clamps to [1, 9999]', () => {
    const csv = [
      'name,weight_grams,qty',
      'Item A,10,1',
      'Item B,10,6',
      'Item C,10,2',
      'Item D,10,9999',
      'Item E,10,99999',  // over cap → clamped
      'Item F,10,0',      // under min → 1
      'Item G,10,',       // blank → 1
      'Item H,10,abc',    // NaN → 1
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.quantity)).toEqual([1, 6, 2, 9999, 9999, 1, 1, 1])
  })

  it('preserves user-visible fields across serialize → parse', () => {
    const csv = listItemsToCsv(items, categories)
    const parsed = parseListCsv(csv)
    expect(typeof parsed).not.toBe('string')
    if (typeof parsed === 'string') return // narrowing for TS

    expect(parsed).toHaveLength(items.length)
    parsed.forEach((row, i) => {
      const src = items[i]!
      expect(row.name).toBe(src.gear_item.name)
      expect(row.description).toBe(src.gear_item.description)
      expect(row.weight_grams).toBe(src.gear_item.weight_grams)
      expect(row.quantity).toBe(src.quantity)
      expect(row.is_worn).toBe(src.is_worn)
      expect(row.is_consumable).toBe(src.is_consumable)
      const expectedCat = src.gear_item.category_id
        ? categories.find((c) => c.id === src.gear_item.category_id)?.name ?? ''
        : ''
      expect(row.category).toBe(expectedCat)
    })
  })

  it('parses Lighterpack-format CSV (Worn/Consumable literals, gram unit)', () => {
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable',
      'Tarp,Shelter,cuben fiber,1,240,gram,,0,,',
      'Stove fuel canister,Kitchen,,2,100,gram,,0,,Consumable',
      'Rain jacket,Clothing,,1,320,gram,,0,Worn,',
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toMatchObject({
      name: 'Tarp', description: 'cuben fiber', weight_grams: 240,
      quantity: 1, category: 'Shelter', is_worn: false, is_consumable: false,
    })
    expect(parsed[1]).toMatchObject({
      name: 'Stove fuel canister', weight_grams: 100, quantity: 2,
      is_worn: false, is_consumable: true,
    })
    expect(parsed[2]).toMatchObject({
      name: 'Rain jacket', weight_grams: 320, quantity: 1,
      is_worn: true, is_consumable: false,
    })
  })

  it('clears BOTH flags when a row marks itself worn AND consumable (worn_xor_consumable)', () => {
    // worn_xor_consumable is a DB CHECK constraint: a list_item can be at
    // most one of worn/consumable. A CSV row that sets both would fail the
    // insert, so parseListCsv silently normalizes by clearing both. The two
    // single-flag control rows prove the clearing is specific to the
    // both-set case and not a blanket suppression of either flag.
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable',
      'Both flags,Shelter,,1,100,gram,,0,Worn,Consumable',
      'Only worn,Clothing,,1,200,gram,,0,Worn,',
      'Only consumable,Food,,1,50,gram,,0,,Consumable',
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed).toHaveLength(3)
    // Both truthy -> both cleared.
    expect(parsed[0]).toMatchObject({
      name: 'Both flags', is_worn: false, is_consumable: false,
    })
    // Control: worn-only stays worn, consumable false.
    expect(parsed[1]).toMatchObject({
      name: 'Only worn', is_worn: true, is_consumable: false,
    })
    // Control: consumable-only stays consumable, worn false.
    expect(parsed[2]).toMatchObject({
      name: 'Only consumable', is_worn: false, is_consumable: true,
    })
  })

  it('parses HikerHerd-style headers (notes for description, mixed case)', () => {
    const csv = [
      'Name,Category,Notes,Quantity,Weight,Unit,Worn,Consumable',
      'Tarp,Shelter,cuben fiber,1,240,g,,',
      'Trail mix,Food,nut and dried fruit blend,3,50,g,,yes',
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]).toMatchObject({
      name: 'Tarp', description: 'cuben fiber', weight_grams: 240, quantity: 1,
    })
    expect(parsed[1]).toMatchObject({
      name: 'Trail mix', description: 'nut and dried fruit blend',
      weight_grams: 50, quantity: 3, is_consumable: true,
    })
  })

  it('parses spelled-out unit aliases (ounce, pound, kilogram)', () => {
    const csv = [
      'name,weight,unit',
      'Item A,3,ounce',     // 3 oz → 85 g
      'Item B,2.5,ounces',  // 2.5 oz → 71 g
      'Item C,1,pound',     // 1 lb → 454 g
      'Item D,2,pounds',    // 2 lb → 907 g
      'Item E,1.5,kilogram',// 1.5 kg → 1500 g
      'Item F,0.5,kilograms',// 0.5 kg → 500 g
      'Item G,100,gram',    // 100 g → 100 g
      'Item H,200,grams',   // 200 g → 200 g
      'Item I,50,',         // empty unit → 50 g
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.weight_grams)).toEqual([
      85, 71, 454, 907, 1500, 500, 100, 200, 50,
    ])
  })

  it('parses CSV missing optional columns with sensible defaults', () => {
    const csv = [
      'name,weight',
      'Bare item,150',
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]).toMatchObject({
      name: 'Bare item',
      description: null,
      weight_grams: 150,
      quantity: 1,           // default when qty column absent
      category: '',           // empty when category column absent
      is_worn: false,         // empty when worn column absent
      is_consumable: false,
    })
  })

  it('emits Lighterpack-compatible export format', () => {
    const csv = listItemsToCsv(items, categories)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable')

    // Row index 0 — Tarp: is_worn=false, is_consumable=false. Lighterpack
    // emits empty strings for false-flag rows. unit is the literal 'gram',
    // url is empty, price is the numeric default 0.
    expect(lines[1]).toBe('Tarp,Shelter,cuben fiber,1,240,gram,,0,,')

    // Row index 1 — Stove fuel canister: is_consumable=true.
    expect(lines[2]).toBe('Stove fuel canister,Kitchen,,2,100,gram,,0,,Consumable')

    // Row index 2 — Rain jacket: is_worn=true, name has comma + embedded
    // quotes (exercises escapeCell's quote-doubling). description has a +
    // sign that is NOT a leading character — formula-injection escape only
    // triggers on leading =, +, -, @, tab, CR.
    expect(lines[3]).toBe(
      '"Rain jacket, ""shell""",,with comma + quotes for escapeCell,1,320,gram,,0,Worn,',
    )
  })
})

// Gear-library CSV — cost and purchase_date are inventory-only metadata,
// nullable. Empty CSV cells must round-trip as null (never 0 or epoch);
// populated cells must round-trip as the same number/ISO date.
describe('gear csv with cost and purchase_date', () => {
  const categories: Category[] = [
    {
      id: 'cat-shelter', user_id: 'u', name: 'Shelter',
      sort_order: 0, is_default: true, created_at: '2024-01-01',
    },
  ]

  function makeGear(overrides: Partial<GearItem>): GearItem {
    return {
      id: 'g-x', user_id: 'u', category_id: 'cat-shelter',
      name: 'Item', description: null, weight_grams: 100,
      cost: null, purchase_date: null, status: 'active',
      sort_order: 0,
      created_at: '2024-01-01', updated_at: '2024-01-01',
      ...overrides,
    }
  }

  it('parses a CSV row with both fields populated', () => {
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable,cost,purchase_date',
      'Tarp,Shelter,,1,240,gram,,0,,,89.99,2024-04-15',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]).toMatchObject({
      name: 'Tarp',
      weight_grams: 240,
      cost: 89.99,
      purchase_date: '2024-04-15',
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
      weight_grams: 150,
      cost: null,
      purchase_date: null,
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

  it('round-trips a mix of populated and empty cost/purchase_date values', () => {
    const items: GearItem[] = [
      makeGear({ id: 'g-1', name: 'Tarp', cost: 89.99, purchase_date: '2024-04-15' }),
      makeGear({ id: 'g-2', name: 'Old stove', cost: null, purchase_date: null }),
      makeGear({ id: 'g-3', name: 'Sleeping bag', cost: 250, purchase_date: null }),
      makeGear({ id: 'g-4', name: 'Headlamp', cost: null, purchase_date: '2020-12-01' }),
    ]
    const csv = gearItemsToCsv(items, categories)
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed).toHaveLength(items.length)
    parsed.forEach((row, i) => {
      const src = items[i]!
      expect(row.name).toBe(src.name)
      expect(row.cost).toBe(src.cost)
      expect(row.purchase_date).toBe(src.purchase_date)
    })
  })

  it('falls back to the "price" column on import (Lighterpack compatibility)', () => {
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable',
      'Tarp,Shelter,,1,240,gram,,42.50,,',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(42.50)
  })

  it('rejects unparseable cost or non-ISO date as null', () => {
    const csv = [
      'Item Name,Category,weight,cost,purchase_date',
      'A,Shelter,100,not-a-number,not-a-date',
      'B,Shelter,100,-5,04/15/2024',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]).toMatchObject({ cost: null, purchase_date: null })
    // Negative cost dropped to null; locale date format also rejected.
    expect(parsed[1]).toMatchObject({ cost: null, purchase_date: null })
  })

  it('caps cost at 99,999,999.99 to avoid Postgres 22003 on bulk insert', () => {
    // The DB column is numeric(10,2). An over-cap row would otherwise
    // fail the bulk INSERT with numeric_value_out_of_range, taking
    // every row in the same INSERT down with it. Cap client-side so
    // the import succeeds with the value clamped to the column max.
    const csv = [
      'Item Name,Category,weight,cost',
      'Way too expensive widget,Shelter,100,99999999999.99',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(99_999_999.99)
  })
})

// Edge cases the audit (T-6) called out: BOM-prefixed CSVs from
// Excel/Windows, embedded CRLF inside a quoted field (descriptions with
// line breaks), and header-only CSVs with no data rows. The current
// parser handles all three correctly today (BOM is a Unicode whitespace
// character that .trim() strips on the header row; parseRow tracks
// inQuote so embedded \r\n stays a single cell; parseCsv early-returns
// [] when there are no data lines and parseGearCsv surfaces that as a
// user-facing error string). These tests lock the contracts so a future
// parser refactor can't silently break Lighterpack/Excel imports.
describe('csv parser edge cases (T-6)', () => {
  it('strips BOM (U+FEFF) from a Windows-saved CSV header', () => {
    // The BOM lives at the start of the header line, before "Item Name".
    // If unstripped, every column-resolution find would fail because
    // 'item name' (lowercased) wouldn't match '\uFEFFitem name'.
    const csv = '\uFEFFItem Name,weight\nFoo,100'
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('Foo')
    expect(parsed[0]?.weight_grams).toBe(100)
  })

  it('preserves embedded \\r\\n inside a quoted field as a single cell', () => {
    // A description column with a literal CRLF in it must round-trip as
    // one cell, not split across two rows. Lighterpack and similar tools
    // emit multi-line notes this way for description/desc columns.
    const csv = 'Item Name,desc,weight\r\n"Foo","line one\r\nline two",100\r\n'
    const parsed = parseCsv(csv)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.['item name']).toBe('Foo')
    expect(parsed[0]?.['desc']).toBe('line one\r\nline two')
    expect(parsed[0]?.['weight']).toBe('100')
  })

  it('returns the user-facing error string for header-only CSVs (no data rows)', () => {
    // parseCsv returns [] when only a header line is present; parseGearCsv
    // surfaces that as the audit-known error message rather than a silent
    // empty import.
    const csv = 'Item Name,weight\n'
    const parsed = parseGearCsv(csv)
    expect(parsed).toBe('File appears empty or has no data rows.')
  })
})

// A 2 MB file (the byte cap in use-csv-file-input) can hold far more rows
// than any realistic library/list. Both adapters reject over-cap files with
// an error string BEFORE building the per-row preview/insert payload, so a
// pathological row count can't jank the (un-virtualized) preview table.
describe('csv parsed-row cap (MAX_CSV_ROWS)', () => {
  const gearCsv = (dataRowCount: number) =>
    'Item Name,weight\n' +
    Array.from({ length: dataRowCount }, (_, i) => `Item ${i},100`).join('\n')

  it('accepts a file with exactly MAX_CSV_ROWS data rows', () => {
    const parsed = parseGearCsv(gearCsv(MAX_CSV_ROWS))
    expect(Array.isArray(parsed)).toBe(true)
    expect((parsed as unknown[]).length).toBe(MAX_CSV_ROWS)
  })

  it('rejects a gear file with more than MAX_CSV_ROWS data rows', () => {
    const parsed = parseGearCsv(gearCsv(MAX_CSV_ROWS + 1))
    expect(typeof parsed).toBe('string')
    expect(parsed).toContain('too many to import')
  })

  it('rejects a list file with more than MAX_CSV_ROWS data rows', () => {
    const parsed = parseListCsv(gearCsv(MAX_CSV_ROWS + 1))
    expect(typeof parsed).toBe('string')
    expect(parsed).toContain('too many to import')
  })

  it('does not count blank rows toward the cap (parseCsv drops them first)', () => {
    // MAX_CSV_ROWS real rows + a trailing blank line is still under the cap.
    const parsed = parseGearCsv(gearCsv(MAX_CSV_ROWS) + '\n\n')
    expect(Array.isArray(parsed)).toBe(true)
  })
})
