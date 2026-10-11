import { describe, expect, it } from 'vitest'
import app from '../index'
import { env, testDb } from '../test/node-env'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'
import type { ListFoodResponse, FoodItemResponse } from '../../shared/food'

// The food estimate. These tests are weighted toward the invariants that would
// silently produce a WRONG PACK WEIGHT or let one list reach into another,
// because those are the failures a user would not notice.

type ListBody = { id: string }

async function createList(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
  expect(res.status).toBe(201)
  return ((await res.json()) as ListBody).id
}

async function getFood(cookie: string, listId: string): Promise<ListFoodResponse> {
  const res = await apiRequest(cookie, 'GET', `/api/lists/${listId}/food`)
  expect(res.status).toBe(200)
  return (await res.json()) as ListFoodResponse
}

async function setDays(cookie: string, listId: string, days: number) {
  return apiRequest(cookie, 'PUT', `/api/lists/${listId}/food/days`, { days })
}

async function addItem(
  cookie: string,
  listId: string,
  body: {
    name: string
    weightGrams: number
    quantity: number
    isPerMeal?: boolean
    slotIds: string[]
  },
): Promise<Response> {
  return apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, body)
}

const slotOf = (food: ListFoodResponse, day: number, meal: string) =>
  food.slots.find((s) => s.dayNumber === day && s.meal === meal)!

describe('food: day grid', () => {
  it('keeps slot ids, and so placements, when the same day count is re-entered', async () => {
    // Re-entering the same number must be a no-op. The id is the load-bearing
    // part: delete-and-reinsert would take every association with it, so a
    // stray edit to the days box would silently unschedule the whole trip.
    const { cookie } = await signUpVerifiedUser('food-2@example.com', 'F2')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 5)

    const before = await getFood(cookie, listId)
    const day1Breakfast = slotOf(before, 1, 'breakfast')
    await addItem(cookie, listId, {
      name: 'Oatmeal',
      weightGrams: 80,
      quantity: 1,
      slotIds: [day1Breakfast.id],
    })

    await setDays(cookie, listId, 5)

    const after = await getFood(cookie, listId)
    expect(slotOf(after, 1, 'breakfast').id).toBe(day1Breakfast.id)
    expect(after.items).toHaveLength(1)
    expect(after.items[0]!.slotIds).toEqual([day1Breakfast.id])
  })

  it('repairs a hole rather than reading only the highest day', async () => {
    // A hole can form: setDayCount reads the slots outside its batch, so a
    // grow racing a shrink can leave middle days missing. The race is cut
    // here in D1 directly: day 3 goes, days 4 and 5 stay.
    const { cookie } = await signUpVerifiedUser('food-3@example.com', 'F3')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 5)
    await testDb.prepare('delete from list_food_slots where list_id = ? and day_number = 3')
      .bind(listId)
      .run()
    expect((await getFood(cookie, listId)).slots).toHaveLength(12)

    expect((await setDays(cookie, listId, 5)).status).toBe(200)

    const food = await getFood(cookie, listId)
    expect(food.slots).toHaveLength(15)
    for (const meal of ['breakfast', 'lunch', 'dinner']) {
      expect(slotOf(food, 3, meal), meal).toBeDefined()
    }
  })

  it('trims beyond the new count', async () => {
    const { cookie } = await signUpVerifiedUser('food-4@example.com', 'F4')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 5)
    await setDays(cookie, listId, 3)

    const food = await getFood(cookie, listId)
    expect(food.dayCount).toBe(3)
    expect(food.slots).toHaveLength(9)
  })

  it('handles a full 30-day trip in one write', async () => {
    // 90 slots x 8 columns is ~720 bound params; D1 caps a statement at 100,
    // including inside a batch. This fails without chunkForParamCap.
    const { cookie } = await signUpVerifiedUser('food-5@example.com', 'F5')
    const listId = await createList(cookie, 'Thru hike')

    expect((await setDays(cookie, listId, 30)).status).toBe(200)
    const food = await getFood(cookie, listId)
    expect(food.dayCount).toBe(30)
    expect(food.slots).toHaveLength(90)
    for (const meal of ['breakfast', 'lunch', 'dinner']) {
      expect(food.slots.filter((s) => s.meal === meal), meal).toHaveLength(30)
    }
  })

  it('rejects a trip longer than the cap', async () => {
    const { cookie } = await signUpVerifiedUser('food-6@example.com', 'F6')
    const listId = await createList(cookie, 'Trip')
    expect((await setDays(cookie, listId, 31)).status).toBe(400)
  })
})

describe('food: quantity is what you typed, unitCount is what you carry', () => {
  it('counts one SHARED bag associated with five slots exactly once', async () => {
    // One 500 g bag of trail mix picked at across five lunches weighs 500 g.
    // Since 0024 that is a MODE (isPerMeal: false), not the only reading: a
    // shared stash is ONE row with five associations, and its published
    // carry count ignores the schedule. Summing per placement, or multiplying
    // a shared stash by its meals, would say 2500.
    const { cookie } = await signUpVerifiedUser('food-7@example.com', 'F7')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 5)
    const food = await getFood(cookie, listId)
    const lunches = food.slots.filter((s) => s.meal === 'lunch').map((s) => s.id)
    expect(lunches).toHaveLength(5)

    const res = await addItem(cookie, listId, {
      name: 'Trail mix',
      weightGrams: 500,
      quantity: 1,
      isPerMeal: false,
      slotIds: lunches,
    })
    expect(res.status).toBe(201)

    const after = await getFood(cookie, listId)
    expect(after.items).toHaveLength(1)
    expect(after.items[0]!.isPerMeal).toBe(false)
    expect(after.items[0]!.quantity).toBe(1)
    expect(after.items[0]!.slotIds).toHaveLength(5)
    // unitCount is the carry count every surface sums; quantity is not.
    expect(after.items[0]!.unitCount).toBe(1)
    const total = after.items.reduce((g, i) => g + i.weightGrams * i.unitCount, 0)
    expect(total).toBe(500)
  })

  it('rejects a fractional quantity at the boundary', async () => {
    const { cookie } = await signUpVerifiedUser('food-9@example.com', 'F9')
    const listId = await createList(cookie, 'Trip')
    const res = await addItem(cookie, listId, {
      name: 'Half a bag',
      weightGrams: 500,
      quantity: 1.5,
      slotIds: [],
    })
    expect(res.status).toBe(400)
  })
})

describe('food: ownership and list scoping', () => {
  it('404s another user\'s list', async () => {
    const owner = await signUpVerifiedUser('food-12@example.com', 'F12')
    const other = await signUpVerifiedUser('food-13@example.com', 'F13')
    const listId = await createList(owner.cookie, 'Mine')
    await setDays(owner.cookie, listId, 2)

    const res = await apiRequest(other.cookie, 'GET', `/api/lists/${listId}/food`)
    expect(res.status).toBe(404)
    expect((await setDays(other.cookie, listId, 5)).status).toBe(404)
  })

  it('refuses to stitch an item on one list to a slot on another', async () => {
    // Same owner, two lists. The slot id is real and belongs to this user - only
    // the LIST is wrong, which is exactly the case a same-owner check misses.
    const { cookie } = await signUpVerifiedUser('food-14@example.com', 'F14')
    const listA = await createList(cookie, 'A')
    const listB = await createList(cookie, 'B')
    await setDays(cookie, listA, 2)
    await setDays(cookie, listB, 2)
    const foodB = await getFood(cookie, listB)

    const res = await addItem(cookie, listA, {
      name: 'Smuggled',
      weightGrams: 100,
      quantity: 1,
      slotIds: [slotOf(foodB, 1, 'breakfast').id],
    })
    expect(res.status).toBe(400)
  })

})

// The matrix rule (docs/authz-matrix.md): owner / non-owner / anon for every
// route, plus wrong-parent stitching for a child resource - and a status alone
// proves nothing, so every refusal below is paired with a raw-row snapshot of
// the victim list taken through D1 directly (no user predicate), compared
// byte-for-byte after the request.
describe('food: the matrix cells a status alone would not prove', () => {
  async function foodRows(listId: string) {
    const items = await testDb.prepare(
      'select * from list_food_items where list_id = ? order by id',
    )
      .bind(listId)
      .all()
    const links = await testDb.prepare(
      'select * from list_food_item_slots where list_id = ? order by food_item_id, slot_id',
    )
      .bind(listId)
      .all()
    return { items: items.results, links: links.results }
  }

  async function scheduledItem(cookie: string, listId: string) {
    await setDays(cookie, listId, 2)
    const food = await getFood(cookie, listId)
    const res = await addItem(cookie, listId, {
      name: 'Oats',
      weightGrams: 90,
      quantity: 2,
      slotIds: [slotOf(food, 1, 'breakfast').id],
    })
    expect(res.status).toBe(201)
    return { item: (await res.json()) as FoodItemResponse, food }
  }

  it('a: a non-owner cannot create an item on the victim list (404, no row)', async () => {
    const owner = await signUpVerifiedUser('food-m1@example.com', 'M1')
    const other = await signUpVerifiedUser('food-m2@example.com', 'M2')
    const listId = await createList(owner.cookie, 'Mine')
    await scheduledItem(owner.cookie, listId)
    const before = await foodRows(listId)

    const res = await addItem(other.cookie, listId, {
      name: 'Smuggled',
      weightGrams: 100,
      quantity: 1,
      slotIds: [],
    })
    expect(res.status).toBe(404)
    expect(await foodRows(listId)).toEqual(before)
  })

  it('b: a non-owner cannot delete the victim item (404, row and placements intact)', async () => {
    const owner = await signUpVerifiedUser('food-m3@example.com', 'M3')
    const other = await signUpVerifiedUser('food-m4@example.com', 'M4')
    const listId = await createList(owner.cookie, 'Mine')
    const { item } = await scheduledItem(owner.cookie, listId)
    const before = await foodRows(listId)
    expect(before.links).toHaveLength(1)

    const res = await apiRequest(
      other.cookie,
      'DELETE',
      `/api/lists/${listId}/food/items/${item.id}`,
    )
    expect(res.status).toBe(404)
    expect(await foodRows(listId)).toEqual(before)
  })

  it("c: an item cannot be patched or deleted through another of the SAME user's lists", async () => {
    const { cookie } = await signUpVerifiedUser('food-m5@example.com', 'M5')
    const listA = await createList(cookie, 'A')
    const listB = await createList(cookie, 'B')
    const { item } = await scheduledItem(cookie, listA)
    await setDays(cookie, listB, 1)
    const before = { a: await foodRows(listA), b: await foodRows(listB) }

    const patch = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${listB}/food/items/${item.id}`,
      { quantity: 9 },
    )
    expect(patch.status).toBe(404)
    expect({ a: await foodRows(listA), b: await foodRows(listB) }).toEqual(before)

    const del = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${listB}/food/items/${item.id}`,
    )
    expect(del.status).toBe(404)
    expect({ a: await foodRows(listA), b: await foodRows(listB) }).toEqual(before)
  })

  it('d: a PATCH naming a foreign slot is refused whole - existing placements survive', async () => {
    // Two foreign shapes, run separately: another user's slot, and a slot on
    // another of the caller's own lists. Each request also carries a scalar
    // change and a VALID local slot, so a partial application would show.
    const owner = await signUpVerifiedUser('food-m6@example.com', 'M6')
    const other = await signUpVerifiedUser('food-m7@example.com', 'M7')
    const listId = await createList(owner.cookie, 'Mine')
    const { item, food } = await scheduledItem(owner.cookie, listId)
    const localLunch = slotOf(food, 1, 'lunch').id

    const otherList = await createList(other.cookie, 'Theirs')
    await setDays(other.cookie, otherList, 1)
    const foreignSlot = slotOf(await getFood(other.cookie, otherList), 1, 'dinner').id

    const ownOtherList = await createList(owner.cookie, 'Mine too')
    await setDays(owner.cookie, ownOtherList, 1)
    const crossListSlot = slotOf(await getFood(owner.cookie, ownOtherList), 1, 'dinner').id

    const before = await foodRows(listId)
    expect(before.links).toHaveLength(1)
    for (const smuggled of [foreignSlot, crossListSlot]) {
      const res = await apiRequest(
        owner.cookie,
        'PATCH',
        `/api/lists/${listId}/food/items/${item.id}`,
        { quantity: 5, slotIds: [localLunch, smuggled] },
      )
      expect(res.status, smuggled).toBe(400)
      expect(await foodRows(listId), smuggled).toEqual(before)
    }
  })
})

// Food is gated by the ONE hoisted api.use('/lists/*') in server/index.ts.
// session-gate.test.ts proves the anonymous 401 on every food route; these
// prove the CSRF layer still answers first.
describe('/api/lists/:id/food authorization', () => {
  it('allows GET without the CSRF header but rejects every write with 403', async () => {
    // 403-before-401 layering: CSRF is checked ahead of the session, so these
    // run WITH a valid session and still 403 - proving the hoisted session
    // gate sits behind the CSRF layer, not in front of it.
    const { cookie } = await signUpVerifiedUser('food-csrf@example.com', 'FC')
    const listId = await createList(cookie, 'Trip')

    const requestWithoutCsrf = (method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = {
        Cookie: cookie,
        Origin: 'http://localhost:5173',
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      return app.request(
        path,
        {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      )
    }

    // The ordering proof: NO session and NO header answers 403, not 401 -
    // only a CSRF layer that runs BEFORE the session gate can produce that.
    const anonNoHeader = await app.request(
      `/api/lists/${listId}/food/days`,
      {
        method: 'PUT',
        headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 2 }),
      },
      env,
    )
    expect(anonNoHeader.status).toBe(403)

    expect((await requestWithoutCsrf('GET', `/api/lists/${listId}/food`)).status).toBe(200)
    for (const [method, path, body] of [
      ['PUT', `/api/lists/${listId}/food/days`, { days: 2 }],
      ['POST', `/api/lists/${listId}/food/items`, { name: 'X', weightGrams: 1, quantity: 1, slotIds: [] }],
      ['PATCH', `/api/lists/${listId}/food/items/item`, { name: 'X' }],
      ['DELETE', `/api/lists/${listId}/food/items/item`, undefined],
    ] as const) {
      expect(
        (await requestWithoutCsrf(method, path, body)).status,
        `${method} ${path}`,
      ).toBe(403)
    }
  })
})

describe('food: item updates', () => {
  it('treats omitted slotIds as unchanged and [] as unscheduled', async () => {
    const { cookie } = await signUpVerifiedUser('food-17@example.com', 'F17')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 2)
    const food = await getFood(cookie, listId)
    const breakfast = slotOf(food, 1, 'breakfast')

    const created = (await (
      await addItem(cookie, listId, {
        name: 'Oatmeal',
        weightGrams: 80,
        quantity: 1,
        slotIds: [breakfast.id],
      })
    ).json()) as FoodItemResponse

    const renamed = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${listId}/food/items/${created.id}`,
      { name: 'Porridge' },
    )
    expect(renamed.status).toBe(200)
    expect(((await renamed.json()) as FoodItemResponse).slotIds).toEqual([breakfast.id])

    const unscheduled = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${listId}/food/items/${created.id}`,
      { slotIds: [] },
    )
    expect(((await unscheduled.json()) as FoodItemResponse).slotIds).toEqual([])
  })

  it('deletes an item and its associations', async () => {
    const { cookie } = await signUpVerifiedUser('food-18@example.com', 'F18')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 2)
    const food = await getFood(cookie, listId)

    const created = (await (
      await addItem(cookie, listId, {
        name: 'Bar',
        weightGrams: 60,
        quantity: 2,
        slotIds: [slotOf(food, 1, 'lunch').id],
      })
    ).json()) as FoodItemResponse
    // The links go by FK cascade. GET reads links only through items, so an
    // orphaned link would never show in the response: count the rows.
    const linkCount = async () =>
      (
        await testDb.prepare(
          'select count(*) as n from list_food_item_slots where food_item_id = ?',
        )
          .bind(created.id)
          .first<{ n: number }>()
      )?.n
    expect(await linkCount()).toBe(1)

    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${listId}/food/items/${created.id}`,
    )
    expect(res.status).toBe(204)
    expect((await getFood(cookie, listId)).items).toHaveLength(0)
    expect(await linkCount()).toBe(0)
  })
})

describe('food: list duplication', () => {
  it('deep-copies the food graph without multiplying its weight', async () => {
    // duplicate() calls itself a deep copy. Omitting food would make that a
    // lie; copying per ASSOCIATION would make the duplicate weigh 5x.
    const { cookie } = await signUpVerifiedUser('food-dup@example.com', 'FD')
    const listId = await createList(cookie, 'Original')
    await setDays(cookie, listId, 5)
    const food = await getFood(cookie, listId)
    const lunches = food.slots.filter((s) => s.meal === 'lunch').map((s) => s.id)
    // SHARED, and that is the point of this fixture: one bag across five
    // lunches. A duplicate that dropped isPerMeal would take the column
    // default, turn the copy per-meal, and weigh it 2500 g.
    await addItem(cookie, listId, {
      name: 'Trail mix',
      weightGrams: 500,
      quantity: 1,
      isPerMeal: false,
      slotIds: lunches,
    })

    const dup = await apiRequest(cookie, 'POST', `/api/lists/${listId}/duplicate`)
    expect(dup.status).toBe(201)
    const copyId = ((await dup.json()) as ListBody).id

    const copied = await getFood(cookie, copyId)
    expect(copied.slots).toHaveLength(15)
    // ONE item, five associations, 500 g - not five items and not 2500 g.
    expect(copied.items).toHaveLength(1)
    expect(copied.items[0]!.slotIds).toHaveLength(5)
    expect(copied.items[0]!.isPerMeal).toBe(false)
    expect(copied.items[0]!.unitCount).toBe(1)
    const total = copied.items.reduce((g, i) => g + i.weightGrams * i.unitCount, 0)
    expect(total).toBe(500)
    // Fresh ids: editing the copy must not touch the original. Read the
    // ORIGINAL again rather than reusing the pre-add snapshot - `food` was
    // fetched before the item existed, so comparing against it asserted only
    // that an id is not undefined.
    const original = await getFood(cookie, listId)
    expect(original.items).toHaveLength(1)
    expect(copied.items[0]!.id).not.toBe(original.items[0]!.id)
  })
})

describe('food crosses the public share boundary as rows, and the plan does not', () => {
  it('publishes each food item once, and no trace of when it is eaten', async () => {
    // The contract has changed twice. It began as "no food whatsoever", which
    // contradicted the owner's own view - their total counted food, so a share
    // of the same list reported a lighter pack. 2026-08-10 published one
    // aggregate. 2026-08-11 published the rows: food you carry is part of the
    // pack you are showing someone.
    //
    // The line that did NOT move is the one this test defends. What crosses is
    // the ITEM - what it is, how many, how heavy. What does not is the PLAN -
    // which day, which meal, whether it is packed. Everything after the setup
    // below exists to prove that second half.
    //
    // The projection is field-by-field, so this asserts the EXACT key set of
    // the raw JSON rather than banning names someone thought of: a `slotIds`
    // array would slip past a deny-list.
    const { cookie } = await signUpVerifiedUser('food-share@example.com', 'FS')
    const listId = await createList(cookie, 'Shared trip')

    // A real gear row, so the items loop below actually runs. Without one
    // raw.items is empty and the per-item assertion passes vacuously.
    const cat = await apiRequest(cookie, 'POST', '/api/categories', { name: 'Shelter' })
    const categoryId = ((await cat.json()) as { id: string }).id
    const gear = await apiRequest(cookie, 'POST', '/api/gear-items', {
      name: 'Tarp',
      weightGrams: 400,
      categoryId,
    })
    const gearItemId = ((await gear.json()) as { id: string }).id
    await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, { gearItemId })

    await setDays(cookie, listId, 3)
    const food = await getFood(cookie, listId)
    await addItem(cookie, listId, {
      name: 'Trail mix',
      weightGrams: 500,
      quantity: 2,
      // THREE slots for one item, created WITHOUT isPerMeal so it takes the
      // per-meal default (0024). It must appear on the wire ONCE - a join to
      // the associations would put it there three times over, which is still
      // the most dangerous mistake available in this feature.
      //
      // Its published unitCount is 6: two at each of three lunches. That is
      // the number the reader needs, and the only one they get - the share
      // must not receive the three slot ids it was derived from.
      slotIds: [
        slotOf(food, 1, 'lunch').id,
        slotOf(food, 2, 'lunch').id,
        slotOf(food, 3, 'lunch').id,
      ],
    })

    const shared = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}`, {
      isShared: true,
    })
    expect(shared.status).toBe(200)
    const slug = ((await shared.json()) as { slug: string }).slug

    const res = await apiRequest('', 'GET', `/api/shares/v2/${slug}`)
    expect(res.status).toBe(200)
    const raw = (await res.json()) as Record<string, unknown>

    expect(Object.keys(raw).sort()).toEqual(['categories', 'food', 'items', 'list'])

    // Rows, and ONLY rows.
    expect(Object.keys(raw.food as object)).toEqual(['items'])
    const foodItems = (raw.food as { items: Record<string, unknown>[] }).items
    // Once, despite three meal slots. A join to the associations would put
    // this item on the wire three times over.
    expect(foodItems).toHaveLength(1)
    for (const foodItem of foodItems) {
      // The exact publishable surface of a food row. isPacked, isReady,
      // packingLocationId, packSortOrder and slotIds all exist on the owner's
      // DTO for this same row and none of them may appear here.
      expect(Object.keys(foodItem).sort()).toEqual([
        'id',
        'name',
        'sortOrder',
        'unitCount',
        'weightGrams',
      ])
      // Named individually as well as by the key set above: `isPerMeal` and
      // `quantity` are the two fields whose ABSENCE is load-bearing here. A
      // reader given quantity without the mode would compute 2 where the
      // answer is 6, and given the mode would be a step from the schedule.
      expect(foodItem).not.toHaveProperty('quantity')
      expect(foodItem).not.toHaveProperty('isPerMeal')
    }
    expect(foodItems[0]).toMatchObject({
      name: 'Trail mix',
      // 2 per lunch x 3 lunches. Resolved by the server; the wire carries the
      // answer, never the arithmetic.
      unitCount: 6,
      weightGrams: 500,
    })
    // The client sums the rows the same way the owner's view does. Asserted
    // here because it is the number the reader actually sees - 500 x 6.
    const total = foodItems.reduce(
      (grams, i) => grams + (i.weightGrams as number) * (i.unitCount as number),
      0,
    )
    expect(total).toBe(3000)
    // Nested too: a `food` key hanging off the list or an item would sail past
    // a root-only assertion. The list row is checked by VALUE as well: the day
    // count must not reach the share inside an allowed field either.
    expect(raw.list).toStrictEqual({
      name: 'Shared trip',
      description: null,
      isDraft: true,
    })
    const items = raw.items as Record<string, unknown>[]
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([
        'gear',
        'gearItemId',
        'id',
        'isConsumable',
        'isWorn',
        'quantity',
        'sortOrder',
      ])
      expect(Object.keys(item.gear as object).sort()).toEqual([
        'categoryId',
        'description',
        'name',
        'weightGrams',
      ])
    }
    for (const category of raw.categories as Record<string, unknown>[]) {
      expect(Object.keys(category).sort()).toEqual(['id', 'name', 'sortOrder'])
    }
    // The half that did not move: nothing anywhere in the payload says WHEN
    // any of this is eaten, how many days the trip runs, or what is already
    // packed. The item's name crosses now; its schedule does not.
    const serialized = JSON.stringify(raw)
    expect(serialized).not.toContain('lunch')
    expect(serialized).not.toContain('dayNumber')
    expect(serialized).not.toContain('slotIds')
    expect(serialized).not.toContain('dayCount')
    expect(serialized).not.toContain('isPacked')
    expect(serialized).not.toContain('needed')
  })

})

// The 200-item cap at the boundary. Same shape as the gear and list suites:
// seed to cap-1 raw, prove the API grants the last slot, refuses the next with
// the friendly 422, and the trigger backstops a write that bypasses the repo
// entirely.
describe('the food item cap (200 per list)', () => {
  it('friendly 422 from the API, trigger backstop on raw inserts', async () => {
    const { cookie } = await signUpVerifiedUser('food-cap@example.com', 'FCap')
    const listId = await createList(cookie, 'Trip')
    const me = await apiRequest(cookie, 'GET', '/api/me')
    const { id: userId } = (await me.json()) as { id: string }

    // Distinct pack ranks per row: DEFAULT 0 would collide on the 0022
    // Unassigned cohort unique index by the second row.
    const values = Array.from(
      { length: 199 },
      (_, i) =>
        `('${userId}-fseed-${i}', '${userId}', '${listId}', 'Seed ${i}', 100, 1, ${i}, ${i}, 0, 0)`,
    ).join(',')
    await testDb.prepare(
      'insert into list_food_items (id, user_id, list_id, name, weight_grams, quantity, sort_order, pack_sort_order, created_at, updated_at) values ' +
        values,
    ).run()

    const atCap = await addItem(cookie, listId, {
      name: 'The 200th',
      weightGrams: 50,
      quantity: 1,
      slotIds: [],
    })
    expect(atCap.status).toBe(201)

    const over = await addItem(cookie, listId, {
      name: 'One too many',
      weightGrams: 50,
      quantity: 1,
      slotIds: [],
    })
    expect(over.status).toBe(422)
    expect(await over.json()).toEqual({
      error: 'Food item limit reached (200 per list)',
    })

    await expect(
      testDb.prepare(
        `insert into list_food_items (id, user_id, list_id, name, weight_grams, quantity, sort_order, created_at, updated_at) values ('${userId}-bypass', '${userId}', '${listId}', 'Bypass', 1, 1, 999, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/cap/)
  })
})


describe('food counts derive from the plan (0024)', () => {
  // The defect this closes: a five-day trip with a peanut butter packet in
  // each lunch reported ONE packet. The plan was right and the pack weight was
  // wrong, silently, which is the worst failure this app has.
  it('a per-meal item counts once for every meal it is scheduled into', async () => {
    const { cookie } = await signUpVerifiedUser('food-permeal@example.com', 'PM')
    const listId = await createList(cookie, 'Trip')
    expect((await setDays(cookie, listId, 5)).status).toBe(200)
    const plan = await getFood(cookie, listId)

    // No isPerMeal in the body: the DEFAULT is what the common case gets, and
    // a client that has never heard of the flag must still get this right.
    const res = await addItem(cookie, listId, {
      name: 'Justin\'s PB',
      weightGrams: 33.5,
      quantity: 1,
      slotIds: [1, 2, 3, 4, 5].map((day) => slotOf(plan, day, 'lunch').id),
    })
    expect(res.status).toBe(201)

    const food = await getFood(cookie, listId)
    const item = food.items[0]!
    expect(item.isPerMeal).toBe(true)
    // One per lunch, five lunches. quantity stays what the user typed: a
    // server that derived it from the schedule would report 5, then carry 25.
    expect(item.quantity).toBe(1)
    expect(item.unitCount).toBe(5)
    expect(item.weightGrams * item.unitCount).toBeCloseTo(167.5)
  })

  it('multiplies the per-meal count by the meals', async () => {
    const { cookie } = await signUpVerifiedUser('food-permeal2@example.com', 'PM')
    const listId = await createList(cookie, 'Trip')
    expect((await setDays(cookie, listId, 3)).status).toBe(200)
    const plan = await getFood(cookie, listId)

    expect(
      (
        await addItem(cookie, listId, {
          name: 'Bars',
          weightGrams: 50,
          quantity: 2,
          slotIds: [1, 2, 3].map((day) => slotOf(plan, day, 'breakfast').id),
        })
      ).status,
    ).toBe(201)

    const food = await getFood(cookie, listId)
    expect(food.items[0]!.unitCount).toBe(6)
  })

  it('recomputes when the schedule changes, without touching quantity', async () => {
    const { cookie } = await signUpVerifiedUser('food-resched@example.com', 'RS')
    const listId = await createList(cookie, 'Trip')
    expect((await setDays(cookie, listId, 4)).status).toBe(200)
    const plan = await getFood(cookie, listId)

    const created = await addItem(cookie, listId, {
      name: 'Smoothie',
      weightGrams: 93,
      quantity: 1,
      slotIds: [slotOf(plan, 1, 'breakfast').id],
    })
    expect(created.status).toBe(201)
    const itemId = ((await created.json()) as { id: string }).id
    expect((await getFood(cookie, listId)).items[0]!.unitCount).toBe(1)

    // Add it to three more breakfasts. Nothing writes a count anywhere; the
    // count is a function of the plan, so it moves on its own.
    const res = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${listId}/food/items/${itemId}`,
      { slotIds: [1, 2, 3, 4].map((day) => slotOf(plan, day, 'breakfast').id) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()) as { unitCount: number }).toMatchObject({ unitCount: 4 })

    const food = await getFood(cookie, listId)
    expect(food.items[0]!.quantity).toBe(1)
    expect(food.items[0]!.unitCount).toBe(4)
  })

  it('switching a scheduled item to shared collapses it to its quantity', async () => {
    const { cookie } = await signUpVerifiedUser('food-toggle@example.com', 'TG')
    const listId = await createList(cookie, 'Trip')
    expect((await setDays(cookie, listId, 5)).status).toBe(200)
    const plan = await getFood(cookie, listId)

    const created = await addItem(cookie, listId, {
      name: 'Coffee',
      weightGrams: 20,
      quantity: 1,
      slotIds: [1, 2, 3, 4, 5].map((day) => slotOf(plan, day, 'breakfast').id),
    })
    expect(created.status).toBe(201)
    const itemId = ((await created.json()) as { id: string }).id
    expect((await getFood(cookie, listId)).items[0]!.unitCount).toBe(5)

    const res = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${listId}/food/items/${itemId}`,
      { isPerMeal: false },
    )
    expect(res.status).toBe(200)

    const food = await getFood(cookie, listId)
    expect(food.items[0]!.isPerMeal).toBe(false)
    // The SCHEDULE is untouched - it still says which breakfasts. Only what it
    // means for the count changed.
    expect(food.items[0]!.slotIds).toHaveLength(5)
    expect(food.items[0]!.unitCount).toBe(1)
  })

  it('an unscheduled per-meal item still counts one meal\'s worth', async () => {
    const { cookie } = await signUpVerifiedUser('food-unsched@example.com', 'US')
    const listId = await createList(cookie, 'Trip')
    expect((await setDays(cookie, listId, 3)).status).toBe(200)

    expect(
      (
        await addItem(cookie, listId, {
          name: 'Emergency bar',
          weightGrams: 60,
          quantity: 2,
          slotIds: [],
        })
      ).status,
    ).toBe(201)

    const food = await getFood(cookie, listId)
    // Not zero: it is in the pack whether or not you have planned it.
    expect(food.items[0]!.unitCount).toBe(2)
  })
})

describe('food: duplication carries the counting mode', () => {
  it('a per-meal item keeps its derived count in the copy', async () => {
    // The mirror of the shared case above. Both directions matter: dropping
    // isPerMeal turns shared into per-meal (weight jumps), and hardcoding it
    // the other way turns per-meal into shared (weight collapses).
    const { cookie } = await signUpVerifiedUser('food-dup-pm@example.com', 'DP')
    const listId = await createList(cookie, 'Original')
    await setDays(cookie, listId, 4)
    const plan = await getFood(cookie, listId)

    await addItem(cookie, listId, {
      name: 'Smoothie',
      weightGrams: 93,
      quantity: 1,
      slotIds: [1, 2, 3, 4].map((day) => slotOf(plan, day, 'breakfast').id),
    })

    const dup = await apiRequest(cookie, 'POST', `/api/lists/${listId}/duplicate`)
    expect(dup.status).toBe(201)
    const copyId = ((await dup.json()) as ListBody).id

    const copied = await getFood(cookie, copyId)
    expect(copied.items[0]!.isPerMeal).toBe(true)
    expect(copied.items[0]!.unitCount).toBe(4)
  })
})
