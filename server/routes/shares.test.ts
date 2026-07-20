import { describe, expect, it } from 'vitest'
import { sharedListResponseSchema } from '../../shared/lists'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

type ListBody = { id: string; slug: string; isShared: boolean }

async function createList(cookie: string, name: string): Promise<ListBody> {
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
  expect(res.status).toBe(201)
  return (await res.json()) as ListBody
}

async function setShared(
  cookie: string,
  listId: string,
  isShared: boolean,
): Promise<ListBody> {
  const res = await apiRequest(cookie, 'PATCH', `/api/lists/${listId}`, {
    isShared,
  })
  expect(res.status).toBe(200)
  return (await res.json()) as ListBody
}

async function createCategory(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/categories', { name })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function createGear(
  cookie: string,
  gear: {
    name: string
    description?: string
    weightGrams?: number
    categoryId?: string
    cost?: number
    purchaseDate?: string
  },
): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/gear-items', gear)
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function addItem(
  cookie: string,
  listId: string,
  gearItemId: string,
): Promise<string> {
  const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, {
    gearItemId,
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function getShare(slug: string): Promise<Response> {
  // No cookie, no CSRF header: a plain anonymous GET, exactly what a
  // share viewer's browser sends.
  return apiRequest(null, 'GET', `/api/shares/${slug}`)
}

// --- food helpers (slice 5): build a plan through the real API, like the
// gear helpers above. Entries go in Extras (isExtra, no cell) - the grid is
// irrelevant to projection, and Extras allows one entry per food, so each
// entry below uses its own food item.

async function createFoodItem(
  cookie: string,
  food: {
    name: string
    servingWeightGrams: number
    servingsPerPackage?: number | null
  },
): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/food-items', {
    caloriesPerServing: 100,
    ...food,
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function createFoodPlan(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/food-plans', {
    name,
    days: 1,
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function addExtraEntry(
  cookie: string,
  planId: string,
  foodItemId: string,
  basis: 'servings' | 'packages' | 'weight',
  amount: number,
): Promise<void> {
  const res = await apiRequest(
    cookie,
    'POST',
    `/api/food-plans/${planId}/entries`,
    { isExtra: true, foodItemId, basis, amount },
  )
  expect(res.status).toBe(201)
}

async function attachPlan(
  cookie: string,
  listId: string,
  planId: string,
): Promise<void> {
  const res = await apiRequest(cookie, 'PUT', `/api/lists/${listId}/food-plan`, {
    foodPlanId: planId,
  })
  expect(res.status).toBe(200)
}

// Saves one daily and one meal target on the plan (the meal id comes from the
// plan's seeded meals), so the share leak-guard runs against a plan that has
// target rows to leak.
async function saveTargets(cookie: string, planId: string): Promise<void> {
  const docRes = await apiRequest(cookie, 'GET', `/api/food-plans/${planId}`)
  expect(docRes.status).toBe(200)
  const doc = (await docRes.json()) as { meals: { id: string }[] }
  const mealId = doc.meals[0]?.id
  expect(mealId).toBeDefined()
  const res = await apiRequest(cookie, 'PUT', `/api/food-plans/${planId}/targets`, {
    daily: [{ metric: 'calories', mode: 'range', targetMin: 2500, targetMax: 3500 }],
    meals: [{ mealId, metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 35 }],
  })
  expect(res.status).toBe(200)
}

// Every key that must never appear ANYWHERE in the public response, at
// any nesting depth. The runtime mirror of the allowlist comment in
// shared/lists.ts; a widened repo select or a spread slipping into the
// route mapping turns this red.
const FORBIDDEN_KEYS = new Set([
  'userId',
  'user_id',
  'listId',
  'list_id',
  'slug',
  'isShared',
  'isPacked',
  'isReady',
  'readyChecksEnabled',
  'status',
  'cost',
  'purchaseDate',
  'createdAt',
  'updatedAt',
  // Food (slice 5): the share carries ONE projected weight + the incomplete
  // flag, nothing else (design 7: no names, no meals, no calories). These are
  // the keys a widened plan/entry/food select would drag onto the wire.
  'foodPlanId',
  'food_plan_id',
  'foodItemId',
  'food_item_id',
  'basis',
  'amount',
  'servingWeightGrams',
  'servingsPerPackage',
  'caloriesPerServing',
  // Targets (slice 7): design section 14.6 - no target data crosses the
  // share boundary. The plan in the wire test below has saved daily AND meal
  // targets, so a conditional leak (one that only shows for targeted plans)
  // cannot hide behind a target-free fixture.
  'dailyTargets',
  'mealTargets',
  'targetMin',
  'targetMax',
  'metric',
  'mode',
  'mealId',
  'dayTypeOverride',
])

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key)
      collectKeys(nested, into)
    }
  }
  return into
}

describe('GET /api/shares/:slug', () => {
  it('serves a shared list to anon with the exact public allowlist', async () => {
    const { cookie } = await signUpVerifiedUser('share-owner@example.com', 'O')
    const list = await createList(cookie, 'JMT Loop')

    // Owner-ordered categories: Zeta created first (sortOrder 0) so the
    // response must follow sortOrder, not alphabetize.
    const zetaId = await createCategory(cookie, 'Zeta')
    const alphaId = await createCategory(cookie, 'Alpha')
    // A third category the list never references must stay absent.
    await createCategory(cookie, 'Unreferenced')

    const tarpId = await createGear(cookie, {
      // cost + purchaseDate are POPULATED on purpose: they are private
      // inventory metadata, and a fixture that leaves them null cannot tell
      // "the share correctly omits them" apart from "there was nothing to
      // omit". FORBIDDEN_KEYS below asserts neither key reaches the wire.
      name: 'Tarp',
      description: 'DCF 8x10',
      // Fractional on purpose: gear weight is published to anonymous viewers,
      // so the tenth has to survive the share projection too.
      weightGrams: 250.5,
      categoryId: zetaId,
      cost: 289.99,
      purchaseDate: '2024-04-15',
    })
    const potId = await createGear(cookie, {
      name: 'Pot',
      weightGrams: 120,
      categoryId: alphaId,
    })
    const mysteryId = await createGear(cookie, { name: 'Uncategorized thing' })

    const tarpItemId = await addItem(cookie, list.id, tarpId)
    await addItem(cookie, list.id, potId)
    await addItem(cookie, list.id, mysteryId)
    const worn = await apiRequest(
      cookie,
      'PATCH',
      `/api/lists/${list.id}/items/${tarpItemId}`,
      { isWorn: true, quantity: 2 },
    )
    expect(worn.status).toBe(200)

    await setShared(cookie, list.id, true)

    const res = await getShare(list.slug)
    expect(res.status).toBe(200)
    const raw: unknown = await res.json()
    const body = sharedListResponseSchema.parse(raw)

    expect(body.list).toEqual({
      name: 'JMT Loop',
      description: null,
      groupWorn: false,
      isDraft: true, // lists are born drafts; the share view shows the banner
    })

    // sortOrder order, only referenced categories.
    expect(body.categories.map((c) => c.name)).toEqual(['Zeta', 'Alpha'])

    expect(body.items).toHaveLength(3)
    expect(body.items.map((i) => i.gear.name)).toEqual([
      'Tarp',
      'Pot',
      'Uncategorized thing',
    ])
    const tarp = body.items[0]!
    expect(tarp).toMatchObject({
      gearItemId: tarpId,
      quantity: 2,
      isWorn: true,
      isConsumable: false,
      gear: {
        name: 'Tarp',
        description: 'DCF 8x10',
        weightGrams: 250.5,
        categoryId: zetaId,
      },
    })
    expect(body.items[2]!.gear.categoryId).toBeNull()

    // Asserted on RAW json, not the parsed DTO: zod would happily coerce a
    // truncated 250 into a valid number and the schema check would still pass.
    const rawItems = (raw as { items: { gear: { weightGrams: number } }[] }).items
    expect(rawItems[0]!.gear.weightGrams).toBe(250.5)

    // The leak guard: nothing private at any depth, and the list object
    // exposes neither its id nor its slug (the viewer already has the
    // slug; the id is an internal handle).
    const keys = collectKeys(raw, new Set())
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `forbidden key on the wire: ${forbidden}`).toBe(false)
    }
    expect(Object.keys(body.list).toSorted()).toEqual([
      'description',
      'groupWorn',
      'isDraft',
      'name',
    ])
  })

  it('reflects groupWorn and isDraft edits', async () => {
    const { cookie } = await signUpVerifiedUser('share-flags@example.com', 'F')
    const list = await createList(cookie, 'Flags')
    await setShared(cookie, list.id, true)
    const patch = await apiRequest(cookie, 'PATCH', `/api/lists/${list.id}`, {
      groupWorn: true,
      isDraft: false,
    })
    expect(patch.status).toBe(200)

    const body = sharedListResponseSchema.parse(await (await getShare(list.slug)).json())
    expect(body.list.groupWorn).toBe(true)
    expect(body.list.isDraft).toBe(false)
  })

  it('serves an empty shared list as empty arrays, not an error', async () => {
    const { cookie } = await signUpVerifiedUser('share-empty@example.com', 'E')
    const list = await createList(cookie, 'Empty')
    await setShared(cookie, list.id, true)

    const res = await getShare(list.slug)
    expect(res.status).toBe(200)
    const body = sharedListResponseSchema.parse(await res.json())
    expect(body.items).toEqual([])
    expect(body.categories).toEqual([])
  })

  it('404s identically for an unshared list and an unknown slug', async () => {
    const { cookie } = await signUpVerifiedUser('share-404@example.com', 'N')
    const list = await createList(cookie, 'Private')
    // isShared defaults false - never toggled on.

    const unshared = await getShare(list.slug)
    const unknown = await getShare('zzzzzz')
    expect(unshared.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await unshared.json()).toEqual(await unknown.json())
  })

  it('unsharing kills the link without changing the slug', async () => {
    const { cookie } = await signUpVerifiedUser('share-toggle@example.com', 'T')
    const list = await createList(cookie, 'Toggle')

    const shared = await setShared(cookie, list.id, true)
    expect(shared.isShared).toBe(true)
    expect(shared.slug).toBe(list.slug)
    expect((await getShare(list.slug)).status).toBe(200)

    const unshared = await setShared(cookie, list.id, false)
    expect(unshared.isShared).toBe(false)
    expect(unshared.slug).toBe(list.slug)
    expect((await getShare(list.slug)).status).toBe(404)
  })
})

describe('PATCH /api/lists/:id isShared authorization', () => {
  it('anon cannot flip isShared', async () => {
    const { cookie } = await signUpVerifiedUser('share-anon@example.com', 'A')
    const list = await createList(cookie, 'Mine')
    const res = await apiRequest(null, 'PATCH', `/api/lists/${list.id}`, {
      isShared: true,
    })
    expect(res.status).toBe(401)
    expect((await getShare(list.slug)).status).toBe(404)
  })

  it('a non-owner cannot flip isShared (404, zero effect)', async () => {
    const owner = await signUpVerifiedUser('share-victim@example.com', 'V')
    const attacker = await signUpVerifiedUser('share-attacker@example.com', 'X')
    const list = await createList(owner.cookie, 'Victim list')

    const res = await apiRequest(
      attacker.cookie,
      'PATCH',
      `/api/lists/${list.id}`,
      { isShared: true },
    )
    expect(res.status).toBe(404)
    expect((await getShare(list.slug)).status).toBe(404)
  })
})

// Slice 5 (design 7): the share carries the attached plan's projected weight
// as ONE nullable object - null encodes "no plan attached", which two bare
// scalars could not distinguish from a plan that weighs zero.
describe('GET /api/shares/:slug food weight', () => {
  it('serves food: null when no plan is attached', async () => {
    const { cookie } = await signUpVerifiedUser('share-nofood@example.com', 'N')
    const list = await createList(cookie, 'Gear only')
    await setShared(cookie, list.id, true)

    const raw: unknown = await (await getShare(list.slug)).json()
    const body = sharedListResponseSchema.parse(raw)
    expect(body.food).toBeNull()
    // Exact top-level shape asserted on the RAW wire body, not the parsed
    // one: zod objects are non-strict, so parse() strips unknown keys and a
    // widened mapper would vanish before a parsed-body assertion ran.
    expect(Object.keys(raw as object).toSorted()).toEqual([
      'categories',
      'food',
      'items',
      'list',
    ])
  })

  it('projects servings + weight + packages entries server-side', async () => {
    const { cookie } = await signUpVerifiedUser('share-food@example.com', 'F')
    const list = await createList(cookie, 'Resupply')
    const planId = await createFoodPlan(cookie, 'Menu')
    // servings: 2 x 85 g = 170; weight: the grams ARE the amount = 140;
    // packages: 2 x 3 x 50 g = 300. Total 610.
    const oats = await createFoodItem(cookie, {
      name: 'Oats',
      servingWeightGrams: 85,
    })
    const gorp = await createFoodItem(cookie, {
      name: 'Gorp',
      servingWeightGrams: 30,
    })
    const ramen = await createFoodItem(cookie, {
      name: 'Ramen',
      servingWeightGrams: 50,
      servingsPerPackage: 3,
    })
    await addExtraEntry(cookie, planId, oats, 'servings', 2)
    await addExtraEntry(cookie, planId, gorp, 'weight', 140)
    await addExtraEntry(cookie, planId, ramen, 'packages', 2)
    await saveTargets(cookie, planId)
    await attachPlan(cookie, list.id, planId)
    await setShared(cookie, list.id, true)

    const raw: unknown = await (await getShare(list.slug)).json()
    const body = sharedListResponseSchema.parse(raw)
    expect(body.food).toEqual({ weightGrams: 610, incomplete: false })

    // The leak guard, with a plan attached: the weight is the ONLY food data
    // on the wire - no plan name, no entries, no per-food nutrition. The
    // forbidden-keys sweep catches known-private names; the exact-key
    // assertion catches everything else, and it MUST inspect the RAW body:
    // zod objects are non-strict, so parse() strips unknown keys and a
    // widened mapper (say, a spread adding planName) would cross the real
    // wire yet vanish before a parsed-body assertion ran.
    const keys = collectKeys(raw, new Set())
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `forbidden key on the wire: ${forbidden}`).toBe(false)
    }
    const rawFood = (raw as { food: Record<string, unknown> }).food
    expect(Object.keys(rawFood).toSorted()).toEqual([
      'incomplete',
      'weightGrams',
    ])
  })

  it('flags incomplete for an unprojectable packages entry, still counting the rest', async () => {
    const { cookie } = await signUpVerifiedUser('share-est@example.com', 'E')
    const list = await createList(cookie, 'Estimate')
    const planId = await createFoodPlan(cookie, 'Menu')
    const oats = await createFoodItem(cookie, {
      name: 'Oats',
      servingWeightGrams: 85,
    })
    // No package size: a `packages` entry on this food contributes nothing
    // and must flag the total as an undercount (design 5.4).
    const mystery = await createFoodItem(cookie, {
      name: 'Bulk bin mix',
      servingWeightGrams: 50,
      servingsPerPackage: null,
    })
    await addExtraEntry(cookie, planId, oats, 'servings', 2)
    await addExtraEntry(cookie, planId, mystery, 'packages', 5)
    await attachPlan(cookie, list.id, planId)
    await setShared(cookie, list.id, true)

    const body = sharedListResponseSchema.parse(await (await getShare(list.slug)).json())
    expect(body.food).toEqual({ weightGrams: 170, incomplete: true })
  })

  it('serves a food-only shared list: zero gear rows, food present', async () => {
    const { cookie } = await signUpVerifiedUser('share-foodonly@example.com', 'O')
    const list = await createList(cookie, 'Food drop')
    const planId = await createFoodPlan(cookie, 'Cache')
    const oats = await createFoodItem(cookie, {
      name: 'Oats',
      servingWeightGrams: 85,
    })
    await addExtraEntry(cookie, planId, oats, 'servings', 4)
    await attachPlan(cookie, list.id, planId)
    await setShared(cookie, list.id, true)

    const res = await getShare(list.slug)
    expect(res.status).toBe(200)
    const body = sharedListResponseSchema.parse(await res.json())
    expect(body.items).toEqual([])
    expect(body.categories).toEqual([])
    expect(body.food).toEqual({ weightGrams: 340, incomplete: false })
  })

  it('serves an attached plan with no entries as zero, present and complete', async () => {
    // The case the rev-1 two-scalar DTO could not distinguish from "no
    // plan": presence must survive a zero weight.
    const { cookie } = await signUpVerifiedUser('share-zero@example.com', 'Z')
    const list = await createList(cookie, 'Zero')
    const planId = await createFoodPlan(cookie, 'Empty menu')
    await attachPlan(cookie, list.id, planId)
    await setShared(cookie, list.id, true)

    const body = sharedListResponseSchema.parse(await (await getShare(list.slug)).json())
    expect(body.food).toEqual({ weightGrams: 0, incomplete: false })
  })

  it('rounds the summed total once, never per entry', async () => {
    const { cookie } = await signUpVerifiedUser('share-round@example.com', 'R')
    const list = await createList(cookie, 'Round')
    const planId = await createFoodPlan(cookie, 'Menu')
    // Three 0.5 g servings: full-precision sum 1.5 -> 2. Rounding each entry
    // first would give 3 x round(0.5) = 3 (design 5.6: round the sum, once).
    for (const name of ['Salt', 'Pepper', 'Bouillon']) {
      const id = await createFoodItem(cookie, {
        name,
        servingWeightGrams: 0.5,
      })
      await addExtraEntry(cookie, planId, id, 'servings', 1)
    }
    await attachPlan(cookie, list.id, planId)
    await setShared(cookie, list.id, true)

    const body = sharedListResponseSchema.parse(await (await getShare(list.slug)).json())
    expect(body.food).toEqual({ weightGrams: 2, incomplete: false })
  })

  it('detaching the plan returns the share to food: null', async () => {
    const { cookie } = await signUpVerifiedUser('share-detach@example.com', 'D')
    const list = await createList(cookie, 'Detach')
    const planId = await createFoodPlan(cookie, 'Menu')
    const oats = await createFoodItem(cookie, {
      name: 'Oats',
      servingWeightGrams: 85,
    })
    await addExtraEntry(cookie, planId, oats, 'servings', 1)
    await attachPlan(cookie, list.id, planId)
    await setShared(cookie, list.id, true)

    const before = sharedListResponseSchema.parse(await (await getShare(list.slug)).json())
    expect(before.food).toEqual({ weightGrams: 85, incomplete: false })

    const detach = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/food-plan`,
    )
    expect(detach.status).toBe(200)

    const after = sharedListResponseSchema.parse(await (await getShare(list.slug)).json())
    expect(after.food).toBeNull()
  })
})
