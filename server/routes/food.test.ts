import { describe, expect, it } from 'vitest'
import app from '../index'
import { env } from 'cloudflare:test'
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
  body: { name: string; weightGrams: number; quantity: number; slotIds: string[] },
): Promise<Response> {
  return apiRequest(cookie, 'POST', `/api/lists/${listId}/food/items`, body)
}

const slotOf = (food: ListFoodResponse, day: number, meal: string) =>
  food.slots.find((s) => s.dayNumber === day && s.meal === meal)!

describe('food: day grid', () => {
  it('generates breakfast/lunch/dinner for every day', async () => {
    const { cookie } = await signUpVerifiedUser('food-1@example.com', 'F1')
    const listId = await createList(cookie, 'Trip')

    expect((await setDays(cookie, listId, 5)).status).toBe(200)
    const food = await getFood(cookie, listId)

    expect(food.dayCount).toBe(5)
    expect(food.slots).toHaveLength(15)
    expect(food.slots.filter((s) => s.meal === 'dinner')).toHaveLength(5)
    expect(food.slots.every((s) => s.needed)).toBe(true)
  })

  it('keeps pruning when the same day count is re-entered', async () => {
    // The one piece of work the feature asks the user to do by hand. Losing it
    // on a no-op edit would be worse than not having the feature.
    const { cookie } = await signUpVerifiedUser('food-2@example.com', 'F2')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 5)

    const before = await getFood(cookie, listId)
    const day1Breakfast = slotOf(before, 1, 'breakfast')
    await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${listId}/food/slots/${day1Breakfast.id}`,
      { needed: false },
    )

    await setDays(cookie, listId, 5)

    const after = await getFood(cookie, listId)
    expect(slotOf(after, 1, 'breakfast').needed).toBe(false)
    // ...and the slot kept its id, which is what lets associations survive.
    expect(slotOf(after, 1, 'breakfast').id).toBe(day1Breakfast.id)
  })

  it('repairs a hole rather than reading only the highest day', async () => {
    const { cookie } = await signUpVerifiedUser('food-3@example.com', 'F3')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 5)
    await setDays(cookie, listId, 2)
    await setDays(cookie, listId, 5)

    const food = await getFood(cookie, listId)
    expect(food.slots).toHaveLength(15)
    // Days 3-5 came back fresh and needed.
    expect(slotOf(food, 4, 'dinner').needed).toBe(true)
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
    expect(food.slots).toHaveLength(90)
  })

  it('rejects a trip longer than the cap', async () => {
    const { cookie } = await signUpVerifiedUser('food-6@example.com', 'F6')
    const listId = await createList(cookie, 'Trip')
    expect((await setDays(cookie, listId, 31)).status).toBe(400)
  })
})

describe('food: weight is per ITEM, never per placement', () => {
  it('counts one bag associated with five slots exactly once', async () => {
    // THE defining invariant. One 500 g bag of trail mix eaten across five
    // lunches weighs 500 g. Joining items to slots and summing would say 2500.
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
      slotIds: lunches,
    })
    expect(res.status).toBe(201)

    const after = await getFood(cookie, listId)
    expect(after.items).toHaveLength(1)
    expect(after.items[0]!.quantity).toBe(1)
    expect(after.items[0]!.slotIds).toHaveLength(5)
    const total = after.items.reduce((g, i) => g + i.weightGrams * i.quantity, 0)
    expect(total).toBe(500)
  })

  it('never derives quantity from the number of slots', async () => {
    const { cookie } = await signUpVerifiedUser('food-8@example.com', 'F8')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 4)
    const food = await getFood(cookie, listId)
    const breakfasts = food.slots.filter((s) => s.meal === 'breakfast').map((s) => s.id)

    await addItem(cookie, listId, {
      name: 'Oatmeal',
      weightGrams: 80,
      quantity: 1,
      slotIds: breakfasts,
    })

    const after = await getFood(cookie, listId)
    expect(after.items[0]!.quantity).toBe(1)
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

describe('food: slot states', () => {
  it('clears associations when a slot is marked not needed', async () => {
    // The fourth state - "deliberately skipped, still holding food" - must not
    // be storable. The ITEM survives; only its placement goes.
    const { cookie } = await signUpVerifiedUser('food-10@example.com', 'F10')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 2)
    const food = await getFood(cookie, listId)
    const breakfast = slotOf(food, 1, 'breakfast')

    await addItem(cookie, listId, {
      name: 'Oatmeal',
      weightGrams: 80,
      quantity: 1,
      slotIds: [breakfast.id],
    })
    await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/slots/${breakfast.id}`, {
      needed: false,
    })

    const after = await getFood(cookie, listId)
    expect(after.items).toHaveLength(1)
    expect(after.items[0]!.slotIds).toEqual([])
    expect(slotOf(after, 1, 'breakfast').needed).toBe(false)
  })

  it('refuses to associate food with an already-pruned slot', async () => {
    // The other direction. Clearing on the true->false transition alone would
    // leave this route into the fourth state wide open.
    const { cookie } = await signUpVerifiedUser('food-11@example.com', 'F11')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 2)
    const food = await getFood(cookie, listId)
    const breakfast = slotOf(food, 1, 'breakfast')
    await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/slots/${breakfast.id}`, {
      needed: false,
    })

    const res = await addItem(cookie, listId, {
      name: 'Oatmeal',
      weightGrams: 80,
      quantity: 1,
      slotIds: [breakfast.id],
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

  it('404s a slot patch aimed at the wrong list', async () => {
    const { cookie } = await signUpVerifiedUser('food-15@example.com', 'F15')
    const listA = await createList(cookie, 'A')
    const listB = await createList(cookie, 'B')
    await setDays(cookie, listB, 2)
    const foodB = await getFood(cookie, listB)

    const res = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${listA}/food/slots/${slotOf(foodB, 1, 'breakfast').id}`,
      { needed: false },
    )
    expect(res.status).toBe(404)
  })

})

// The table-driven auth matrix the other four route files already have. Food
// was the odd one out (a single ad-hoc GET 401), which mattered doubly once
// the session gate moved to ONE hoisted api.use('/lists/*') in
// server/index.ts: this loop is what proves the hoist did not silently
// un-gate the food sub-app.
describe('/api/lists/:id/food authorization', () => {
  it('returns 401 without a session on every route shape', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/lists/list/food', undefined],
      ['PUT', '/api/lists/list/food/days', { days: 2 }],
      ['PATCH', '/api/lists/list/food/slots/slot', { needed: false }],
      ['POST', '/api/lists/list/food/items', { name: 'X', weightGrams: 1, quantity: 1, slotIds: [] }],
      ['PATCH', '/api/lists/list/food/items/item', { name: 'X' }],
      ['DELETE', '/api/lists/list/food/items/item', undefined],
    ] as const) {
      const res = await apiRequest(null, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

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
      ['PATCH', `/api/lists/${listId}/food/slots/slot`, { needed: false }],
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

    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${listId}/food/items/${created.id}`,
    )
    expect(res.status).toBe(204)
    expect((await getFood(cookie, listId)).items).toHaveLength(0)
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
    await addItem(cookie, listId, {
      name: 'Trail mix',
      weightGrams: 500,
      quantity: 1,
      slotIds: lunches,
    })
    const day1Breakfast = slotOf(food, 1, 'breakfast')
    await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/slots/${day1Breakfast.id}`, {
      needed: false,
    })

    const dup = await apiRequest(cookie, 'POST', `/api/lists/${listId}/duplicate`)
    expect(dup.status).toBe(201)
    const copyId = ((await dup.json()) as ListBody).id

    const copied = await getFood(cookie, copyId)
    expect(copied.slots).toHaveLength(15)
    // The prune came with it.
    expect(slotOf(copied, 1, 'breakfast').needed).toBe(false)
    // ONE item, five associations, 500 g - not five items and not 2500 g.
    expect(copied.items).toHaveLength(1)
    expect(copied.items[0]!.slotIds).toHaveLength(5)
    const total = copied.items.reduce((g, i) => g + i.weightGrams * i.quantity, 0)
    expect(total).toBe(500)
    // Fresh ids: editing the copy must not touch the original.
    expect(copied.items[0]!.id).not.toBe(food.items[0]?.id)
  })
})

describe('food never crosses the public share boundary', () => {
  it('is absent from a shared list, with food populated', async () => {
    // Food is a private planning aid. The projection is field-by-field, so this
    // asserts the EXACT key set of the raw JSON rather than banning names I
    // happened to think of - a `foodItems` array would slip past a deny-list.
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
      name: 'Secret snacks',
      weightGrams: 500,
      quantity: 2,
      slotIds: [slotOf(food, 1, 'lunch').id],
    })

    const shared = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}`, {
      isShared: true,
    })
    expect(shared.status).toBe(200)
    const slug = ((await shared.json()) as { slug: string }).slug

    const res = await apiRequest('', 'GET', `/api/shares/${slug}`)
    expect(res.status).toBe(200)
    const raw = (await res.json()) as Record<string, unknown>

    expect(Object.keys(raw).sort()).toEqual(['categories', 'items', 'list'])
    // Nested too: a `food` key hanging off the list or an item would sail past
    // a root-only assertion.
    expect(Object.keys(raw.list as object).sort()).toEqual([
      'description',
      'groupWorn',
      'isDraft',
      'name',
    ])
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
    // And nothing anywhere in the payload mentions the food we just added.
    expect(JSON.stringify(raw)).not.toContain('Secret snacks')
  })
})

describe('food: the fourth state is unreachable at the database', () => {
  it('rejects an association insert against a pruned slot', async () => {
    // The repo's needed=true read is a PRECHECK - a concurrent prune can commit
    // between it and the insert batch. The needed_only trigger is what actually
    // guarantees "deliberately skipped" never coexists with food, so this drives
    // the write path directly rather than trusting the read.
    const { cookie } = await signUpVerifiedUser('food-race@example.com', 'FR')
    const listId = await createList(cookie, 'Trip')
    await setDays(cookie, listId, 2)
    const food = await getFood(cookie, listId)
    const lunch = slotOf(food, 1, 'lunch')

    // An item that IS legitimately scheduled...
    const created = (await (
      await addItem(cookie, listId, {
        name: 'Bar',
        weightGrams: 60,
        quantity: 1,
        slotIds: [slotOf(food, 1, 'breakfast').id],
      })
    ).json()) as FoodItemResponse

    // ...then the lunch slot is pruned, and we try to reschedule onto it.
    await apiRequest(cookie, 'PATCH', `/api/lists/${listId}/food/slots/${lunch.id}`, {
      needed: false,
    })
    const res = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${listId}/food/items/${created.id}`,
      { slotIds: [lunch.id] },
    )
    expect(res.status).toBe(400)

    // And the item kept its original placement rather than being left bare.
    const after = await getFood(cookie, listId)
    expect(after.items[0]!.slotIds).toEqual([slotOf(after, 1, 'breakfast').id])
  })
})

// The 200-item cap at the boundary (review P2.2: every other cap had this
// three-sided test; food - the NEWEST trigger - had none). Same shape as the
// gear and list suites: seed to cap-1 raw, prove the API grants the last
// slot, refuses the next with the friendly 422, and the trigger backstops a
// write that bypasses the repo entirely.
describe('the food item cap (200 per list)', () => {
  it('friendly 422 from the API, trigger backstop on raw inserts', async () => {
    const { cookie } = await signUpVerifiedUser('food-cap@example.com', 'FCap')
    const listId = await createList(cookie, 'Trip')
    const me = await apiRequest(cookie, 'GET', '/api/me')
    const { id: userId } = (await me.json()) as { id: string }

    const values = Array.from(
      { length: 199 },
      (_, i) =>
        `('${userId}-fseed-${i}', '${userId}', '${listId}', 'Seed ${i}', 100, 1, ${i}, 0, 0)`,
    ).join(',')
    await env.DB.prepare(
      'insert into list_food_items (id, user_id, list_id, name, weight_grams, quantity, sort_order, created_at, updated_at) values ' +
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
      env.DB.prepare(
        `insert into list_food_items (id, user_id, list_id, name, weight_grams, quantity, sort_order, created_at, updated_at) values ('${userId}-bypass', '${userId}', '${listId}', 'Bypass', 1, 1, 999, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/cap/)
  })
})
