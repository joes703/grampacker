import { describe, expect, it } from 'vitest'
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

  it('rejects a non-permutation of the union with 400', async () => {
    const { cookie } = await signUpVerifiedUser('up4@example.com', 'UP')
    const list = await createList(cookie, 'Trip')
    const food = await createFood(cookie, list.id, 'Oats')

    const res = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/items/pack-order`,
      { foodItems: [{ id: food.id, packSortOrder: food.packSortOrder + 7 }] },
    )
    expect(res.status).toBe(400)
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
    // the Unassigned survivor - so food's final rank clears both.
    expect(foodRow?.packSortOrder).toBeGreaterThan(stays.packSortOrder)
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

    const dup = await apiRequest(cookie, 'POST', `/api/lists/${list.id}/duplicate`)
    expect(dup.status).toBe(201)
    const copy = (await dup.json()) as ListBody

    const [copiedFood] = await getFoodItems(cookie, copy.id)
    expect(copiedFood?.isPacked).toBe(true)
    expect(copiedFood?.packingLocationId).not.toBeNull()
    expect(copiedFood?.packingLocationId).not.toBe(location.id)
  })
})
