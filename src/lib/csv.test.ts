import { describe, it, expect } from 'vitest'
import { listItemsToCsv, parseListCsv } from './csv'
import type { Category, ListItemWithGear } from './types'

// Smoke test: representative gear-list rows should round-trip through
// listItemsToCsv → parseListCsv with the user-visible columns intact.
// The DB-only fields (ids, list_id, sort_order, packed) aren't in the parse
// output by design — parseListCsv targets imports from third-party tools too
// (Lighterpack), so it normalises to ListImportRow's shape.
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
      gear_item_id: 'g-1',
      quantity: 1,
      is_worn: false,
      is_consumable: false,
      is_packed: false,
      sort_order: 0,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      gear_item: {
        id: 'g-1',
        name: 'Tarp',
        description: 'cuben fiber',
        weight_grams: 240,
        category_id: 'cat-shelter',
      },
    },
    {
      id: 'li-2',
      list_id: 'l-1',
      gear_item_id: 'g-2',
      quantity: 2,
      is_worn: false,
      is_consumable: true,
      is_packed: false,
      sort_order: 1,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      gear_item: {
        id: 'g-2',
        name: 'Stove fuel canister',
        description: null,
        weight_grams: 100,
        category_id: 'cat-kitchen',
      },
    },
    {
      id: 'li-3',
      list_id: 'l-1',
      gear_item_id: 'g-3',
      quantity: 1,
      is_worn: true,
      is_consumable: false,
      is_packed: false,
      sort_order: 2,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      gear_item: {
        id: 'g-3',
        name: 'Rain jacket, "shell"',
        description: 'with comma + quotes for escapeCell',
        weight_grams: 320,
        category_id: null,
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
})
