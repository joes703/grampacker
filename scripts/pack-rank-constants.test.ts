import { describe, expect, it } from 'vitest'
import { CATEGORY_CAP, GEAR_ITEM_CAP } from '../shared/gear'
import { LIST_CAP, LIST_ITEM_CAP, PACK_RANK_MAX, PACKING_LOCATION_CAP } from '../shared/lists'
import { FOOD_ITEM_CAP } from '../shared/food'
import { definitionOf } from './schema-sql'

// The database's triggers enforce caps and rank bounds that TypeScript also
// declares, as literals, because SQL cannot import a constant. These tests are
// what keeps the two in step: change a constant in shared/ without a migration
// and the app and the database silently disagree about what is legal.

// Every number of 10 or more in a trigger. 0 and 1 appear structurally.
const literals = (name: string) =>
  new Set((definitionOf(name).match(/\d+/g) ?? []).map(Number).filter((n) => n >= 10))

describe('trigger literals match the TypeScript constants', () => {
  it.each([
    ['categories_user_cap', [CATEGORY_CAP]],
    ['gear_items_user_cap', [GEAR_ITEM_CAP]],
    ['lists_user_cap', [LIST_CAP]],
    ['list_items_list_cap', [LIST_ITEM_CAP]],
    ['packing_locations_list_cap', [PACKING_LOCATION_CAP]],
    ['list_food_items_list_cap', [FOOD_ITEM_CAP]],
    ['list_items_pack_rank_range_ins', [PACK_RANK_MAX]],
    ['list_items_pack_rank_range_upd', [LIST_ITEM_CAP, PACK_RANK_MAX]],
    ['list_food_items_pack_rank_range_ins', [PACK_RANK_MAX]],
    ['list_food_items_pack_rank_range_upd', [FOOD_ITEM_CAP, PACK_RANK_MAX]],
    ['packing_locations_rerank_orphans', [PACK_RANK_MAX]],
    ['packing_locations_rerank_food_orphans', [PACK_RANK_MAX]],
  ] as const)('%s', (trigger, expected) => {
    expect(literals(trigger)).toEqual(new Set(expected))
  })
})
