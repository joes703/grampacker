import { describe, it, expect } from 'vitest'
import { listItemsToCsv, parseListCsv, nameFromCsvFilename } from './index'
import type { Category, GearItem, ListItemWithGear } from '../types'
import { MAX_LIST_ITEM_QUANTITY } from '../caps'

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

function makeListItem(
  over: Partial<ListItemWithGear> & { id: string; gearItem: GearItem },
): ListItemWithGear {
  return {
    id: over.id,
    listId: over.listId ?? 'l-1',
    gearItemId: over.gearItem.id,
    quantity: over.quantity ?? 1,
    isWorn: over.isWorn ?? false,
    isConsumable: over.isConsumable ?? false,
    isPacked: over.isPacked ?? false,
    isReady: over.isReady ?? false,
    packingLocationId: over.packingLocationId ?? null,
    sortOrder: over.sortOrder ?? 0,
    packSortOrder: over.packSortOrder ?? over.sortOrder ?? 0,
    createdAt: over.createdAt ?? '2024-01-01',
    updatedAt: over.updatedAt ?? '2024-01-01',
    gearItem: over.gearItem,
  }
}

// Smoke test: representative list rows should round-trip through
// listItemsToCsv -> parseListCsv with the user-visible columns intact.
// The DB-only fields (ids, listId, sortOrder, packed/ready) aren't in the
// parse output by design - parseListCsv targets imports from third-party
// tools too (Lighterpack), so it normalizes to ListCsvRow's shape.
describe('list csv round-trip', () => {
  const categories: Category[] = [
    makeCategory({ id: 'cat-shelter', name: 'Shelter', sortOrder: 0 }),
    makeCategory({ id: 'cat-kitchen', name: 'Kitchen', sortOrder: 1 }),
  ]

  const items: ListItemWithGear[] = [
    makeListItem({
      id: 'li-1',
      quantity: 1,
      sortOrder: 0,
      gearItem: makeGear({
        id: 'g-1', name: 'Tarp', description: 'cuben fiber',
        weightGrams: 240, categoryId: 'cat-shelter',
      }),
    }),
    makeListItem({
      id: 'li-2',
      quantity: 2,
      isConsumable: true,
      sortOrder: 1,
      gearItem: makeGear({
        id: 'g-2', name: 'Stove fuel canister', description: null,
        weightGrams: 100, categoryId: 'cat-kitchen',
      }),
    }),
    makeListItem({
      id: 'li-3',
      quantity: 1,
      isWorn: true,
      sortOrder: 2,
      gearItem: makeGear({
        id: 'g-3', name: 'Rain jacket, "shell"',
        description: 'with comma + quotes for escapeCell',
        weightGrams: 320, categoryId: null,
      }),
    }),
  ]

  it(`parses quantity from common header names and clamps to [1, ${MAX_LIST_ITEM_QUANTITY}]`, () => {
    const csv = [
      'name,weight_grams,qty',
      'Item A,10,1',
      'Item B,10,6',
      'Item C,10,2',
      `Item D,10,${MAX_LIST_ITEM_QUANTITY}`,       // exactly at cap
      `Item E,10,${MAX_LIST_ITEM_QUANTITY + 1}`,   // over cap -> clamped
      'Item F,10,0',      // under min -> 1
      'Item G,10,',       // blank -> 1
      'Item H,10,abc',    // NaN -> 1
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.quantity)).toEqual([1, 6, 2, MAX_LIST_ITEM_QUANTITY, MAX_LIST_ITEM_QUANTITY, 1, 1, 1])
  })

  it('preserves user-visible fields across serialize -> parse', () => {
    const csv = listItemsToCsv(items, categories)
    const parsed = parseListCsv(csv)
    expect(typeof parsed).not.toBe('string')
    if (typeof parsed === 'string') return // narrowing for TS

    expect(parsed).toHaveLength(items.length)
    parsed.forEach((row, i) => {
      const src = items[i]!
      expect(row.name).toBe(src.gearItem.name)
      expect(row.description).toBe(src.gearItem.description)
      expect(row.weightGrams).toBe(src.gearItem.weightGrams)
      expect(row.quantity).toBe(src.quantity)
      expect(row.isWorn).toBe(src.isWorn)
      expect(row.isConsumable).toBe(src.isConsumable)
      const expectedCat = src.gearItem.categoryId
        ? categories.find((c) => c.id === src.gearItem.categoryId)?.name ?? ''
        : ''
      expect(row.categoryName).toBe(expectedCat)
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
      name: 'Tarp', description: 'cuben fiber', weightGrams: 240,
      quantity: 1, categoryName: 'Shelter', isWorn: false, isConsumable: false,
    })
    expect(parsed[1]).toMatchObject({
      name: 'Stove fuel canister', weightGrams: 100, quantity: 2,
      isWorn: false, isConsumable: true,
    })
    expect(parsed[2]).toMatchObject({
      name: 'Rain jacket', weightGrams: 320, quantity: 1,
      isWorn: true, isConsumable: false,
    })
  })

  it('clears BOTH flags when a row marks itself worn AND consumable', () => {
    // worn/consumable exclusivity is a DB CHECK constraint: a list item can
    // be at most one of worn/consumable. A CSV row that sets both would
    // fail the insert, so parseListCsv silently normalizes by clearing
    // both. The two single-flag control rows prove the clearing is specific
    // to the both-set case and not a blanket suppression of either flag.
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
      name: 'Both flags', isWorn: false, isConsumable: false,
    })
    // Control: worn-only stays worn, consumable false.
    expect(parsed[1]).toMatchObject({
      name: 'Only worn', isWorn: true, isConsumable: false,
    })
    // Control: consumable-only stays consumable, worn false.
    expect(parsed[2]).toMatchObject({
      name: 'Only consumable', isWorn: false, isConsumable: true,
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
      name: 'Tarp', description: 'cuben fiber', weightGrams: 240, quantity: 1,
    })
    expect(parsed[1]).toMatchObject({
      name: 'Trail mix', description: 'nut and dried fruit blend',
      weightGrams: 50, quantity: 3, isConsumable: true,
    })
  })

  // The alias table belongs to toGrams (units.test.ts): this parser hands it
  // the cell as written. One non-gram row proves the parser reads the unit
  // column, and a blank cell in that column still means grams.
  it('converts the weight by the unit column', () => {
    const csv = ['name,weight,unit', 'Item A,3,ounce', 'Item B,50,'].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.weightGrams)).toEqual([85, 50])
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
      weightGrams: 150,
      quantity: 1,          // default when qty column absent
      categoryName: '',     // empty when category column absent
      isWorn: false,        // empty when worn column absent
      isConsumable: false,
      cost: null,           // null when the file has no money column at all
    })
  })

  it('returns an error string when a required column is missing', () => {
    expect(parseListCsv('weight\n100')).toContain('Missing required column: "name"')
    expect(parseListCsv('name\nTarp')).toContain('Missing required column: "weight_grams"')
  })

  it('silently drops rows with an empty name', () => {
    const csv = [
      'name,weight',
      'Kept,100',
      ',200',
      '   ,300',
      'Also kept,400',
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.name)).toEqual(['Kept', 'Also kept'])
  })

  it('emits the byte-exact Lighterpack-shaped export format', () => {
    // Lighterpack's importer is positional and builds each item from exactly
    // row[0..5]. Reordering those six does not fail an import - it succeeds
    // with a description landing in the category. The exact header and rows
    // below pin every position.
    const csv = listItemsToCsv(items, categories)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Item Name,Category,desc,qty,weight,unit,url,cost,worn,consumable')

    // Row index 0 - Tarp: isWorn=false, isConsumable=false. Lighterpack
    // emits empty strings for false-flag rows. unit is the literal 'gram',
    // url is empty, and cost is BLANK for these unpriced fixtures - never a
    // fabricated 0.
    expect(lines[1]).toBe('Tarp,Shelter,cuben fiber,1,240,gram,,,,')

    // Row index 1 - Stove fuel canister: isConsumable=true.
    expect(lines[2]).toBe('Stove fuel canister,Kitchen,,2,100,gram,,,,Consumable')

    // Row index 2 - Rain jacket: isWorn=true, name has comma + embedded
    // quotes (exercises escapeCell's quote-doubling). description has a +
    // sign that is NOT a leading character - formula-injection escape only
    // triggers on leading =, +, -, @, tab, CR.
    expect(lines[3]).toBe(
      '"Rain jacket, ""shell""",,with comma + quotes for escapeCell,1,320,gram,,,Worn,',
    )
  })

  it('exports the gear item\'s real cost, keeping zero distinct from unknown', () => {
    // A list item has no price of its own - it points at a gear item that
    // does. A hardcoded 0 here would make every exported list claim to cost
    // nothing. The import side of the same three values is "parses our own
    // cost column, including a genuine zero", under this exact header.
    const priced: ListItemWithGear[] = [
      makeListItem({
        id: 'li-p', quantity: 1, sortOrder: 0,
        gearItem: makeGear({ id: 'g-p', name: 'Tent', weightGrams: 1200, categoryId: null, cost: 27.29 }),
      }),
      makeListItem({
        id: 'li-z', quantity: 1, sortOrder: 1,
        gearItem: makeGear({ id: 'g-z', name: 'Gifted mug', weightGrams: 50, categoryId: null, cost: 0 }),
      }),
      makeListItem({
        id: 'li-n', quantity: 1, sortOrder: 2,
        gearItem: makeGear({ id: 'g-n', name: 'Old rope', weightGrams: 60, categoryId: null, cost: null }),
      }),
    ]
    const lines = listItemsToCsv(priced, categories).split('\r\n')
    expect(lines[1]).toBe('Tent,,,1,1200,gram,,27.29,,')
    // Free, not unknown.
    expect(lines[2]).toBe('Gifted mug,,,1,50,gram,,0,,')
    // Unknown, not free.
    expect(lines[3]).toBe('Old rope,,,1,60,gram,,,,')
  })
})

// Cost on the list path: our own export writes `cost`, a Lighterpack export
// writes `price`, and the two differ in what a ZERO means. See
// parseCostFromColumn in money.ts.
describe('list csv cost import', () => {
  it('parses our own cost column, including a genuine zero', () => {
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,cost,worn,consumable',
      'Tent,Shelter,,1,1200,gram,,$27.29,,',
      'Gifted mug,Kitchen,,1,50,gram,,0,,',
      'Old rope,,,1,60,gram,,,,',
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    // Inherits the currency-symbol handling from the shared money module.
    expect(parsed[0]?.cost).toBe(27.29)
    expect(parsed[1]?.cost).toBe(0)
    expect(parsed[2]?.cost).toBeNull()
  })

  it('reads a Lighterpack price column but treats its ZERO as unset', () => {
    // Lighterpack defaults an unpriced item to 0, and older grampacker list
    // exports carry price=0 on EVERY row. Reading those as real
    // would import an entire list as free - inventing data. A nonzero price
    // is still a real price.
    const csv = [
      'Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable',
      'Tent,Shelter,,1,1200,gram,,42.50,,',
      'Legacy row,Shelter,,1,100,gram,,0,,',
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(42.5)
    expect(parsed[1]?.cost).toBeNull()
  })

  it('prefers cost over price when both columns are present', () => {
    const csv = [
      'Item Name,weight,price,cost',
      'Tent,1200,0,27.29',
    ].join('\r\n')
    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed[0]?.cost).toBe(27.29)
  })

  it('round-trips fractional weights exactly, and exports them without float noise', () => {
    const fractional: ListItemWithGear[] = [
      makeListItem({
        id: 'li-a', quantity: 1, sortOrder: 0,
        gearItem: makeGear({ id: 'g-a', name: 'Stake', weightGrams: 12.4, categoryId: null, cost: null }),
      }),
      makeListItem({
        id: 'li-b', quantity: 1, sortOrder: 1,
        gearItem: makeGear({ id: 'g-b', name: 'Cord', weightGrams: 0.1, categoryId: null, cost: null }),
      }),
      makeListItem({
        id: 'li-c', quantity: 1, sortOrder: 2,
        gearItem: makeGear({ id: 'g-c', name: 'Tent', weightGrams: 1200, categoryId: null, cost: null }),
      }),
    ]
    const csv = listItemsToCsv(fractional, [])
    // Byte-exact: a whole gram must not gain a ".0", and no value may render
    // as float noise. The weight column is index 4.
    expect(csv.split('\r\n').slice(1, 4).map((line) => line.split(',')[4])).toEqual([
      '12.4',
      '0.1',
      '1200',
    ])

    const parsed = parseListCsv(csv)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.map((r) => r.weightGrams)).toEqual([12.4, 0.1, 1200])
  })
})

describe('nameFromCsvFilename', () => {
  it('strips the extension and any path prefix', () => {
    expect(nameFromCsvFilename('PCT 2026.csv')).toBe('PCT 2026')
    expect(nameFromCsvFilename('PCT 2026.CSV')).toBe('PCT 2026')
    expect(nameFromCsvFilename('/tmp/exports/summer.csv')).toBe('summer')
    expect(nameFromCsvFilename('C:\\Users\\joe\\winter.csv')).toBe('winter')
  })

  it('falls back to a generic label when nothing is left', () => {
    expect(nameFromCsvFilename('.csv')).toBe('Imported list')
    expect(nameFromCsvFilename('   .csv')).toBe('Imported list')
    expect(nameFromCsvFilename('')).toBe('Imported list')
  })

  it('keeps non-csv extensions intact (only .csv is stripped)', () => {
    expect(nameFromCsvFilename('gear.txt')).toBe('gear.txt')
  })
})
