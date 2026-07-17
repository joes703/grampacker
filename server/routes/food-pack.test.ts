import { describe, expect, it } from 'vitest'
import type { FoodPlanDocument } from '../../shared/food-plans'
import { foodPlanDocumentSchema } from '../../shared/food-plans'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

// The food packing checklist's server side (food-planning-design.md 6).
// food_pack_state is keyed (list_id, food_item_id) and ROW PRESENCE MEANS
// PACKED, so every assertion here reads the state back through GET and
// checks VALUES, not just statuses - these statements are hand-built SQL,
// exactly where the drizzle unqualified-column trap lives (AGENTS.md).
//
// The design's required test list (section 6) maps onto this file:
//   rule 1 (clear on relink)      -> 'clear on relink (rule 1)'
//   rule 2 multi-cell/cascade     -> 'reconcile after plan mutations (rule 2)'
//   rule 2 redirect               -> N/A, structurally: updateEntryRequestSchema
//                                    accepts only basis/amount, so an entry's
//                                    food_item_id cannot be "updated away"
//                                    through this API. If that ever changes,
//                                    updateEntry needs the reconcile statement
//                                    and this file needs the redirect case.
//   rule 3 pack/unpack races,
//   idempotency, ownership        -> 'the pack toggle (rule 3)' + authz matrix

type ListBody = { id: string; foodPlanId: string | null }

async function createList(cookie: string, name: string): Promise<ListBody> {
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
  expect(res.status).toBe(201)
  return (await res.json()) as ListBody
}

async function createPlan(
  cookie: string,
  name: string,
): Promise<FoodPlanDocument> {
  const res = await apiRequest(cookie, 'POST', '/api/food-plans', {
    name,
    days: 2,
  })
  if (res.status !== 201) throw new Error(`create plan failed: ${res.status}`)
  return foodPlanDocumentSchema.parse(await res.json())
}

async function createFood(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/food-items', {
    name,
    servingWeightGrams: 85,
    caloriesPerServing: 380,
    servingsPerPackage: 2,
  })
  if (res.status !== 201) throw new Error(`create food failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

// Add a food to the plan cell at (dayIndex, mealIndex), returning the fresh
// document. Cells come from the seeded 3-meal x N-day grid.
async function addToCell(
  cookie: string,
  plan: FoodPlanDocument,
  foodItemId: string,
  dayIndex: number,
  mealIndex: number,
): Promise<FoodPlanDocument> {
  const day = plan.days[dayIndex]
  const meal = plan.meals[mealIndex]
  if (!day || !meal) throw new Error('day/meal out of range')
  const cell = plan.dayMeals.find(
    (dm) => dm.dayId === day.id && dm.mealId === meal.id,
  )
  if (!cell) throw new Error('cell not found')
  const res = await apiRequest(
    cookie,
    'POST',
    `/api/food-plans/${plan.id}/entries`,
    { dayMealId: cell.id, foodItemId, basis: 'servings', amount: 2 },
  )
  if (res.status !== 201) throw new Error(`add entry failed: ${res.status}`)
  return foodPlanDocumentSchema.parse(await res.json())
}

async function attach(cookie: string, listId: string, planId: string) {
  const res = await apiRequest(cookie, 'PUT', `/api/lists/${listId}/food-plan`, {
    foodPlanId: planId,
  })
  expect(res.status).toBe(200)
}

async function packedIds(cookie: string, listId: string): Promise<string[]> {
  const res = await apiRequest(cookie, 'GET', `/api/lists/${listId}/food-pack`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { packedFoodItemIds: string[] }
  // The response is EXACTLY the id set - assert the shape stays narrow.
  expect(Object.keys(body)).toEqual(['packedFoodItemIds'])
  return body.packedFoodItemIds
}

type ToggleBody = { foodItemId: string; packed: boolean; applied: boolean }

async function toggle(
  cookie: string,
  listId: string,
  foodItemId: string,
  packed: boolean,
  expectedFoodPlanId: string,
): Promise<ToggleBody> {
  const res = await apiRequest(
    cookie,
    'PUT',
    `/api/lists/${listId}/food-pack/${foodItemId}`,
    { packed, expectedFoodPlanId },
  )
  expect(res.status).toBe(200)
  return (await res.json()) as ToggleBody
}

// The standard scene: one list attached to one plan containing one food.
async function scene(cookie: string) {
  const list = await createList(cookie, 'Trip')
  let plan = await createPlan(cookie, 'Menu')
  const foodId = await createFood(cookie, 'Ramen')
  plan = await addToCell(cookie, plan, foodId, 0, 0)
  await attach(cookie, list.id, plan.id)
  return { list, plan, foodId }
}

describe('/api/lists/:id/food-pack authorization matrix', () => {
  it('anon requests are 401 on every route', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/lists/some-id/food-pack', undefined],
      ['DELETE', '/api/lists/some-id/food-pack', undefined],
      [
        'PUT',
        '/api/lists/some-id/food-pack/food-id',
        { packed: true, expectedFoodPlanId: 'x' },
      ],
    ] as const) {
      const res = await apiRequest(null, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

  it("cross-user access is indistinguishable from nonexistence", async () => {
    const a = await signUpVerifiedUser('pack-a@example.com', 'A')
    const b = await signUpVerifiedUser('pack-b@example.com', 'B')
    const aScene = await scene(a.cookie)

    // B cannot read, toggle, or reset A's list.
    for (const [method, path, body, want] of [
      ['GET', `/api/lists/${aScene.list.id}/food-pack`, undefined, 404],
      ['DELETE', `/api/lists/${aScene.list.id}/food-pack`, undefined, 404],
      [
        'PUT',
        `/api/lists/${aScene.list.id}/food-pack/${aScene.foodId}`,
        { packed: true, expectedFoodPlanId: aScene.plan.id },
        404,
      ],
    ] as const) {
      const res = await apiRequest(b.cookie, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(want)
    }
    expect(await packedIds(a.cookie, aScene.list.id)).toEqual([])
  })

  it("a toggle naming another user's food affects zero rows", async () => {
    // B's OWN list and plan, but A's food id: the gate requires the food to
    // be in B's plan, and A's food cannot be (same-owner FKs), so this is
    // applied:false with nothing written - not an error, and not a row.
    const a = await signUpVerifiedUser('pack-food-a@example.com', 'A')
    const b = await signUpVerifiedUser('pack-food-b@example.com', 'B')
    const aFood = await createFood(a.cookie, "A's ramen")
    const bScene = await scene(b.cookie)

    const res = await toggle(
      b.cookie,
      bScene.list.id,
      aFood,
      true,
      bScene.plan.id,
    )
    expect(res.applied).toBe(false)
    expect(await packedIds(b.cookie, bScene.list.id)).toEqual([])
  })
})

describe('the pack toggle (rule 3)', () => {
  it('packs and unpacks, reflected in the pack-state read', async () => {
    const { cookie } = await signUpVerifiedUser('pack-basic@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)

    const pack = await toggle(cookie, list.id, foodId, true, plan.id)
    expect(pack).toEqual({ foodItemId: foodId, packed: true, applied: true })
    expect(await packedIds(cookie, list.id)).toEqual([foodId])

    const unpack = await toggle(cookie, list.id, foodId, false, plan.id)
    expect(unpack).toEqual({ foodItemId: foodId, packed: false, applied: true })
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('packing twice is not an error, and not a rollback signal', async () => {
    // ON CONFLICT DO NOTHING makes the retry idempotent; applied must stay
    // TRUE - the compare-and-swap held and the state reflects the request.
    // applied:false here would make the client roll back a truthful tick.
    const { cookie } = await signUpVerifiedUser('pack-idem@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)

    const first = await toggle(cookie, list.id, foodId, true, plan.id)
    const second = await toggle(cookie, list.id, foodId, true, plan.id)
    expect(first.applied).toBe(true)
    expect(second.applied).toBe(true)
    expect(await packedIds(cookie, list.id)).toEqual([foodId])

    // Unpacking an already-unpacked food is the mirror image.
    await toggle(cookie, list.id, foodId, false, plan.id)
    const again = await toggle(cookie, list.id, foodId, false, plan.id)
    expect(again.applied).toBe(true)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('packing a food that is not in the plan affects zero rows', async () => {
    const { cookie } = await signUpVerifiedUser('pack-not-in@example.com', 'P')
    const { list, plan } = await scene(cookie)
    const strayFood = await createFood(cookie, 'Not on the menu')

    const res = await toggle(cookie, list.id, strayFood, true, plan.id)
    expect(res.applied).toBe(false)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('a stale pack carrying the old plan id loses: zero rows', async () => {
    // THE case rev 2's "is the food in the current plan" check failed: plans
    // A and B both contain ramen, the list has moved from A to B, and a
    // delayed toggle still carries A. Without the compare-and-swap the check
    // against B passes and a phantom checkmark appears (design 6, rule 3).
    const { cookie } = await signUpVerifiedUser('pack-race@example.com', 'P')
    const list = await createList(cookie, 'Trip')
    let planA = await createPlan(cookie, 'Plan A')
    let planB = await createPlan(cookie, 'Plan B')
    const ramen = await createFood(cookie, 'Ramen')
    planA = await addToCell(cookie, planA, ramen, 0, 0)
    planB = await addToCell(cookie, planB, ramen, 0, 0)

    await attach(cookie, list.id, planA.id)
    // The client renders the checklist (observes plan A)... then the list
    // switches to plan B before the click lands.
    await attach(cookie, list.id, planB.id)

    const stale = await toggle(cookie, list.id, ramen, true, planA.id)
    expect(stale.applied).toBe(false)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('a stale unpack must not delete a checkmark made under the new plan', async () => {
    // The inverse race: an unconditional unpack would delete the row the
    // user packed under plan B because a delayed plan-A request arrived.
    const { cookie } = await signUpVerifiedUser('unpack-race@example.com', 'P')
    const list = await createList(cookie, 'Trip')
    let planA = await createPlan(cookie, 'Plan A')
    let planB = await createPlan(cookie, 'Plan B')
    const ramen = await createFood(cookie, 'Ramen')
    planA = await addToCell(cookie, planA, ramen, 0, 0)
    planB = await addToCell(cookie, planB, ramen, 0, 0)

    await attach(cookie, list.id, planA.id)
    await attach(cookie, list.id, planB.id)
    // Packed under the CURRENT plan (B)...
    await toggle(cookie, list.id, ramen, true, planB.id)

    // ...then the stale plan-A unpack lands. It must lose.
    const stale = await toggle(cookie, list.id, ramen, false, planA.id)
    expect(stale.applied).toBe(false)
    expect(await packedIds(cookie, list.id)).toEqual([ramen])
  })

  it('a toggle against a list with no plan attached affects zero rows', async () => {
    const { cookie } = await signUpVerifiedUser('pack-no-plan@example.com', 'P')
    const list = await createList(cookie, 'Trip')
    let plan = await createPlan(cookie, 'Menu')
    const foodId = await createFood(cookie, 'Ramen')
    plan = await addToCell(cookie, plan, foodId, 0, 0)
    // Never attached: the expectation cannot match a null link.
    const res = await toggle(cookie, list.id, foodId, true, plan.id)
    expect(res.applied).toBe(false)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('rejects malformed toggle bodies', async () => {
    const { cookie } = await signUpVerifiedUser('pack-bad-body@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)
    for (const body of [
      { packed: true }, // the compare-and-swap value is not optional
      { packed: true, expectedFoodPlanId: null }, // and not nullable
      { packed: 'yes', expectedFoodPlanId: plan.id },
      { packed: true, expectedFoodPlanId: plan.id, extra: 1 },
    ]) {
      const res = await apiRequest(
        cookie,
        'PUT',
        `/api/lists/${list.id}/food-pack/${foodId}`,
        body,
      )
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('clear on relink (rule 1)', () => {
  it('switching plans unpacks a food both plans contain', async () => {
    // The ambush this rule exists for: plan B also contains ramen, so
    // without the clear the new checklist renders ramen PRE-CHECKED under a
    // plan the user has never packed for.
    const { cookie } = await signUpVerifiedUser('relink@example.com', 'P')
    const list = await createList(cookie, 'Trip')
    let planA = await createPlan(cookie, 'Plan A')
    let planB = await createPlan(cookie, 'Plan B')
    const ramen = await createFood(cookie, 'Ramen')
    planA = await addToCell(cookie, planA, ramen, 0, 0)
    planB = await addToCell(cookie, planB, ramen, 0, 0)

    await attach(cookie, list.id, planA.id)
    await toggle(cookie, list.id, ramen, true, planA.id)
    expect(await packedIds(cookie, list.id)).toEqual([ramen])

    await attach(cookie, list.id, planB.id)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('a no-op re-attach of the SAME plan keeps the checkmarks', async () => {
    // Rule 1 fires when the link CHANGES. Re-attaching the plan a list
    // already holds is a no-op 200 (picker double-click, retried request) -
    // an unconditional clear-on-attach would wipe a half-finished packing
    // session for nothing.
    const { cookie } = await signUpVerifiedUser('reattach-noop@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)
    await toggle(cookie, list.id, foodId, true, plan.id)

    await attach(cookie, list.id, plan.id)
    expect(await packedIds(cookie, list.id)).toEqual([foodId])
  })

  it('detach clears, and re-attaching the same plan starts unpacked', async () => {
    const { cookie } = await signUpVerifiedUser('detach-clear@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)
    await toggle(cookie, list.id, foodId, true, plan.id)

    const detach = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${list.id}/food-plan`,
    )
    expect(detach.status).toBe(200)
    expect(await packedIds(cookie, list.id)).toEqual([])

    await attach(cookie, list.id, plan.id)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('deleting the attached plan clears the pack state with it', async () => {
    // Plan delete detaches the holding list (2.3); the same batch must clear
    // the checkmarks BEFORE the detach destroys the link that finds them.
    const { cookie } = await signUpVerifiedUser('plan-del@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)
    await toggle(cookie, list.id, foodId, true, plan.id)

    const del = await apiRequest(cookie, 'DELETE', `/api/food-plans/${plan.id}`)
    expect(del.status).toBe(204)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('replacing the plan via Duplicate & attach starts the copy unpacked', async () => {
    // Duplicate-with-listId re-points the list at the fresh copy in one
    // transaction - a relink like any other, so the checkmarks clear.
    const { cookie } = await signUpVerifiedUser('dup-attach@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)
    await toggle(cookie, list.id, foodId, true, plan.id)

    const dup = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/duplicate`,
      { listId: list.id, expectedFoodPlanId: plan.id },
    )
    expect(dup.status).toBe(201)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })
})

describe('reconcile after plan mutations (rule 2)', () => {
  it('a multi-cell food survives losing one cell, clears on losing the last', async () => {
    const { cookie } = await signUpVerifiedUser('multi-cell@example.com', 'P')
    const list = await createList(cookie, 'Trip')
    let plan = await createPlan(cookie, 'Menu')
    const ramen = await createFood(cookie, 'Ramen')
    const oats = await createFood(cookie, 'Oats')
    plan = await addToCell(cookie, plan, ramen, 0, 0)
    plan = await addToCell(cookie, plan, ramen, 1, 0)
    plan = await addToCell(cookie, plan, oats, 0, 1)
    await attach(cookie, list.id, plan.id)
    await toggle(cookie, list.id, ramen, true, plan.id)
    await toggle(cookie, list.id, oats, true, plan.id)

    const ramenEntries = plan.entries.filter((e) => e.foodItemId === ramen)
    expect(ramenEntries).toHaveLength(2)

    // Delete one of ramen's two cells: the checkmark SURVIVES (the food is
    // still in the plan), and oats is untouched.
    const first = await apiRequest(
      cookie,
      'DELETE',
      `/api/food-plans/${plan.id}/entries/${ramenEntries[0]!.id}`,
    )
    expect(first.status).toBe(200)
    expect((await packedIds(cookie, list.id)).sort()).toEqual(
      [ramen, oats].sort(),
    )

    // Delete the last occurrence: ramen's checkmark clears, oats survives.
    const last = await apiRequest(
      cookie,
      'DELETE',
      `/api/food-plans/${plan.id}/entries/${ramenEntries[1]!.id}`,
    )
    expect(last.status).toBe(200)
    expect(await packedIds(cookie, list.id)).toEqual([oats])
  })

  it('deleting a day that held the last occurrence clears the checkmark', async () => {
    // The cascade path: the entry dies with the day's cells, so a per-entry
    // cleanup would never see it - the reconcile is against what REMAINS.
    const { cookie } = await signUpVerifiedUser('day-cascade@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie) // food in day 0, meal 0
    await toggle(cookie, list.id, foodId, true, plan.id)

    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/food-plans/${plan.id}/days/${plan.days[0]!.id}`,
    )
    expect(res.status).toBe(200)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('deleting a meal that held the last occurrence clears the checkmark', async () => {
    const { cookie } = await signUpVerifiedUser('meal-cascade@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)
    await toggle(cookie, list.id, foodId, true, plan.id)

    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/food-plans/${plan.id}/meals/${plan.meals[0]!.id}`,
    )
    expect(res.status).toBe(200)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })

  it('un-scheduling the cell that held the last occurrence clears the checkmark', async () => {
    const { cookie } = await signUpVerifiedUser('cell-cascade@example.com', 'P')
    const { list, plan, foodId } = await scene(cookie)
    await toggle(cookie, list.id, foodId, true, plan.id)

    const entry = plan.entries.find((e) => e.foodItemId === foodId)
    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/food-plans/${plan.id}/day-meals/${entry!.dayMealId}`,
    )
    expect(res.status).toBe(200)
    expect(await packedIds(cookie, list.id)).toEqual([])
  })
})

describe('reset (DELETE /api/lists/:id/food-pack)', () => {
  it('clears every checkmark on the list and only that list', async () => {
    const { cookie } = await signUpVerifiedUser('pack-reset@example.com', 'P')
    const one = await scene(cookie)
    // A second, independent trip whose checkmark must survive the reset.
    const other = await createList(cookie, 'Other trip')
    let otherPlan = await createPlan(cookie, 'Other menu')
    const otherFood = await createFood(cookie, 'Couscous')
    otherPlan = await addToCell(cookie, otherPlan, otherFood, 0, 0)
    await attach(cookie, other.id, otherPlan.id)

    await toggle(cookie, one.list.id, one.foodId, true, one.plan.id)
    await toggle(cookie, other.id, otherFood, true, otherPlan.id)

    const res = await apiRequest(
      cookie,
      'DELETE',
      `/api/lists/${one.list.id}/food-pack`,
    )
    expect(res.status).toBe(204)
    expect(await packedIds(cookie, one.list.id)).toEqual([])
    expect(await packedIds(cookie, other.id)).toEqual([otherFood])
  })
})
