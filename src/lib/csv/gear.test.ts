import { describe, it, expect } from 'vitest'
import { gearItemsToCsv, parseGearCsv, MAX_CSV_ROWS } from './index'
import type { Category, GearItem } from '../types'

// camelCase DTO builders: these ARE the API response shapes, with no user_id.
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

// The 11-column export header is a Lighterpack-shaped layout with two
// grampacker extension columns (cost, purchase_date) appended. The column
// HEADERS stay snake_case so a grampacker export re-imports cleanly into
// Lighterpack and back.
//
// ONE money column, `cost`. Lighterpack's importer is positional and never
// reads a price column, so exporting one would buy no compatibility. Import
// still ACCEPTS `price`, both for real Lighterpack exports and for older
// grampacker exports that carry price=0 beside cost.
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

  it('exports a fractional weight byte-exactly and re-imports it unchanged', () => {
    // The weight column is index 4. A whole gram must not gain a ".0" (it
    // would change the Lighterpack-facing bytes), and a tenth must survive
    // the export -> parse round trip so re-importing dedups instead of
    // duplicating the library.
    const fractional: GearItem[] = [
      makeGear({ id: 'f-1', name: 'Stake', weightGrams: 12.4, categoryId: null }),
      makeGear({ id: 'f-2', name: 'Cord', weightGrams: 0.1, categoryId: null }),
      makeGear({ id: 'f-3', name: 'Tarp', weightGrams: 240, categoryId: null }),
    ]
    const csv = gearItemsToCsv(fractional, [])
    expect(csv.split('\r\n').slice(1, 4).map((line) => line.split(',')[4])).toEqual([
      '12.4',
      '0.1',
      '240',
    ])

    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.weightGrams)).toEqual([12.4, 0.1, 240])
  })

  it('emits the exact 11-column header', () => {
    // Lighterpack's importer is positional, not header-driven: it builds each
    // item from row[0..5] (name, category, description, qty, weight, unit).
    // Reordering those six does not fail an import - it SUCCEEDS with the
    // wrong fields. toCsv writes every row in header order, so this header
    // and the byte-exact rows below pin each position.
    const lines = gearItemsToCsv(items, categories).split('\r\n')
    expect(lines[0]).toBe(
      'Item Name,Category,desc,qty,weight,unit,url,worn,consumable,cost,purchase_date',
    )
  })

  it('emits byte-exact rows (qty=1, gram unit, blank null extensions)', () => {
    const lines = gearItemsToCsv(items, categories).split('\r\n')
    // Populated cost + purchase_date; category resolved from id.
    expect(lines[1]).toBe('Tarp,Shelter,cuben fiber,1,240,gram,,,,89.99,2024-04-15')
    // Null description/cost/purchase_date all blank (never 0 / epoch).
    expect(lines[2]).toBe('Stove fuel canister,Kitchen,,1,100,gram,,,,,')
    // Null category -> empty Category; name with comma + embedded quotes
    // exercises escapeCell's quote-doubling; the "+" in desc is NOT leading
    // so it is not formula-escaped. cost populated, purchase_date blank.
    expect(lines[3]).toBe(
      '"Rain jacket, ""shell""",,with comma + quotes for escapeCell,1,320,gram,,,,250,',
    )
  })

  it('keeps a genuine zero cost distinct from an unknown one', () => {
    // A free item costs 0; an unknown price is null. The export must not
    // collapse them - an `|| ''` instead of `?? ''` would turn every free
    // item into "price unknown", and blank re-imports as null. On import,
    // `cost` is grampacker's own column, so 0 there is a real price the user
    // set, not a Lighterpack default.
    const zeroAndNull: GearItem[] = [
      makeGear({ id: 'g-0', name: 'Gifted mug', weightGrams: 50, categoryId: null, cost: 0 }),
      makeGear({ id: 'g-n', name: 'Old rope', weightGrams: 60, categoryId: null, cost: null }),
    ]
    const csv = gearItemsToCsv(zeroAndNull, categories)
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('Gifted mug,,,1,50,gram,,,,0,')
    expect(lines[2]).toBe('Old rope,,,1,60,gram,,,,,')

    // ...and survives the round trip as 0, not null.
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(0)
    expect(parsed[1]?.cost).toBeNull()
  })
})

// cost and purchase_date are inventory-only metadata, nullable. Empty CSV
// cells must round-trip as null (never 0 or epoch); populated cells must
// round-trip as the same number / ISO date.
describe('gear csv with cost and purchaseDate', () => {
  const categories: Category[] = [makeCategory({ id: 'cat-shelter', name: 'Shelter', sortOrder: 0 })]

  it('prefers the "cost" column over "price" when both are present', () => {
    // Pre-collapse exports emitted price=0 alongside the real cost column
    // (current ones emit cost alone). Re-importing one of those older files
    // must not pick up the fake 0.
    const csv = [
      'Item Name,Category,weight,price,cost',
      'Tarp,Shelter,240,0,89.99',
      'Old rope,,60,0,',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(89.99)
    // The choice is per COLUMN, not per row: a blank cost beside price=0
    // stays unknown rather than falling back to the fake 0 as "free".
    expect(parsed[1]?.cost).toBeNull()
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

  it('treats a price-only ZERO as unknown, but keeps a nonzero price', () => {
    // Lighterpack defaults an unpriced item to 0, and grampacker's own
    // exports hardcoded price=0 before the columns were collapsed. Reading
    // those as "free" would fabricate inventory data. Deliberately a
    // price-ONLY fixture: with a cost column present, cost wins and this
    // branch never runs.
    //
    // A price written as "$27.29" must go through the same normalization as
    // a cost. Without it, a price carrying a currency symbol imports blank,
    // which looks exactly like a price the user never entered.
    const csv = [
      'Item Name,Category,weight,price',
      'Legacy row,Shelter,100,0',
      'Really priced,Shelter,100,42.50',
      'Dollar priced,Shelter,100,$27.29',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBeNull()
    expect(parsed[1]?.cost).toBe(42.5)
    expect(parsed[2]?.cost).toBe(27.29)
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

  it('parses costs carrying currency symbols and thousands separators', () => {
    // Real-world exports (and hand-edited sheets) write money as money.
    // parseFloat('$12.99') is NaN, so without normalization every priced
    // row imported with a blank cost - silently, since a null cost is
    // indistinguishable from "user left it empty".
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,$12.99',
      'B,Shelter,100,"$1,299.00"',
      'C,Shelter,100,USD 42.50',
      'D,Shelter,100,89.99 EUR',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(12.99)
    expect(parsed[1]?.cost).toBe(1299)
    expect(parsed[2]?.cost).toBe(42.5)
    expect(parsed[3]?.cost).toBe(89.99)
  })

  it('never turns an accounting-negative into a positive cost', () => {
    // "($5)" is a negative in accounting notation. Stripping the parens
    // as decoration would flip the sign silently, which is worse than
    // the plain "-5" case (already null) because nothing looks wrong.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,($5)',
      'B,Shelter,100,-$5',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBeNull()
    expect(parsed[1]?.cost).toBeNull()
  })

  it('never joins digits separated by interior junk', () => {
    // Decoration is stripped from the ENDS only. Stripping it anywhere
    // would collapse "1e3" to 13 and "12abc34" to 1234 - plausible-
    // looking numbers that were never in the file.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,1e3',
      'B,Shelter,100,12abc34',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBeNull()
    expect(parsed[1]?.cost).toBeNull()
  })

  it('rejects non-ASCII digits and minus lookalikes instead of stripping them', () => {
    // JS \d is ASCII-only, so a naive keep-set treats U+2212 MINUS and
    // Arabic-Indic digits as currency decoration and strips them: the
    // sign falls off "-$5" and "١٢.99" collapses to ".99".
    // Both yield a confident, wrong, positive price.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,−$5',
      'B,Shelter,100,5−',
      'C,Shelter,100,١٢.99',
      'D,Shelter,100,１２',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBeNull()
    expect(parsed[1]?.cost).toBeNull()
    expect(parsed[2]?.cost).toBeNull()
    expect(parsed[3]?.cost).toBeNull()
  })

  it('rejects every minus-sign lookalike, not just U+2212', () => {
    // Enumerating minus characters is whack-a-mole: U+207B, U+208B and
    // U+2796 are all recognizable minus signs, and "minus" is a word. The
    // parser strips only RECOGNIZED currency decoration, so each of these
    // survives to fail the strict gate instead of having its sign quietly
    // removed.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,⁻$5',
      'B,Shelter,100,₋$5',
      'C,Shelter,100,➖$5',
      'D,Shelter,100,minus $5',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBeNull()
    expect(parsed[1]?.cost).toBeNull()
    expect(parsed[2]?.cost).toBeNull()
    expect(parsed[3]?.cost).toBeNull()
  })

  it('rejects a value just over the cap that would round down onto it', () => {
    // The cap has to be checked BEFORE rounding: 99999999.9901 rounds to
    // exactly the cap and would import as it - the same invented-price
    // saturation, just at a smaller scale.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,99999999.9901',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBeNull()
  })

  it('rejects over-cap costs rather than saturating them to the cap', () => {
    // Saturating invents a price the file never contained, and it looks
    // legitimate in the UI. Null keeps the row importable (the cap exists
    // so one bad cell cannot 400 the whole atomic import) without
    // asserting a number nobody wrote. The row itself still imports.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,"$900,000,000"',
      'B,Shelter,100,99999999999.99',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBeNull()
    expect(parsed[1]?.cost).toBeNull()
    // The row itself still imports; only the unusable cost drops.
    expect(parsed[0]?.name).toBe('A')
  })

  it('rejects other locale groupings rather than guessing their meaning', () => {
    // European 1.299,00 and Indian 1,00,000 are unambiguous only if you
    // already know the locale, which a bare CSV does not tell us. A bare
    // comma decimal is ambiguous too: is 12,99 twelve-ninety-nine or
    // one-two-nine-nine? parseFloat would read it as 12, a wrong price.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,"1.299,00"',
      'B,Shelter,100,"1,00,000"',
      'C,Shelter,100,"1,2345"',
      'D,Shelter,100,","',
      'E,Shelter,100,"12,99"',
      'F,Shelter,100,"1,29"',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.cost)).toEqual([null, null, null, null, null, null])
  })

  it('accepts a trailing-decimal cost like "5."', () => {
    // Same reasoning as ".5": a valid price the strict gate must not reject.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,5.',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(5)
  })

  it('accepts a bare-decimal cost like ".5"', () => {
    // A valid price a user may type. The strict gate must not reject it.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,.5',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(0.5)
  })

  it('rejects trailing-garbage costs instead of silently truncating', () => {
    // parseFloat('12.99.5') returns 12.99. Strict validation after
    // normalization means a malformed cell is dropped, not guessed at.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,12.99.5',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBeNull()
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

  it('accepts a cost sitting exactly on the cap', () => {
    // Boundary: the cap itself is valid (costSchema's max is inclusive),
    // so the over-cap rejection must be > and not >=.
    const csv = [
      'Item Name,Category,weight,cost',
      'A,Shelter,100,99999999.99',
    ].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(99_999_999.99)
  })
})

describe('parseGearCsv unit conversion and column handling', () => {
  // The alias table belongs to toGrams (units.test.ts). One non-gram row
  // proves this parser reads the unit column at all.
  it('converts the weight by the unit column', () => {
    const csv = ['name,weight,unit', 'Item A,3,ounce'].join('\r\n')
    const parsed = parseGearCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.weightGrams).toBe(85)
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

// Edge cases: embedded CRLF inside a quoted field (multi-line descriptions)
// and header-only CSVs with no data rows. BOM handling is in core.test.ts. These lock the contracts so a future parser refactor can't silently
// break Lighterpack/Excel imports.
describe('parseGearCsv parser edge cases', () => {
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
})
