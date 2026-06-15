import { describe, expect, it } from 'vitest'
import type { PublicCategory, PublicListItem } from '../lib/types'
import { MAX_NAME_LENGTH } from '../lib/caps'
import { copiedPublicListName, publicGearItemsToImportRows } from './public-gear-copy'

function item(over: Partial<PublicListItem> & { id: string; name: string; sort_order: number }): PublicListItem {
  return {
    id: over.id,
    gear_item_id: over.gear_item_id ?? `gear-${over.id}`,
    quantity: over.quantity ?? 1,
    is_worn: over.is_worn ?? false,
    is_consumable: over.is_consumable ?? false,
    sort_order: over.sort_order,
    gear_item: {
      id: over.gear_item?.id ?? over.gear_item_id ?? `gear-${over.id}`,
      name: over.name,
      description: over.gear_item?.description ?? null,
      weight_grams: over.gear_item?.weight_grams ?? 100,
      category_id: over.gear_item?.category_id ?? null,
    },
  }
}

describe('publicGearItemsToImportRows', () => {
  it('maps public gear rows into normal list import rows in list order', () => {
    const categories: PublicCategory[] = [
      { id: 'cat-shelter', name: 'Shelter', sort_order: 0 },
      { id: 'cat-cook', name: 'Cooking', sort_order: 1 },
    ]
    const rows = publicGearItemsToImportRows(
      [
        item({
          id: '2',
          name: 'Stove',
          sort_order: 20,
          quantity: 2,
          is_consumable: true,
          gear_item: {
            id: 'gear-stove',
            name: 'Stove',
            description: 'Tiny stove',
            weight_grams: 85,
            category_id: 'cat-cook',
          },
        }),
        item({
          id: '1',
          name: 'Tent',
          sort_order: 10,
          gear_item: {
            id: 'gear-tent',
            name: 'Tent',
            description: null,
            weight_grams: 1200,
            category_id: 'cat-shelter',
          },
        }),
      ],
      categories,
    )

    expect(rows).toEqual([
      {
        name: 'Tent',
        description: null,
        weight_grams: 1200,
        category: 'Shelter',
        quantity: 1,
        is_worn: false,
        is_consumable: false,
      },
      {
        name: 'Stove',
        description: 'Tiny stove',
        weight_grams: 85,
        category: 'Cooking',
        quantity: 2,
        is_worn: false,
        is_consumable: true,
      },
    ])
  })

  it('falls back to uncategorized when the public category is missing', () => {
    const rows = publicGearItemsToImportRows(
      [
        item({
          id: '1',
          name: 'Map',
          sort_order: 0,
          gear_item: {
            id: 'gear-map',
            name: 'Map',
            description: null,
            weight_grams: 35,
            category_id: 'missing-cat',
          },
        }),
      ],
      [],
    )

    expect(rows[0]?.category).toBe('')
  })
})

describe('copiedPublicListName', () => {
  it('adds a copy suffix within the list name limit', () => {
    const name = copiedPublicListName('Trip')
    expect(name).toBe('Trip (copy)')
  })

  it('trims long names before adding the suffix', () => {
    const name = copiedPublicListName('x'.repeat(MAX_NAME_LENGTH))
    expect(name).toHaveLength(MAX_NAME_LENGTH)
    expect(name.endsWith(' (copy)')).toBe(true)
  })
})
