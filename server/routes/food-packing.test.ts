import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { FOOD_ITEM_CAP } from '../../shared/food'
import { PACK_RANK_MAX } from '../../shared/lists'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

// Food as a full peer of gear in Pack mode (0022): pack state on the food
// item PATCH, the union pack-order permutation, reset-packed spanning both
// tables, and location deletion reranking food. Matrix rows:
// docs/authz-matrix.md (food PATCH, pack-order, reset-packed).

type ListBody = { id: string }
type FoodItemBody = {
  id: string
  isPacked: boolean
  isReady: boolean
  packingLocationId: string | null
  packSortOrder: number
}
type ItemBody = { id: string; packSortOrder: number }

async function createList(cookie: string, name: string): Promise<ListBody> {
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
  expect(res.status).toBe(201)
  return (await res.json()) as ListBody
}

async function createGearOnList(
  cookie: string,
  listId: string,
  name: string,
): Promise<ItemBody> {
  const gearRes = await apiRequest(cookie, 'POST', '/api/gear-items', { name })
  expect(gearRes.status).toBe(201)
  const { id: gearItemId } = (await gearRes.json()) as { id: string }
  const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, {
    gearItemId,
  })
  expect(res.status).toBe(201)
  return (await res.json()) as ItemBody
}

async function createFood(
  cookie: string,
  listId: string,
  name: string,
): Promise<FoodItemBody> {
  const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, {
    name,
    weightGrams: 100,
    quantity: 1,
    slotIds: [],
  })
  expect(res.status).toBe(201)
  return (await res.json()) as FoodItemBody
}

async function createLocation(
  cookie: string,
  listId: string,
  name: string,
): Promise<{ id: string }> {
  const res = await apiRequest(
    cookie,
    'POST',
    `/api/lists/${listId}/packing-locations`,
    { name },
  )
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function patchFood(
  cookie: string,
  listId: string,
  itemId: string,
  body: unknown,
): Promise<Response> {
  return apiRequest(
    cookie,
    'PATCH',
    `/api/lists/${listId}/food/items/${itemId}`,
    body,
  )
}

async function getFoodItems(
  cookie: string,
  listId: string,
): Promise<FoodItemBody[]> {
  const res = await apiRequest(cookie, 'GET', `/api/lists/${listId}/food`)
  expect(res.status).toBe(200)
  return ((await res.json()) as { items: FoodItemBody[] }).items
}

describe('food pack state on the item PATCH', () => {
  it('packs and unpacks a food item', async () => {
    const { cookie } = await signUpVerifiedUser('fp1@example.com', 'FP')
    const list = await createList(cookie, 'Trip')
    const food = await createFood(cookie, list.id, 'Tortillas')
    expect(food.isPacked).toBe(false)

    const packed = await patchFood(cookie, list.id, food.id, { isPacked: true })
    expect(packed.status).toBe(200)
    expect(((await packed.json()) as FoodItemBody).isPacked).toBe(true)

    const [row] = await getFoodItems(cookie, list.id)
    expect(row?.isPacked).toBe(true)
  })

  it('assigns food to a bag, landing last in the UNION cohort', async () => {
    const { cookie } = await signUpVerifiedUser('fp2@example.com', 'FP')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Bear canister')
    // A gear item already in the bag: the food's arrival rank must clear it.
    const gear = await createGearOnList(cookie, list.id, 'Stove')
    const moveGear = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${gear.id}`,
      { packingLocationId: location.id },
    )
    expect(moveGear.status).toBe(200)
    const gearRank = ((await moveGear.json()) as ItemBody).packSortOrder

    const food = await createFood(cookie, list.id, 'Tortillas')
    const moved = await patchFood(cookie, list.id, food.id, {
      packingLocationId: location.id,
    })
    expect(moved.status).toBe(200)
    const body = (await moved.json()) as FoodItemBody
    expect(body.packingLocationId).toBe(location.id)
    expect(body.packSortOrder).toBeGreaterThan(gearRank)
  })

  it('re-assigning to the current bag keeps the rank', async () => {
    const { cookie } = await signUpVerifiedUser('fp3@example.com', 'FP')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Food bag')
    const food = await createFood(cookie, list.id, 'Oats')
    const first = await patchFood(cookie, list.id, food.id, {
      packingLocationId: location.id,
    })
    const firstRank = ((await first.json()) as FoodItemBody).packSortOrder
    const again = await patchFood(cookie, list.id, food.id, {
      packingLocationId: location.id,
    })
    expect(((await again.json()) as FoodItemBody).packSortOrder).toBe(firstRank)
  })

  it("rejects another user's location id with 400 and writes nothing", async () => {
    const owner = await signUpVerifiedUser('fp4@example.com', 'FP')
    const other = await signUpVerifiedUser('fp5@example.com', 'FP')
    const list = await createList(owner.cookie, 'Trip')
    const food = await createFood(owner.cookie, list.id, 'Oats')
    const otherList = await createList(other.cookie, 'Their trip')
    const otherLocation = await createLocation(
      other.cookie,
      otherList.id,
      'Their bag',
    )

    const res = await patchFood(owner.cookie, list.id, food.id, {
      packingLocationId: otherLocation.id,
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid packing location' })
    const [row] = await getFoodItems(owner.cookie, list.id)
    expect(row?.packingLocationId).toBeNull()
  })

  it("rejects a location on another of the SAME user's lists (cross-list stitching)", async () => {
    const { cookie } = await signUpVerifiedUser('fp6@example.com', 'FP')
    const listA = await createList(cookie, 'Trip A')
    const listB = await createList(cookie, 'Trip B')
    const food = await createFood(cookie, listA.id, 'Oats')
    const locationB = await createLocation(cookie, listB.id, 'B bag')

    const res = await patchFood(cookie, listA.id, food.id, {
      packingLocationId: locationB.id,
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid packing location' })
  })

  it("non-owner cannot reach the food item at all (404)", async () => {
    const owner = await signUpVerifiedUser('fp7@example.com', 'FP')
    const other = await signUpVerifiedUser('fp8@example.com', 'FP')
    const list = await createList(owner.cookie, 'Trip')
    const food = await createFood(owner.cookie, list.id, 'Oats')

    const res = await patchFood(other.cookie, list.id, food.id, {
      isPacked: true,
    })
    expect(res.status).toBe(404)
    // A 404 alone would also come back from a write that ran before the
    // ownership check: the owner's row must be unchanged.
    const [row] = await getFoodItems(owner.cookie, list.id)
    expect(row?.isPacked).toBe(false)
  })
})

describe('food ready state on the item PATCH', () => {
  it('marks and clears ready, and reset-ready clears food too', async () => {
    const { cookie } = await signUpVerifiedUser('fr1@example.com', 'FR')
    const list = await createList(cookie, 'Trip')
    const food = await createFood(cookie, list.id, 'Oats')
    expect(food.isReady).toBe(false)

    const ready = await patchFood(cookie, list.id, food.id, { isReady: true })
    expect(ready.status).toBe(200)
    expect(((await ready.json()) as FoodItemBody).isReady).toBe(true)

    const reset = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/reset-ready`,
    )
    expect(reset.status).toBe(204)
    const [row] = await getFoodItems(cookie, list.id)
    expect(row?.isReady).toBe(false)
  })
})

describe('the union pack-order permutation', () => {
  it('accepts the legacy bare-array shape (gear only)', async () => {
    const { cookie } = await signUpVerifiedUser('up1@example.com', 'UP')
    const list = await createList(cookie, 'Trip')
    const a = await createGearOnList(cookie, list.id, 'Stove')
    const b = await createGearOnList(cookie, list.id, 'Pot')

    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      [
        { id: a.id, packSortOrder: b.packSortOrder },
        { id: b.id, packSortOrder: a.packSortOrder },
      ],
    )
    expect(res.status).toBe(204)
  })

  it('permutes ranks ACROSS gear and food in one write', async () => {
    const { cookie } = await signUpVerifiedUser('up2@example.com', 'UP')
    const list = await createList(cookie, 'Trip')
    const gear = await createGearOnList(cookie, list.id, 'Stove')
    const food = await createFood(cookie, list.id, 'Tortillas')
    // Union arrival: the food row landed one past the gear row.
    expect(food.packSortOrder).toBeGreaterThan(gear.packSortOrder)

    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      {
        items: [{ id: gear.id, packSortOrder: food.packSortOrder }],
        foodItems: [{ id: food.id, packSortOrder: gear.packSortOrder }],
      },
    )
    expect(res.status).toBe(204)

    const [foodRow] = await getFoodItems(cookie, list.id)
    expect(foodRow?.packSortOrder).toBe(gear.packSortOrder)
    const itemsRes = await apiRequest(cookie, 'GET', `/api/lists/${list.id}/items`)
    const items = (await itemsRes.json()) as ItemBody[]
    const gearRow = items.find((r) => r.id === gear.id)
    expect(gearRow?.packSortOrder).toBe(food.packSortOrder)
  })

  it('rejects a payload spanning two cohorts with 400', async () => {
    const { cookie } = await signUpVerifiedUser('up3@example.com', 'UP')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Bag')
    const gear = await createGearOnList(cookie, list.id, 'Stove')
    const food = await createFood(cookie, list.id, 'Oats')
    const moved = await patchFood(cookie, list.id, food.id, {
      packingLocationId: location.id,
    })
    const movedBody = (await moved.json()) as FoodItemBody

    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      {
        items: [{ id: gear.id, packSortOrder: movedBody.packSortOrder }],
        foodItems: [{ id: food.id, packSortOrder: gear.packSortOrder }],
      },
    )
    expect(res.status).toBe(400)
  })

  it('accepts a collision-free minted rank (the index-safety contract)', async () => {
    // The old multiset-permutation rule rejected this; the index-safety rule
    // accepts any payload the unique indexes would accept - unique within
    // its table half and clear of untouched same-table cohort rows. Minting
    // a gap rank collides with nothing here.
    const { cookie } = await signUpVerifiedUser('up4@example.com', 'UP')
    const list = await createList(cookie, 'Trip')
    const food = await createFood(cookie, list.id, 'Oats')

    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      { foodItems: [{ id: food.id, packSortOrder: food.packSortOrder + 7 }] },
    )
    expect(res.status).toBe(204)
  })

  it("404s a food id that is not the caller's", async () => {
    const owner = await signUpVerifiedUser('up5@example.com', 'UP')
    const other = await signUpVerifiedUser('up6@example.com', 'UP')
    const ownerList = await createList(owner.cookie, 'Trip')
    const ownerFood = await createFood(owner.cookie, ownerList.id, 'Oats')
    const otherList = await createList(other.cookie, 'Their trip')
    await createFood(other.cookie, otherList.id, 'Their oats')

    const res = await apiRequest(
      other.cookie,
      'PUT',
      `/api/lists/${otherList.id}/items/pack-order`,
      { foodItems: [{ id: ownerFood.id, packSortOrder: 0 }] },
    )
    expect(res.status).toBe(404)
  })
})

// The food half of the union is checked separately from the gear half
// (server/repos/pack-reorder.ts validates each table's membership on its
// own), so a payload whose gear half is clean must still be refused when its
// food half names a row outside this list - and the state of BOTH lists must
// be untouched.
describe('the food half of the pack-order permutation and its parents', () => {
  // Gear through the owner's DTO (it carries ranks, locations and updatedAt);
  // food as RAW rows, because the food DTO omits created_at/updated_at and a
  // timestamp-only partial write would otherwise pass.
  async function snapshot(cookie: string, listId: string) {
    const gear = await apiRequest(cookie, 'GET', `/api/lists/${listId}/items`)
    expect(gear.status).toBe(200)
    const food = await env.DB.prepare(
      'select * from list_food_items where list_id = ? order by id',
    )
      .bind(listId)
      .all()
    return { gear: await gear.json(), food: food.results }
  }

  it("404s a food id from ANOTHER OWNED list, gear half valid, zero writes", async () => {
    const { cookie } = await signUpVerifiedUser('fp-parent-a@example.com', 'FP')
    const listA = await createList(cookie, 'A')
    const listB = await createList(cookie, 'B')
    const foodA = await createFood(cookie, listA.id, 'Oats A')
    const g1 = await createGearOnList(cookie, listB.id, 'G1')
    const g2 = await createGearOnList(cookie, listB.id, 'G2')
    const foodB = await createFood(cookie, listB.id, 'Oats B')
    const before = { a: await snapshot(cookie, listA.id), b: await snapshot(cookie, listB.id) }

    const res = await apiRequest(cookie, 'PUT', `/api/lists/${listB.id}/items/pack-order`, {
      items: [
        { id: g1.id, packSortOrder: g2.packSortOrder },
        { id: g2.id, packSortOrder: g1.packSortOrder },
      ],
      foodItems: [
        { id: foodB.id, packSortOrder: foodA.packSortOrder },
        { id: foodA.id, packSortOrder: foodB.packSortOrder },
      ],
    })
    expect(res.status).toBe(404)
    expect({ a: await snapshot(cookie, listA.id), b: await snapshot(cookie, listB.id) }).toEqual(before)
  })

  it("404s a NON-OWNER reordering food through the victim's own list, zero writes", async () => {
    const owner = await signUpVerifiedUser('fp-victim@example.com', 'FP')
    const other = await signUpVerifiedUser('fp-intruder@example.com', 'FP')
    const list = await createList(owner.cookie, 'Victim')
    const f1 = await createFood(owner.cookie, list.id, 'F1')
    const f2 = await createFood(owner.cookie, list.id, 'F2')
    const before = await snapshot(owner.cookie, list.id)

    const res = await apiRequest(other.cookie, 'PUT', `/api/lists/${list.id}/items/pack-order`, {
      items: [],
      foodItems: [
        { id: f1.id, packSortOrder: f2.packSortOrder },
        { id: f2.id, packSortOrder: f1.packSortOrder },
      ],
    })
    expect(res.status).toBe(404)
    expect(await snapshot(owner.cookie, list.id)).toEqual(before)
  })
})

describe('a full-cohort union reorder at the caps', () => {
  it('reorders 300 gear + 200 food rows in one request (chunked batch)', async () => {
    // A full-cohort reorder ships as chunked multi-row statements rather
    // than one statement per row (docs/incidents.md, the D1 section, on what
    // the per-invocation limit counts). This seeds a list AT both caps and
    // reverses the whole 500-row union - the payload shape the drag planner
    // actually submits for a worst-case drag.
    const { cookie } = await signUpVerifiedUser('cap1@example.com', 'CAP')
    const list = await createList(cookie, 'Everything')
    const me = await apiRequest(cookie, 'GET', '/api/me')
    const { id: userId } = (await me.json()) as { id: string }

    const gearValues = Array.from({ length: 300 }, (_, i) =>
      `('${userId}-g-${i}', '${userId}', 'Seed gear ${i}', 100, ${i}, 0, 0)`)
    for (let i = 0; i < gearValues.length; i += 50) {
      await env.DB.prepare(
        'insert into gear_items (id, user_id, name, weight_grams, sort_order, created_at, updated_at) values ' +
          gearValues.slice(i, i + 50).join(','),
      ).run()
    }
    const itemValues = Array.from({ length: 300 }, (_, i) =>
      `('${userId}-li-${i}', '${userId}', '${list.id}', '${userId}-g-${i}', 1, 0, 0, 0, 0, ${i}, ${i}, 0, 0)`)
    for (let i = 0; i < itemValues.length; i += 40) {
      await env.DB.prepare(
        'insert into list_items (id, user_id, list_id, gear_item_id, quantity, is_worn, is_consumable, is_packed, is_ready, sort_order, pack_sort_order, created_at, updated_at) values ' +
          itemValues.slice(i, i + 40).join(','),
      ).run()
    }
    const foodValues = Array.from({ length: 200 }, (_, i) =>
      `('${userId}-f-${i}', '${userId}', '${list.id}', 'Seed food ${i}', 100, 1, ${i}, 0, 0, ${300 + i}, 0, 0)`)
    for (let i = 0; i < foodValues.length; i += 40) {
      await env.DB.prepare(
        'insert into list_food_items (id, user_id, list_id, name, weight_grams, quantity, sort_order, is_packed, is_ready, pack_sort_order, created_at, updated_at) values ' +
          foodValues.slice(i, i + 40).join(','),
      ).run()
    }

    // Reverse the union: rank r -> 499 - r across both tables.
    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      {
        items: Array.from({ length: 300 }, (_, i) => ({
          id: `${userId}-li-${i}`,
          packSortOrder: 499 - i,
        })),
        foodItems: Array.from({ length: 200 }, (_, i) => ({
          id: `${userId}-f-${i}`,
          packSortOrder: 499 - (300 + i),
        })),
      },
    )
    expect(res.status).toBe(204)

    const foodRows = await getFoodItems(cookie, list.id)
    expect(foodRows.find((r) => r.id === `${userId}-f-0`)?.packSortOrder).toBe(199)
    expect(foodRows.find((r) => r.id === `${userId}-f-199`)?.packSortOrder).toBe(0)
    const itemsRes = await apiRequest(cookie, 'GET', `/api/lists/${list.id}/items`)
    const items = (await itemsRes.json()) as ItemBody[]
    expect(items.find((r) => r.id === `${userId}-li-0`)?.packSortOrder).toBe(499)
    expect(items.find((r) => r.id === `${userId}-li-299`)?.packSortOrder).toBe(200)
  })
})

describe('index-safety validation heals degraded rank states', () => {
  it('accepts a full-cohort dense renumber over a cross-table tie', async () => {
    // A degraded old-worker interval can leave a food row tied with a gear
    // row at the same rank (legal per the per-table indexes). A strict
    // multiset permutation PRESERVES the tie forever; the index-safety rule
    // accepts the dense renumber the client sends instead, which is what
    // heals it.
    const { cookie } = await signUpVerifiedUser('tie1@example.com', 'TIE')
    const list = await createList(cookie, 'Trip')
    const me = await apiRequest(cookie, 'GET', '/api/me')
    const { id: userId } = (await me.json()) as { id: string }
    await env.DB.prepare(
      `insert into gear_items (id, user_id, name, weight_grams, sort_order, created_at, updated_at) values ('${userId}-tg', '${userId}', 'Stove', 100, 0, 0, 0)`,
    ).run()
    await env.DB.prepare(
      `insert into list_items (id, user_id, list_id, gear_item_id, quantity, is_worn, is_consumable, is_packed, is_ready, sort_order, pack_sort_order, created_at, updated_at) values ('${userId}-tli', '${userId}', '${list.id}', '${userId}-tg', 1, 0, 0, 0, 0, 0, 0, 0, 0)`,
    ).run()
    // The TIE: food also at rank 0 in the same (Unassigned) cohort.
    await env.DB.prepare(
      `insert into list_food_items (id, user_id, list_id, name, weight_grams, quantity, sort_order, is_packed, is_ready, pack_sort_order, created_at, updated_at) values ('${userId}-tf', '${userId}', '${list.id}', 'Oats', 100, 1, 0, 0, 0, 0, 0, 0)`,
    ).run()

    // Dense full-cohort renumber: food first (0), gear second (1). Not a
    // permutation of the union multiset {0, 0} - exactly the payload the old
    // rule rejected.
    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      {
        items: [{ id: `${userId}-tli`, packSortOrder: 1 }],
        foodItems: [{ id: `${userId}-tf`, packSortOrder: 0 }],
      },
    )
    expect(res.status).toBe(204)
    const [foodRow] = await getFoodItems(cookie, list.id)
    expect(foodRow?.packSortOrder).toBe(0)
    const itemsRes = await apiRequest(cookie, 'GET', `/api/lists/${list.id}/items`)
    const items = (await itemsRes.json()) as ItemBody[]
    expect(items[0]?.packSortOrder).toBe(1)
  })

  it('still rejects a payload that would land on an untouched row of the same table', async () => {
    const { cookie } = await signUpVerifiedUser('tie2@example.com', 'TIE')
    const list = await createList(cookie, 'Trip')
    const a = await createGearOnList(cookie, list.id, 'Stove')
    await createGearOnList(cookie, list.id, 'Pot')

    // Move gear A onto gear B's rank WITHOUT touching B: per-table collision
    // with an outside row - the exact write the unique index would reject.
    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      [{ id: a.id, packSortOrder: a.packSortOrder + 1 }],
    )
    expect(res.status).toBe(400)
  })
})

describe('location deletion near the rank ceiling', () => {
  it('falls back to a dense renumber instead of wedging the delete', async () => {
    // An Unassigned gear row near the rank ceiling: PUT pack-order accepts
    // any free rank up to PACK_RANK_MAX. The append path would need ranks
    // past PACK_RANK_MAX and 422 forever; the dense fallback renumbers the
    // merged cohort and the delete succeeds.
    const { cookie } = await signUpVerifiedUser('ceil1@example.com', 'CL')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Bag')
    const me = await apiRequest(cookie, 'GET', '/api/me')
    const { id: userId } = (await me.json()) as { id: string }
    await env.DB.prepare(
      `insert into gear_items (id, user_id, name, weight_grams, sort_order, created_at, updated_at) values ('${userId}-cg', '${userId}', 'Legacy', 100, 0, 0, 0)`,
    ).run()
    await env.DB.prepare(
      `insert into list_items (id, user_id, list_id, gear_item_id, quantity, is_worn, is_consumable, is_packed, is_ready, sort_order, pack_sort_order, created_at, updated_at) values ('${userId}-cli', '${userId}', '${list.id}', '${userId}-cg', 1, 0, 0, 0, 0, 0, 999999700, 0, 0)`,
    ).run()
    // 299 bag gear rows (the 300-item list cap minus the legacy row) plus
    // TWO food rows = 301 orphans: appended from 999999701 they would end
    // past PACK_RANK_MAX, which is what forces the fallback (300 orphans
    // would end exactly AT the ceiling and still fit).
    const bagGearValues = Array.from({ length: 299 }, (_, i) =>
      `('${userId}-bg-${i}', '${userId}', 'Bag gear ${i}', 100, ${i + 1}, 0, 0)`)
    for (let i = 0; i < bagGearValues.length; i += 50) {
      await env.DB.prepare(
        'insert into gear_items (id, user_id, name, weight_grams, sort_order, created_at, updated_at) values ' +
          bagGearValues.slice(i, i + 50).join(','),
      ).run()
    }
    const bagItemValues = Array.from({ length: 299 }, (_, i) =>
      `('${userId}-bli-${i}', '${userId}', '${list.id}', '${userId}-bg-${i}', 1, 0, 0, 0, 0, ${i + 1}, ${i}, 0, 0)`)
    for (let i = 0; i < bagItemValues.length; i += 40) {
      await env.DB.prepare(
        'insert into list_items (id, user_id, list_id, gear_item_id, quantity, is_worn, is_consumable, is_packed, is_ready, sort_order, pack_sort_order, created_at, updated_at) values ' +
          bagItemValues.slice(i, i + 40).join(','),
      ).run()
    }
    await env.DB.prepare(
      `update list_items set packing_location_id = '${location.id}' where user_id = '${userId}' and id like '${userId}-bli-%'`,
    ).run()
    const food = await createFood(cookie, list.id, 'Oats')
    await patchFood(cookie, list.id, food.id, { packingLocationId: location.id })
    const food2 = await createFood(cookie, list.id, 'Bars')
    await patchFood(cookie, list.id, food2.id, { packingLocationId: location.id })

    const del = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/packing-locations/${location.id}`,
    )
    expect(del.status).toBe(204)

    // Everything is back in Unassigned with small dense ranks - including
    // the legacy row.
    const itemsRes = await apiRequest(cookie, 'GET', `/api/lists/${list.id}/items`)
    const items = (await itemsRes.json()) as ItemBody[]
    for (const row of items) expect(row.packSortOrder).toBeLessThan(400)
    const [foodRow] = await getFoodItems(cookie, list.id)
    expect(foodRow?.packingLocationId).toBeNull()
    expect(foodRow?.packSortOrder).toBeLessThan(400)
  })
})

describe('reset-packed spans the union', () => {
  it('clears packed on gear AND food in one reset', async () => {
    const { cookie } = await signUpVerifiedUser('rs1@example.com', 'RS')
    const list = await createList(cookie, 'Trip')
    const gear = await createGearOnList(cookie, list.id, 'Stove')
    const food = await createFood(cookie, list.id, 'Oats')
    await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${gear.id}`, {
      isPacked: true,
    })
    await patchFood(cookie, list.id, food.id, { isPacked: true })

    const res = await apiRequest(
      cookie,
      'POST',
      `/api/lists/${list.id}/items/reset-packed`,
    )
    expect(res.status).toBe(204)

    const [foodRow] = await getFoodItems(cookie, list.id)
    expect(foodRow?.isPacked).toBe(false)
  })
})

describe('location deletion returns food to Unassigned', () => {
  it('appends the bag contents after the union maximum, order preserved', async () => {
    const { cookie } = await signUpVerifiedUser('ld1@example.com', 'LD')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Bag')
    // Unassigned holds one gear row; the bag holds gear then food.
    const stays = await createGearOnList(cookie, list.id, 'Tarp')
    const bagGear = await createGearOnList(cookie, list.id, 'Stove')
    await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}/items/${bagGear.id}`, {
      packingLocationId: location.id,
    })
    const food = await createFood(cookie, list.id, 'Oats')
    await patchFood(cookie, list.id, food.id, {
      packingLocationId: location.id,
    })

    const del = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/packing-locations/${location.id}`,
    )
    expect(del.status).toBe(204)

    const [foodRow] = await getFoodItems(cookie, list.id)
    expect(foodRow?.packingLocationId).toBeNull()
    // The bag (gear at bag-rank 0, food after it) landed as a block after
    // the Unassigned survivor, in the bag's order: gear, then food.
    const itemsRes = await apiRequest(cookie, 'GET', `/api/lists/${list.id}/items`)
    const items = (await itemsRes.json()) as ItemBody[]
    const movedGear = items.find((row) => row.id === bagGear.id)
    expect(movedGear?.packSortOrder).toBeGreaterThan(stays.packSortOrder)
    expect(foodRow?.packSortOrder).toBeGreaterThan(movedGear?.packSortOrder ?? Infinity)
  })
})

describe('duplicate copies food pack state', () => {
  it('keeps packed flags and remaps the location', async () => {
    const { cookie } = await signUpVerifiedUser('dp1@example.com', 'DP')
    const list = await createList(cookie, 'Trip')
    const location = await createLocation(cookie, list.id, 'Bag')
    const food = await createFood(cookie, list.id, 'Oats')
    await patchFood(cookie, list.id, food.id, {
      packingLocationId: location.id,
      isPacked: true,
    })
    await patchFood(cookie, list.id, food.id, { isReady: true })

    const dup = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/duplicate`)
    expect(dup.status).toBe(201)
    const copy = (await dup.json()) as ListBody

    const [copiedFood] = await getFoodItems(cookie, copy.id)
    expect(copiedFood?.isPacked).toBe(true)
    // Ready state copies too (GATE 2 caught the original dropping it).
    expect(copiedFood?.isReady).toBe(true)
    expect(copiedFood?.packingLocationId).not.toBeNull()
    expect(copiedFood?.packingLocationId).not.toBe(location.id)
  })
})

// The database-level guards on list_food_items, exercised directly. The API
// validates first, so the route tests above never reach these triggers and
// indexes; they are the backstop for any writer that skips the API. Until
// 2026-09 they were probed only inside the migration harness, as a side
// effect of replaying migrations 0022-0024 - tests of the CURRENT schema
// belong here instead.
describe('list_food_items guards below the API', () => {
  type FoodRow = {
    id: string
    listId: string
    locationId?: string | null
    rank: number
    isPerMeal?: number | null
  }

  async function ownerWithTwoLists(email: string) {
    const { cookie } = await signUpVerifiedUser(email, 'G')
    const me = await apiRequest(cookie, 'GET', '/api/me')
    const { id: userId } = (await me.json()) as { id: string }
    const list = await createList(cookie, 'Trip')
    const otherList = await createList(cookie, 'Other trip')
    const location = await createLocation(cookie, list.id, 'Bag')
    return { cookie, userId, list, otherList, location }
  }

  function insertFood(userId: string, row: FoodRow) {
    return env.DB.prepare(
      'insert into list_food_items (id, user_id, list_id, name, weight_grams, quantity, is_per_meal, sort_order, is_packed, is_ready, packing_location_id, pack_sort_order, created_at, updated_at) values (?, ?, ?, ?, 100, 1, ?, 0, 0, 0, ?, ?, 0, 0)',
    )
      .bind(
        row.id,
        userId,
        row.listId,
        row.id,
        row.isPerMeal === undefined ? 1 : row.isPerMeal,
        row.locationId ?? null,
        row.rank,
      )
      .run()
  }

  function setRank(id: string, rank: number) {
    return env.DB.prepare('update list_food_items set pack_sort_order = ? where id = ?')
      .bind(rank, id)
      .run()
  }

  it("refuses a location that is not on the food's own list", async () => {
    const { userId, list, otherList, location } = await ownerWithTwoLists('fg-loc@example.com')

    // Another of the SAME user's lists: ownership alone would allow it.
    await expect(
      insertFood(userId, { id: `${userId}-x`, listId: otherList.id, locationId: location.id, rank: 0 }),
    ).rejects.toThrow(/packing location does not belong to this list/)
    await expect(
      insertFood(userId, { id: `${userId}-y`, listId: list.id, locationId: 'nonexistent', rank: 0 }),
    ).rejects.toThrow(/packing location does not belong to this list/)

    await insertFood(userId, { id: `${userId}-z`, listId: otherList.id, rank: 0 })
    await expect(
      env.DB.prepare('update list_food_items set packing_location_id = ? where id = ?')
        .bind(location.id, `${userId}-z`)
        .run(),
    ).rejects.toThrow(/packing location does not belong to this list/)
  })

  it('refuses a duplicate rank within a cohort, and only within it', async () => {
    const { userId, list, location } = await ownerWithTwoLists('fg-dup@example.com')

    await insertFood(userId, { id: `${userId}-u1`, listId: list.id, rank: 5 })
    await expect(
      insertFood(userId, { id: `${userId}-u2`, listId: list.id, rank: 5 }),
    ).rejects.toThrow(/UNIQUE constraint failed/)

    // The same rank in a DIFFERENT cohort (a location) is fine...
    await insertFood(userId, { id: `${userId}-l1`, listId: list.id, locationId: location.id, rank: 5 })
    // ...but not twice inside that location.
    await expect(
      insertFood(userId, { id: `${userId}-l2`, listId: list.id, locationId: location.id, rank: 5 }),
    ).rejects.toThrow(/UNIQUE constraint failed/)
  })

  it('INSERT accepts only 0..PACK_RANK_MAX', async () => {
    const { userId, list } = await ownerWithTwoLists('fg-insert@example.com')

    await expect(
      insertFood(userId, { id: `${userId}-neg`, listId: list.id, rank: -1 }),
    ).rejects.toThrow(/food pack_sort_order out of range \(0\.\.1000000000\)/)
    await expect(
      insertFood(userId, { id: `${userId}-over`, listId: list.id, rank: PACK_RANK_MAX + 1 }),
    ).rejects.toThrow(/food pack_sort_order out of range \(0\.\.1000000000\)/)
    await insertFood(userId, { id: `${userId}-max`, listId: list.id, rank: PACK_RANK_MAX })
  })

  it('UPDATE also allows the -FOOD_ITEM_CAP scratch band that parking uses', async () => {
    const { userId, list } = await ownerWithTwoLists('fg-update@example.com')
    const id = `${userId}-row`
    await insertFood(userId, { id, listId: list.id, rank: 0 })

    await setRank(id, -FOOD_ITEM_CAP)
    await expect(setRank(id, -FOOD_ITEM_CAP - 1)).rejects.toThrow(
      /food pack_sort_order out of range \(-200\.\.1000000000\)/,
    )
    await expect(setRank(id, PACK_RANK_MAX + 1)).rejects.toThrow(
      /food pack_sort_order out of range \(-200\.\.1000000000\)/,
    )
  })

  it('a raw location delete returns its food to Unassigned, after the food maximum', async () => {
    // packing_locations_rerank_food_orphans. The DELETE route reranks food
    // itself before removing the location, so only a direct delete reaches
    // the trigger. The bag's rows keep their relative order, offset past the
    // Unassigned food maximum.
    const { userId, list, location } = await ownerWithTwoLists('fg-orphan@example.com')
    await insertFood(userId, { id: `${userId}-u0`, listId: list.id, rank: 0 })
    await insertFood(userId, { id: `${userId}-u1`, listId: list.id, rank: 3 })
    await insertFood(userId, { id: `${userId}-b0`, listId: list.id, locationId: location.id, rank: 0 })
    await insertFood(userId, { id: `${userId}-b1`, listId: list.id, locationId: location.id, rank: 2 })

    await env.DB.prepare('delete from packing_locations where id = ?').bind(location.id).run()

    const { results } = await env.DB.prepare(
      'select id, packing_location_id as loc, pack_sort_order as rank from list_food_items where list_id = ? order by id',
    )
      .bind(list.id)
      .all()
    expect(results).toEqual([
      { id: `${userId}-b0`, loc: null, rank: 4 },
      { id: `${userId}-b1`, loc: null, rank: 6 },
      { id: `${userId}-u0`, loc: null, rank: 0 },
      { id: `${userId}-u1`, loc: null, rank: 3 },
    ])
  })

  it('near the rank ceiling, a raw location delete renumbers densely instead', async () => {
    // Appending past an Unassigned row AT PACK_RANK_MAX would overflow the
    // range, so the trigger falls back to renumbering Unassigned then the bag
    // from 0.
    const { userId, list, location } = await ownerWithTwoLists('fg-orphan-ceil@example.com')
    await insertFood(userId, { id: `${userId}-u0`, listId: list.id, rank: PACK_RANK_MAX })
    await insertFood(userId, { id: `${userId}-b0`, listId: list.id, locationId: location.id, rank: 0 })
    await insertFood(userId, { id: `${userId}-b1`, listId: list.id, locationId: location.id, rank: 1 })

    await env.DB.prepare('delete from packing_locations where id = ?').bind(location.id).run()

    const { results } = await env.DB.prepare(
      'select id, packing_location_id as loc, pack_sort_order as rank from list_food_items where list_id = ? order by id',
    )
      .bind(list.id)
      .all()
    expect(results).toEqual([
      { id: `${userId}-b0`, loc: null, rank: 1 },
      { id: `${userId}-b1`, loc: null, rank: 2 },
      { id: `${userId}-u0`, loc: null, rank: 0 },
    ])
  })

  it('refuses a row whose is_per_meal is NULL', async () => {
    // 0024 made the flag mandatory so no food row is ever weighed under an
    // unstated assumption about what its quantity means.
    const { userId, list } = await ownerWithTwoLists('fg-mode@example.com')
    await expect(
      insertFood(userId, { id: `${userId}-null`, listId: list.id, rank: 0, isPerMeal: null }),
    ).rejects.toThrow(/NOT NULL constraint failed: list_food_items\.is_per_meal/)
  })
})
