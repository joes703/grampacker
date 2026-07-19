import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  foodPlanDocumentSchema,
  foodPlanSummarySchema,
  type FoodPlanDocument,
} from '../../shared/food-plans'
import { isAnyUniqueViolation, isForeignKeyViolation } from '../repos/db-errors'
import {
  isFoodPlanCapError,
  isFoodPlanDayCapError,
  isFoodPlanEntryCapError,
  isMealCapError,
} from '../repos/food-plans'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'
import { CSRF_HEADER } from '../middleware/csrf'
import app from '../index'

async function userIdFor(cookie: string): Promise<string> {
  const res = await apiRequest(cookie, 'GET', '/api/me')
  const body = (await res.json()) as { id: string }
  return body.id
}

async function createPlan(
  cookie: string,
  body: Record<string, unknown>,
): Promise<FoodPlanDocument> {
  const res = await apiRequest(cookie, 'POST', '/api/food-plans', body)
  if (res.status !== 201) throw new Error(`create plan failed: ${res.status}`)
  return foodPlanDocumentSchema.parse(await res.json())
}

async function createFood(
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await apiRequest(cookie, 'POST', '/api/food-items', body)
  if (res.status !== 201) throw new Error(`create food failed: ${res.status}`)
  return (await res.json()) as { id: string }
}

// A cell id for a given day + meal in a plan document.
function cellId(doc: FoodPlanDocument, dayId: string, mealId: string): string {
  const cell = doc.dayMeals.find(
    (dm) => dm.dayId === dayId && dm.mealId === mealId,
  )
  if (!cell) throw new Error('cell not found')
  return cell.id
}

function mealByRole(doc: FoodPlanDocument, role: 'breakfast' | 'dinner') {
  const meal = doc.meals.find((m) => m.anchorRole === role)
  if (!meal) throw new Error(`no ${role} meal`)
  return meal
}

const DOC_KEYS = [
  'id',
  'name',
  'sortOrder',
  'createdAt',
  'updatedAt',
  'meals',
  'days',
  'dayMeals',
  'entries',
  'dailyTargets',
  'mealTargets',
  'usedByList',
].sort()

const SUMMARY_KEYS = [
  'id',
  'name',
  'sortOrder',
  'dayCount',
  'entryCount',
  'usedByListId',
  'usedByListName',
  'createdAt',
  'updatedAt',
].sort()

describe('/api/food-plans authorization matrix', () => {
  it('anon requests are 401 on every route', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/food-plans', undefined],
      ['POST', '/api/food-plans', { name: 'X' }],
      ['GET', '/api/food-plans/some-id', undefined],
      ['PATCH', '/api/food-plans/some-id', { name: 'Y' }],
      ['DELETE', '/api/food-plans/some-id', undefined],
      ['POST', '/api/food-plans/some-id/days', undefined],
      ['DELETE', '/api/food-plans/some-id/days/d', undefined],
      ['PATCH', '/api/food-plans/some-id/days/d', { dayTypeOverride: 'partial' }],
      ['POST', '/api/food-plans/some-id/meals', { name: 'M' }],
      ['DELETE', '/api/food-plans/some-id/meals/m', undefined],
      ['POST', '/api/food-plans/some-id/day-meals', { dayId: 'd', mealId: 'm' }],
      ['DELETE', '/api/food-plans/some-id/day-meals/dm', undefined],
      [
        'POST',
        '/api/food-plans/some-id/entries',
        { dayMealId: 'dm', foodItemId: 'f', basis: 'servings', amount: 1 },
      ],
      ['PATCH', '/api/food-plans/some-id/entries/e', { amount: 2 }],
      ['DELETE', '/api/food-plans/some-id/entries/e', undefined],
      ['POST', '/api/food-plans/some-id/duplicate', undefined],
      ['PUT', '/api/food-plans/some-id/targets', { daily: [], meals: [] }],
    ] as const) {
      const res = await apiRequest(null, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

  it('GET / and GET /:id of another user are isolated', async () => {
    const a = await signUpVerifiedUser('plan-iso-a@example.com', 'A')
    const b = await signUpVerifiedUser('plan-iso-b@example.com', 'B')
    const mine = await createPlan(a.cookie, { name: 'Mine' })
    await createPlan(b.cookie, { name: 'Theirs' })

    const listRes = await apiRequest(a.cookie, 'GET', '/api/food-plans')
    const summaries = foodPlanSummarySchema.array().parse(await listRes.json())
    expect(summaries.map((s) => s.id)).toEqual([mine.id])

    // B cannot read A's plan.
    const cross = await apiRequest(b.cookie, 'GET', `/api/food-plans/${mine.id}`)
    expect(cross.status).toBe(404)
    // ...nor rename or delete it.
    const crossPatch = await apiRequest(
      b.cookie,
      'PATCH',
      `/api/food-plans/${mine.id}`,
      { name: 'hijack' },
    )
    expect(crossPatch.status).toBe(404)
    const crossDelete = await apiRequest(
      b.cookie,
      'DELETE',
      `/api/food-plans/${mine.id}`,
    )
    expect(crossDelete.status).toBe(404)
  })
})

describe('/api/food-plans summaries', () => {
  it('is a strict allowlist and names the list using each plan', async () => {
    const { cookie } = await signUpVerifiedUser('plan-summary@example.com', 'S')
    const used = await createPlan(cookie, { name: 'Used', days: 2 })
    await createPlan(cookie, { name: 'Free', days: 1 })
    const listRes = await apiRequest(cookie, 'POST', '/api/lists', {
      name: 'Yosemite',
    })
    expect(listRes.status).toBe(201)
    const list = (await listRes.json()) as { id: string }
    const attachRes = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${list.id}/food-plan`,
      { foodPlanId: used.id },
    )
    expect(attachRes.status).toBe(200)

    const res = await apiRequest(cookie, 'GET', '/api/food-plans')
    const raw = (await res.json()) as Record<string, unknown>[]
    // Strict key set on the RAW json (no userId leak, and the usedBy pair is
    // actually on the wire, not just tolerated by a lenient parser).
    for (const row of raw) {
      expect(Object.keys(row).sort()).toEqual(SUMMARY_KEYS)
    }
    const summaries = foodPlanSummarySchema.array().parse(raw)
    const usedRow = summaries.find((s) => s.id === used.id)!
    expect(usedRow.usedByListId).toBe(list.id)
    expect(usedRow.usedByListName).toBe('Yosemite')
    // One plan per trip: a plan nobody holds reports null, not [].
    const freeRow = summaries.find((s) => s.name === 'Free')!
    expect(freeRow.usedByListId).toBeNull()
    expect(freeRow.usedByListName).toBeNull()

    // The counts must be REAL values, per plan, on the wire. The original
    // correlated-subselect form rendered its columns unqualified (drizzle
    // renders sql`` fragments unqualified in single-table selects), which
    // made every plan report 0 days / 0 items; the page tests mock the
    // fetcher, so only this assertion can catch that class of bug.
    expect(usedRow.dayCount).toBe(2)
    expect(freeRow.dayCount).toBe(1)
    expect(usedRow.entryCount).toBe(0)
  })
})

describe('/api/food-plans create + seed', () => {
  it('seeds 3 meals, N days, a full grid; defaults to 3 days', async () => {
    const { cookie } = await signUpVerifiedUser('plan-seed@example.com', 'S')

    const two = await createPlan(cookie, { name: '2-night trip', days: 2 })
    expect(two.name).toBe('2-night trip')
    expect(two.meals.map((m) => m.name)).toEqual([
      'Breakfast',
      'On-trail food',
      'Dinner',
    ])
    expect(mealByRole(two, 'breakfast').isDefault).toBe(true)
    expect(two.meals.find((m) => m.name === 'On-trail food')?.anchorRole).toBe(
      null,
    )
    expect(two.days).toHaveLength(2)
    // Full grid: every day x every meal.
    expect(two.dayMeals).toHaveLength(6)
    expect(two.entries).toHaveLength(0)

    const def = await createPlan(cookie, { name: 'default days' })
    expect(def.days).toHaveLength(3)
    expect(def.dayMeals).toHaveLength(9)
  })

  it('rejects a bad body (400) and out-of-range day counts', async () => {
    const { cookie } = await signUpVerifiedUser('plan-badbody@example.com', 'B')
    for (const body of [{}, { name: '' }, { name: 'X', days: 0 }, { name: 'X', days: 61 }]) {
      const res = await apiRequest(cookie, 'POST', '/api/food-plans', body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('the document body is a strict allowlist (no userId leak) on RAW json', async () => {
    const { cookie } = await signUpVerifiedUser('plan-allowlist@example.com', 'A')
    const res = await apiRequest(cookie, 'POST', '/api/food-plans', {
      name: 'Raw',
      days: 1,
    })
    const doc = (await res.json()) as Record<string, unknown>
    expect(Object.keys(doc).sort()).toEqual(DOC_KEYS)
    expect(doc).not.toHaveProperty('userId')
    for (const arr of ['meals', 'days', 'dayMeals', 'entries'] as const) {
      for (const row of doc[arr] as Record<string, unknown>[]) {
        expect(row).not.toHaveProperty('userId')
        expect(row).not.toHaveProperty('user_id')
        expect(row).not.toHaveProperty('foodPlanId')
      }
    }
  })
})

describe('/api/food-plans entries: the core workflow', () => {
  it('adds a food to a cell and to Extras; enforces XOR and duplicates', async () => {
    const { cookie } = await signUpVerifiedUser('plan-entries@example.com', 'E')
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    const food = await createFood(cookie, {
      name: 'Ramen',
      servingWeightGrams: 85,
      caloriesPerServing: 380,
      servingsPerPackage: 2,
    })
    const breakfast = mealByRole(plan, 'breakfast')
    const cell = cellId(plan, plan.days[0]!.id, breakfast.id)

    // Add to the cell.
    const addRes = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/entries`,
      { dayMealId: cell, foodItemId: food.id, basis: 'servings', amount: 2 },
    )
    expect(addRes.status).toBe(201)
    const afterAdd = foodPlanDocumentSchema.parse(await addRes.json())
    expect(afterAdd.entries).toHaveLength(1)
    expect(afterAdd.entries[0]).toMatchObject({
      dayMealId: cell,
      isExtra: false,
      foodItemId: food.id,
      basis: 'servings',
      amount: 2,
    })

    // Same food in the same cell again -> 409.
    const dup = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/entries`,
      { dayMealId: cell, foodItemId: food.id, basis: 'servings', amount: 1 },
    )
    expect(dup.status).toBe(409)

    // Add the same food to Extras -> allowed (different bucket).
    const extra = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/entries`,
      { isExtra: true, foodItemId: food.id, basis: 'packages', amount: 1 },
    )
    expect(extra.status).toBe(201)
    const afterExtra = foodPlanDocumentSchema.parse(await extra.json())
    expect(afterExtra.entries.filter((e) => e.isExtra)).toHaveLength(1)

    // XOR violations are 400 (zod refine mirrors the DB CHECK).
    const bothSet = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/entries`,
      { dayMealId: cell, isExtra: true, foodItemId: food.id, basis: 'weight', amount: 5 },
    )
    expect(bothSet.status).toBe(400)
    const neither = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/entries`,
      { foodItemId: food.id, basis: 'weight', amount: 5 },
    )
    expect(neither.status).toBe(400)
  })

  it('accepts a packages entry whose food has no servings_per_package (incomplete, not rejected)', async () => {
    // The design (5.4) deviation from the old build: this is a projection
    // incompleteness, flagged client-side, NOT a write-time error.
    const { cookie } = await signUpVerifiedUser('plan-incomplete@example.com', 'I')
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    const byWeightFood = await createFood(cookie, {
      name: 'Trail mix (bulk)',
      servingWeightGrams: 30,
      caloriesPerServing: 150,
      // servingsPerPackage omitted -> null
    })
    const cell = cellId(plan, plan.days[0]!.id, mealByRole(plan, 'dinner').id)

    const res = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/entries`,
      { dayMealId: cell, foodItemId: byWeightFood.id, basis: 'packages', amount: 1 },
    )
    expect(res.status).toBe(201)
  })

  it('rejects entries referencing a non-owned food or a cell from another plan (422)', async () => {
    const a = await signUpVerifiedUser('plan-ref-a@example.com', 'A')
    const b = await signUpVerifiedUser('plan-ref-b@example.com', 'B')
    const planA = await createPlan(a.cookie, { name: 'A plan', days: 1 })
    const planA2 = await createPlan(a.cookie, { name: 'A plan 2', days: 1 })
    const foodB = await createFood(b.cookie, {
      name: "B's food",
      servingWeightGrams: 10,
      caloriesPerServing: 50,
    })
    const foodA = await createFood(a.cookie, {
      name: "A's food",
      servingWeightGrams: 10,
      caloriesPerServing: 50,
    })
    const cellA = cellId(planA, planA.days[0]!.id, mealByRole(planA, 'breakfast').id)
    const cellA2 = cellId(
      planA2,
      planA2.days[0]!.id,
      mealByRole(planA2, 'breakfast').id,
    )

    // A references B's food.
    const foreignFood = await apiRequest(
      a.cookie,
      'POST',
      `/api/food-plans/${planA.id}/entries`,
      { dayMealId: cellA, foodItemId: foodB.id, basis: 'servings', amount: 1 },
    )
    expect(foreignFood.status).toBe(422)

    // A references a cell that belongs to a DIFFERENT plan of A's.
    const foreignCell = await apiRequest(
      a.cookie,
      'POST',
      `/api/food-plans/${planA.id}/entries`,
      { dayMealId: cellA2, foodItemId: foodA.id, basis: 'servings', amount: 1 },
    )
    expect(foreignCell.status).toBe(422)
  })

  it('edits and removes an entry; switching basis to packages is allowed', async () => {
    const { cookie } = await signUpVerifiedUser('plan-edit@example.com', 'E')
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    const food = await createFood(cookie, {
      name: 'Oats',
      servingWeightGrams: 40,
      caloriesPerServing: 150,
    })
    const cell = cellId(plan, plan.days[0]!.id, mealByRole(plan, 'breakfast').id)
    const added = foodPlanDocumentSchema.parse(
      await (
        await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/entries`, {
          dayMealId: cell,
          foodItemId: food.id,
          basis: 'servings',
          amount: 2,
        })
      ).json(),
    )
    const entryId = added.entries[0]!.id

    // Edit amount + switch basis to packages (food has no servings_per_package).
    const patched = await apiRequest(
      cookie,
      'PATCH',
      `/api/food-plans/${plan.id}/entries/${entryId}`,
      { amount: 3, basis: 'packages' },
    )
    expect(patched.status).toBe(200)
    const afterPatch = foodPlanDocumentSchema.parse(await patched.json())
    expect(afterPatch.entries[0]).toMatchObject({ amount: 3, basis: 'packages' })

    // Empty patch -> 400.
    const empty = await apiRequest(
      cookie,
      'PATCH',
      `/api/food-plans/${plan.id}/entries/${entryId}`,
      {},
    )
    expect(empty.status).toBe(400)

    // Remove.
    const removed = await apiRequest(
      cookie,
      'DELETE',
      `/api/food-plans/${plan.id}/entries/${entryId}`,
    )
    expect(removed.status).toBe(200)
    expect(foodPlanDocumentSchema.parse(await removed.json()).entries).toHaveLength(0)
  })
})

describe('/api/food-plans structure: days, meals, cells', () => {
  it('adds/removes days and meals, filling and cascading the grid', async () => {
    const { cookie } = await signUpVerifiedUser('plan-struct@example.com', 'S')
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    // 1 day x 3 meals = 3 cells.
    expect(plan.dayMeals).toHaveLength(3)

    // Add a day -> +1 day, +3 cells (grid row for the 3 meals).
    const withDay = foodPlanDocumentSchema.parse(
      await (
        await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/days`)
      ).json(),
    )
    expect(withDay.days).toHaveLength(2)
    expect(withDay.dayMeals).toHaveLength(6)

    // Add a meal -> +1 meal, +2 cells (one per day).
    const withMeal = foodPlanDocumentSchema.parse(
      await (
        await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/meals`, {
          name: 'Lunch',
        })
      ).json(),
    )
    expect(withMeal.meals).toHaveLength(4)
    expect(withMeal.dayMeals).toHaveLength(8) // 2 days x 4 meals
    const lunch = withMeal.meals.find((m) => m.name === 'Lunch')!
    expect(lunch).toMatchObject({ anchorRole: null, isDefault: false })

    // Remove that meal -> back to 3 meals, 6 cells.
    const noLunch = foodPlanDocumentSchema.parse(
      await (
        await apiRequest(
          cookie,
          'DELETE',
          `/api/food-plans/${plan.id}/meals/${lunch.id}`,
        )
      ).json(),
    )
    expect(noLunch.meals).toHaveLength(3)
    expect(noLunch.dayMeals).toHaveLength(6)
  })

  it('removing a day cascades its cells and entries', async () => {
    const { cookie } = await signUpVerifiedUser('plan-daycascade@example.com', 'D')
    const plan = await createPlan(cookie, { name: 'Trip', days: 2 })
    const food = await createFood(cookie, {
      name: 'Bar',
      servingWeightGrams: 60,
      caloriesPerServing: 250,
    })
    const day0 = plan.days[0]!.id
    const cell = cellId(plan, day0, mealByRole(plan, 'breakfast').id)
    await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/entries`, {
      dayMealId: cell,
      foodItemId: food.id,
      basis: 'servings',
      amount: 1,
    })

    const after = foodPlanDocumentSchema.parse(
      await (
        await apiRequest(
          cookie,
          'DELETE',
          `/api/food-plans/${plan.id}/days/${day0}`,
        )
      ).json(),
    )
    expect(after.days).toHaveLength(1)
    expect(after.days.map((d) => d.id)).not.toContain(day0)
    // The entry lived in a cell of the removed day -> gone.
    expect(after.entries).toHaveLength(0)
    expect(after.dayMeals.every((dm) => dm.dayId !== day0)).toBe(true)
  })

  it('omits and restores a cell (idempotent); rejects a foreign day/meal', async () => {
    const { cookie } = await signUpVerifiedUser('plan-cells@example.com', 'C')
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    const dinner = mealByRole(plan, 'dinner')
    const day0 = plan.days[0]!.id
    const cell = cellId(plan, day0, dinner.id)

    // Omit the dinner cell on day 0.
    const omitted = foodPlanDocumentSchema.parse(
      await (
        await apiRequest(
          cookie,
          'DELETE',
          `/api/food-plans/${plan.id}/day-meals/${cell}`,
        )
      ).json(),
    )
    expect(omitted.dayMeals).toHaveLength(2)
    expect(omitted.dayMeals.map((dm) => dm.id)).not.toContain(cell)

    // Restore it.
    const restored = foodPlanDocumentSchema.parse(
      await (
        await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/day-meals`, {
          dayId: day0,
          mealId: dinner.id,
        })
      ).json(),
    )
    expect(restored.dayMeals).toHaveLength(3)

    // Restoring again is idempotent (still 3, still 201).
    const again = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/day-meals`,
      { dayId: day0, mealId: dinner.id },
    )
    expect(again.status).toBe(201)
    expect(foodPlanDocumentSchema.parse(await again.json()).dayMeals).toHaveLength(3)

    // A day/meal not in this plan -> 422.
    const foreign = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/day-meals`,
      { dayId: 'nope', mealId: dinner.id },
    )
    expect(foreign.status).toBe(422)
  })
})

describe('/api/food-plans delete cascades', () => {
  it('deleting a plan removes its whole graph', async () => {
    const { cookie } = await signUpVerifiedUser('plan-delete@example.com', 'D')
    const userId = await userIdFor(cookie)
    const food = await createFood(cookie, {
      name: 'X',
      servingWeightGrams: 10,
      caloriesPerServing: 50,
    })
    const plan = await createPlan(cookie, { name: 'Doomed', days: 2 })
    const cell = cellId(plan, plan.days[0]!.id, mealByRole(plan, 'breakfast').id)
    await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/entries`, {
      dayMealId: cell,
      foodItemId: food.id,
      basis: 'servings',
      amount: 1,
    })

    const del = await apiRequest(cookie, 'DELETE', `/api/food-plans/${plan.id}`)
    expect(del.status).toBe(204)
    const gone = await apiRequest(cookie, 'GET', `/api/food-plans/${plan.id}`)
    expect(gone.status).toBe(404)

    // The child rows are gone too (the food itself survives - different table).
    for (const table of ['meals', 'food_plan_days', 'day_meals', 'food_plan_entries']) {
      const { count } = (await env.DB.prepare(
        `select count(*) as count from ${table} where user_id = ?`,
      )
        .bind(userId)
        .first()) as { count: number }
      expect(count, table).toBe(0)
    }
    const { count: foods } = (await env.DB.prepare(
      'select count(*) as count from food_items where user_id = ?',
    )
      .bind(userId)
      .first()) as { count: number }
    expect(foods).toBe(1)
  })
})

// The fork (design 3.1/12.9): a deep copy with fresh ids referencing the same
// account-wide foods; listId re-points the arriving trip at the copy in the
// same transaction.
describe('/api/food-plans duplicate', () => {
  async function createList(
    cookie: string,
    name: string,
  ): Promise<{ id: string; foodPlanId: string | null }> {
    const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
    if (res.status !== 201) throw new Error(`create list failed: ${res.status}`)
    return (await res.json()) as { id: string; foodPlanId: string | null }
  }

  async function attach(cookie: string, listId: string, planId: string) {
    const res = await apiRequest(cookie, 'PUT', `/api/lists/${listId}/food-plan`, {
      foodPlanId: planId,
    })
    if (res.status !== 200) throw new Error(`attach failed: ${res.status}`)
  }

  it('deep-copies the graph with fresh ids, same foods, and a "(copy)" name', async () => {
    const { cookie } = await signUpVerifiedUser('plan-dup@example.com', 'D')
    const food = await createFood(cookie, {
      name: 'Ramen',
      servingWeightGrams: 80,
      caloriesPerServing: 350,
    })
    const source = await createPlan(cookie, { name: 'Sierra loop', days: 2 })
    const cell = cellId(source, source.days[0]!.id, mealByRole(source, 'dinner').id)
    await apiRequest(cookie, 'POST', `/api/food-plans/${source.id}/entries`, {
      dayMealId: cell,
      foodItemId: food.id,
      basis: 'servings',
      amount: 2,
    })
    await apiRequest(cookie, 'POST', `/api/food-plans/${source.id}/entries`, {
      isExtra: true,
      foodItemId: food.id,
      basis: 'weight',
      amount: 150,
    })

    const res = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${source.id}/duplicate`,
    )
    expect(res.status).toBe(201)
    const copy = foodPlanDocumentSchema.parse(await res.json())

    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('Sierra loop (copy)')
    expect(copy.meals).toHaveLength(3)
    expect(copy.days).toHaveLength(2)
    expect(copy.dayMeals).toHaveLength(6)
    expect(copy.entries).toHaveLength(2)
    expect(copy.usedByList).toBeNull()

    // Fresh ids THROUGHOUT - no copied row keeps a source id.
    const sourceIds = new Set([
      ...source.meals.map((m) => m.id),
      ...source.days.map((d) => d.id),
      ...source.dayMeals.map((dm) => dm.id),
    ])
    const copyIds = [
      ...copy.meals.map((m) => m.id),
      ...copy.days.map((d) => d.id),
      ...copy.dayMeals.map((dm) => dm.id),
      ...copy.entries.map((e) => e.id),
    ]
    expect(copyIds.some((id) => sourceIds.has(id))).toBe(false)

    // The remap preserved structure: the cell entry landed in the copy's
    // (day sortOrder 0, dinner) cell, and the Extras entry stayed in Extras.
    const cellEntry = copy.entries.find((e) => !e.isExtra)!
    const copyCell = copy.dayMeals.find((dm) => dm.id === cellEntry.dayMealId)!
    expect(copy.days.find((d) => d.id === copyCell.dayId)!.sortOrder).toBe(0)
    expect(copy.meals.find((m) => m.id === copyCell.mealId)!.anchorRole).toBe('dinner')
    const extrasEntry = copy.entries.find((e) => e.isExtra)!
    expect(extrasEntry.dayMealId).toBeNull()
    // Foods are referenced, not copied (account-wide library).
    expect(cellEntry.foodItemId).toBe(food.id)
    expect(extrasEntry.foodItemId).toBe(food.id)
    expect(extrasEntry.basis).toBe('weight')
    expect(extrasEntry.amount).toBe(150)

    // The source is untouched.
    const sourceAfterRes = await apiRequest(
      cookie,
      'GET',
      `/api/food-plans/${source.id}`,
    )
    const sourceAfter = foodPlanDocumentSchema.parse(await sourceAfterRes.json())
    expect(sourceAfter.name).toBe('Sierra loop')
    expect(sourceAfter.entries).toHaveLength(2)
  })

  it('with listId, attaches the copy to that list in the same call (Duplicate & attach)', async () => {
    // The picker flow under one plan per trip: the taker's picker showed the
    // source as "In use by Winter trip", so selecting it duplicates and
    // attaches the copy. The taker currently has no plan, so the client's
    // observed link - the CAS expectation - is null.
    const { cookie } = await signUpVerifiedUser('plan-dup-fork@example.com', 'F')
    const source = await createPlan(cookie, { name: 'Shared', days: 1 })
    const holder = await createList(cookie, 'Winter trip')
    const taker = await createList(cookie, 'Summer trip')
    await attach(cookie, holder.id, source.id)

    const res = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${source.id}/duplicate`,
      { listId: taker.id, expectedFoodPlanId: null },
    )
    expect(res.status).toBe(201)
    const copy = foodPlanDocumentSchema.parse(await res.json())

    // The returned document already knows its one user - the copy and the
    // attach were one transaction, so there is no window where this is null.
    expect(copy.usedByList).toEqual({ id: taker.id, name: 'Summer trip' })

    // The source keeps its holder.
    const sourceAfterRes = await apiRequest(
      cookie,
      'GET',
      `/api/food-plans/${source.id}`,
    )
    const sourceAfter = foodPlanDocumentSchema.parse(await sourceAfterRes.json())
    expect(sourceAfter.usedByList).toEqual({
      id: holder.id,
      name: 'Winter trip',
    })

    // And the list rows point where they should.
    const listsRes = await apiRequest(cookie, 'GET', '/api/lists')
    const rows = (await listsRes.json()) as { id: string; foodPlanId: string | null }[]
    expect(rows.find((l) => l.id === taker.id)!.foodPlanId).toBe(copy.id)
    expect(rows.find((l) => l.id === holder.id)!.foodPlanId).toBe(source.id)
  })

  it('with listId, replaces the plan the list holds when the expectation matches', async () => {
    const { cookie } = await signUpVerifiedUser('plan-dup-swap@example.com', 'S')
    const source = await createPlan(cookie, { name: 'Wanted', days: 1 })
    const outgoing = await createPlan(cookie, { name: 'Outgoing', days: 1 })
    const trip = await createList(cookie, 'Trip')
    await attach(cookie, trip.id, outgoing.id)

    const res = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${source.id}/duplicate`,
      { listId: trip.id, expectedFoodPlanId: outgoing.id },
    )
    expect(res.status).toBe(201)
    const copy = foodPlanDocumentSchema.parse(await res.json())

    // The trip follows the copy; the outgoing plan survives, now free.
    const listsRes = await apiRequest(cookie, 'GET', '/api/lists')
    const rows = (await listsRes.json()) as { id: string; foodPlanId: string | null }[]
    expect(rows.find((l) => l.id === trip.id)!.foodPlanId).toBe(copy.id)
    const outAfterRes = await apiRequest(
      cookie,
      'GET',
      `/api/food-plans/${outgoing.id}`,
    )
    const outAfter = foodPlanDocumentSchema.parse(await outAfterRes.json())
    expect(outAfter.usedByList).toBeNull()
  })

  it("rejects another user's list (422) and another user's plan (404)", async () => {
    const a = await signUpVerifiedUser('plan-dup-a@example.com', 'A')
    const b = await signUpVerifiedUser('plan-dup-b@example.com', 'B')
    const plan = await createPlan(a.cookie, { name: 'Mine' })
    const theirs = await createList(b.cookie, 'Their trip')

    const crossList = await apiRequest(
      a.cookie,
      'POST',
      `/api/food-plans/${plan.id}/duplicate`,
      { listId: theirs.id },
    )
    expect(crossList.status).toBe(422)
    const crossPlan = await apiRequest(
      b.cookie,
      'POST',
      `/api/food-plans/${plan.id}/duplicate`,
    )
    expect(crossPlan.status).toBe(404)
  })

  it('a stale expectedFoodPlanId is a 422 that leaves NO orphan copy', async () => {
    // The attach is a compare-and-swap on the link the CLIENT observed. Here
    // the trip moved to plan B after the client last looked (a second tab,
    // say) - clobbering that newer link would silently discard B, and 201-ing
    // without attaching would leave an orphan copy. Both stale expectations
    // are refused: an explicit wrong plan id, and the DTO's fail-safe default
    // (a body that omits expectedFoodPlanId means "I observed no plan").
    const { cookie } = await signUpVerifiedUser('plan-dup-cas@example.com', 'C')
    const source = await createPlan(cookie, { name: 'Plan A' })
    const planB = await createPlan(cookie, { name: 'Plan B', days: 1 })
    const trip = await createList(cookie, 'Follows B')
    await attach(cookie, trip.id, planB.id)

    // Pack a food under B first: a rejected CAS must also leave the CURRENT
    // plan's checkmarks alone (the compensating clear is gated on the swap
    // actually happening).
    const food = await createFood(cookie, {
      name: 'Ramen',
      servingWeightGrams: 85,
      caloriesPerServing: 380,
      servingsPerPackage: 2,
    })
    const day = planB.days[0]!
    const meal = planB.meals[0]!
    const cell = planB.dayMeals.find(
      (dm) => dm.dayId === day.id && dm.mealId === meal.id,
    )!
    const entry = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${planB.id}/entries`,
      { dayMealId: cell.id, foodItemId: food.id, basis: 'servings', amount: 1 },
    )
    expect(entry.status).toBe(201)
    const packRes = await apiRequest(
      cookie,
      'PUT',
      `/api/lists/${trip.id}/food-pack/${food.id}`,
      { packed: true, expectedFoodPlanId: planB.id },
    )
    expect(packRes.status).toBe(200)
    expect(await packRes.json()).toMatchObject({ applied: true })

    for (const body of [
      { listId: trip.id, expectedFoodPlanId: source.id }, // wrong plan
      { listId: trip.id, expectedFoodPlanId: null }, // observed none
      { listId: trip.id }, // omitted -> defaults to null
    ]) {
      const res = await apiRequest(
        cookie,
        'POST',
        `/api/food-plans/${source.id}/duplicate`,
        body,
      )
      expect(res.status, JSON.stringify(body)).toBe(422)
    }
    // Every failed CAS compensating-deleted its committed copy: still exactly
    // the two original plans, and the trip still follows B.
    const listRes = await apiRequest(cookie, 'GET', '/api/food-plans')
    const summaries = foodPlanSummarySchema.array().parse(await listRes.json())
    expect(summaries).toHaveLength(2)
    const listsRes = await apiRequest(cookie, 'GET', '/api/lists')
    const rows = (await listsRes.json()) as { id: string; foodPlanId: string | null }[]
    expect(rows.find((l) => l.id === trip.id)!.foodPlanId).toBe(planB.id)
    // ...and the checkmarks packed under the surviving plan are untouched.
    const packAfter = await apiRequest(cookie, 'GET', `/api/lists/${trip.id}/food-pack`)
    expect(packAfter.status).toBe(200)
    expect(await packAfter.json()).toEqual({ packedFoodItemIds: [food.id] })
  })

  it('malformed JSON is a 400, not a silent list-less duplicate', async () => {
    const { cookie } = await signUpVerifiedUser('plan-dup-json@example.com', 'J')
    const plan = await createPlan(cookie, { name: 'Fragile' })

    // apiRequest would JSON.stringify (making the body valid again), so this
    // one goes through app.request raw: a truncated object that json() rejects.
    const res = await app.request(
      `/api/food-plans/${plan.id}/duplicate`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          [CSRF_HEADER]: '1',
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: '{"listId":',
      },
      env,
    )
    expect(res.status).toBe(400)
    const after = await apiRequest(cookie, 'GET', '/api/food-plans')
    const summaries = foodPlanSummarySchema.array().parse(await after.json())
    expect(summaries).toHaveLength(1)
  })

  it('422 at the 100-plan cap, and the whole copy rolls back', async () => {
    const { cookie } = await signUpVerifiedUser('plan-dup-cap@example.com', 'C')
    const userId = await userIdFor(cookie)
    const values = Array.from({ length: 99 }, (_, i) => {
      return `('dup-cap-${i}', '${userId}', 'Seed ${i}', ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into food_plans (id, user_id, name, sort_order, created_at, updated_at) values ${values}`,
    ).run()
    const plan = await createPlan(cookie, { name: 'The 100th', days: 1 })

    const over = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/duplicate`,
    )
    expect(over.status).toBe(422)

    // The batch is a transaction: the aborted copy left no orphaned children -
    // only the source plan's own rows remain.
    const expected = {
      meals: plan.meals.length,
      food_plan_days: plan.days.length,
      day_meals: plan.dayMeals.length,
    }
    for (const [table, want] of Object.entries(expected)) {
      const { count } = (await env.DB.prepare(
        `select count(*) as count from ${table} where user_id = ?`,
      )
        .bind(userId)
        .first()) as { count: number }
      expect(count, table).toBe(want)
    }
  })

  it('duplicates a maxed-out plan (60 days, 20 meals, 1200 cells, 2000 entries) through the chunked batch', async () => {
    const { cookie } = await signUpVerifiedUser('plan-dup-max@example.com', 'M')
    const userId = await userIdFor(cookie)
    // Every cap at its ceiling: 60 days at create, then 17 more meals on top
    // of the seeded 3 = 20, giving the full 1200-cell grid.
    let plan = await createPlan(cookie, { name: 'Max', days: 60 })
    for (let i = 0; i < 17; i++) {
      const res = await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/meals`, {
        name: `Meal ${i}`,
      })
      expect(res.status).toBe(201)
      plan = foodPlanDocumentSchema.parse(await res.json())
    }
    expect(plan.dayMeals).toHaveLength(1200)
    const day0 = plan.days[0]!.id
    const cellBreakfast = cellId(plan, day0, mealByRole(plan, 'breakfast').id)
    const cellDinner = cellId(plan, day0, mealByRole(plan, 'dinner').id)

    // Same seeding shape as the entry-cap test: 1000 foods spread across two
    // cells = 2000 entries, inserted in 250-row chunks (SQLITE_TOOBIG guard).
    const CHUNK = 250
    for (let i = 0; i < 1000; i += CHUNK) {
      const rows = Array.from(
        { length: Math.min(CHUNK, 1000 - i) },
        (_, j) => `('df-${i + j}', '${userId}', 'Dup food ${i + j}', 1, 0, ${i + j}, 0, 0)`,
      ).join(',')
      await env.DB.prepare(
        `insert into food_items (id, user_id, name, serving_weight_grams, calories_per_serving, sort_order, created_at, updated_at) values ${rows}`,
      ).run()
    }
    for (const cell of [cellBreakfast, cellDinner]) {
      for (let i = 0; i < 1000; i += CHUNK) {
        const rows = Array.from(
          { length: Math.min(CHUNK, 1000 - i) },
          (_, j) =>
            `('de-${cell}-${i + j}', '${userId}', '${plan.id}', '${cell}', 0, 'df-${i + j}', 'servings', 1, ${i + j}, 0, 0)`,
        ).join(',')
        await env.DB.prepare(
          `insert into food_plan_entries (id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order, created_at, updated_at) values ${rows}`,
        ).run()
      }
    }

    // The wire proof of the param-cap chunking (design 9): ~370 chunked
    // statements in one batch, none over 100 bound params - and local D1
    // enforces the cap, so a chunking bug fails HERE, not in prod. (Statement
    // count also stays under the Workers Free internal-subrequest budget of
    // 1000/invocation even if each batched statement were counted singly.)
    const res = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/duplicate`,
    )
    expect(res.status).toBe(201)
    const copy = foodPlanDocumentSchema.parse(await res.json())
    expect(copy.meals).toHaveLength(20)
    expect(copy.days).toHaveLength(60)
    expect(copy.dayMeals).toHaveLength(1200)
    expect(copy.entries).toHaveLength(2000)
    // Every copied entry resolves a food (referenced, not duplicated).
    const { count: foodCount } = (await env.DB.prepare(
      'select count(*) as count from food_items where user_id = ?',
    )
      .bind(userId)
      .first()) as { count: number }
    expect(foodCount).toBe(1000)
  })
})

describe('/api/food-plans caps', () => {
  it('the 100-plan cap: friendly 422 from the API, trigger backstop on raw inserts', async () => {
    const { cookie } = await signUpVerifiedUser('plan-cap@example.com', 'Cap')
    const userId = await userIdFor(cookie)

    // Seed 99 plans directly (the API path would be 99 seed batches).
    const values = Array.from({ length: 99 }, (_, i) => {
      return `('seed-plan-${i}', '${userId}', 'Seed ${i}', ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into food_plans (id, user_id, name, sort_order, created_at, updated_at) values ${values}`,
    ).run()

    // 100th via the API is fine...
    const at100 = await apiRequest(cookie, 'POST', '/api/food-plans', {
      name: 'The 100th',
      days: 1,
    })
    expect(at100.status).toBe(201)

    // ...the 101st gets a friendly 422.
    const over = await apiRequest(cookie, 'POST', '/api/food-plans', {
      name: 'One too many',
      days: 1,
    })
    expect(over.status).toBe(422)

    // ...and the trigger backstops a raw write.
    await expect(
      env.DB.prepare(
        `insert into food_plans (id, user_id, name, sort_order, created_at, updated_at) values ('bypass', '${userId}', 'Bypass', 0, 0, 0)`,
      ).run(),
    ).rejects.toThrow(/cap/)
  })

  it('the 60-day cap: seeding 60 days succeeds, the 61st is a 422', async () => {
    const { cookie } = await signUpVerifiedUser('plan-daycap@example.com', 'D')
    // Seeding 60 days proves the create batch handles a large single-row-insert
    // set without a bound-param blowup.
    const plan = await createPlan(cookie, { name: 'Long haul', days: 60 })
    expect(plan.days).toHaveLength(60)
    const over = await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/days`)
    expect(over.status).toBe(422)
  })

  it('the 20-meal cap: the 21st meal is a 422', async () => {
    const { cookie } = await signUpVerifiedUser('plan-mealcap@example.com', 'M')
    const userId = await userIdFor(cookie)
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    // Seed 17 more meals directly (create already made 3 -> 20 total).
    const values = Array.from({ length: 17 }, (_, i) => {
      return `('seed-meal-${i}', '${userId}', '${plan.id}', 'Extra ${i}', 10 + ${i}, 0, 0)`
    }).join(',')
    await env.DB.prepare(
      `insert into meals (id, user_id, food_plan_id, name, sort_order, created_at, updated_at) values ${values}`,
    ).run()

    const over = await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/meals`, {
      name: 'One too many',
    })
    expect(over.status).toBe(422)
  })

  it('the 2000-entry cap: the 2001st entry is a 422', async () => {
    const { cookie } = await signUpVerifiedUser('plan-entrycap@example.com', 'E')
    const userId = await userIdFor(cookie)
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    const day0 = plan.days[0]!.id
    const cellBreakfast = cellId(plan, day0, mealByRole(plan, 'breakfast').id)
    const cellDinner = cellId(plan, day0, mealByRole(plan, 'dinner').id)
    const cellOnTrail = cellId(
      plan,
      day0,
      plan.meals.find((m) => m.name === 'On-trail food')!.id,
    )

    // 2000 entries needs 2000 distinct (cell, food) pairs. Foods are capped at
    // 1000/user, and an Extras entry needs a distinct food - so instead spread
    // 1000 foods across TWO cells (a food may repeat across cells; the unique
    // index is per (day_meal_id, food_item_id)). Rows go in in 250-row chunks:
    // one 2000-tuple VALUES statement exceeds D1's length limit (SQLITE_TOOBIG).
    const CHUNK = 250
    for (let i = 0; i < 1000; i += CHUNK) {
      const rows = Array.from(
        { length: Math.min(CHUNK, 1000 - i) },
        (_, j) => `('cf-${i + j}', '${userId}', 'Cap food ${i + j}', 1, 0, ${i + j}, 0, 0)`,
      ).join(',')
      await env.DB.prepare(
        `insert into food_items (id, user_id, name, serving_weight_grams, calories_per_serving, sort_order, created_at, updated_at) values ${rows}`,
      ).run()
    }
    for (const cell of [cellBreakfast, cellDinner]) {
      for (let i = 0; i < 1000; i += CHUNK) {
        const rows = Array.from(
          { length: Math.min(CHUNK, 1000 - i) },
          (_, j) =>
            `('ce-${cell}-${i + j}', '${userId}', '${plan.id}', '${cell}', 0, 'cf-${i + j}', 'servings', 1, ${i + j}, 0, 0)`,
        ).join(',')
        await env.DB.prepare(
          `insert into food_plan_entries (id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order, created_at, updated_at) values ${rows}`,
        ).run()
      }
    }

    // A 2001st entry - an existing food in a THIRD cell, so a fresh (cell, food)
    // pair, not a duplicate - hits the cap.
    const over = await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/entries`, {
      dayMealId: cellOnTrail,
      foodItemId: 'cf-0',
      basis: 'servings',
      amount: 1,
    })
    expect(over.status).toBe(422)
  })

  it('each cap matcher matches only its own root trigger error, never wrapper params', () => {
    // Same discipline as isFoodCapError: the outer wrapper embeds bound params,
    // so a FK failure whose params happen to contain a cap marker must NOT
    // misclassify. Only the root SQLITE_CONSTRAINT_TRIGGER message counts.
    const fkRoot = new Error(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
    )
    const fkWrapper = new Error(
      'Failed query: insert ... params: food plan cap exceeded (100 per user),meal cap exceeded (20 per plan)',
      { cause: new Error('D1_ERROR: FOREIGN KEY constraint failed', { cause: fkRoot }) },
    )
    expect(isFoodPlanCapError(fkWrapper)).toBe(false)
    expect(isMealCapError(fkWrapper)).toBe(false)
    expect(isFoodPlanDayCapError(fkWrapper)).toBe(false)
    expect(isFoodPlanEntryCapError(fkWrapper)).toBe(false)

    const cases: [(e: unknown) => boolean, string][] = [
      [isFoodPlanCapError, 'food plan cap exceeded (100 per user)'],
      [isMealCapError, 'meal cap exceeded (20 per plan)'],
      [isFoodPlanDayCapError, 'food plan day cap exceeded (60 per plan)'],
      [isFoodPlanEntryCapError, 'food plan entry cap exceeded (2000 per plan)'],
    ]
    for (const [matcher, marker] of cases) {
      const root = new Error(
        `${marker}: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`,
      )
      const wrapper = new Error('Failed query: insert ...', {
        cause: new Error(`D1_ERROR: ${root.message}`, { cause: root }),
      })
      expect(matcher(wrapper), marker).toBe(true)
    }
    // The day marker must not satisfy the plan matcher (substring guard).
    const dayRoot = new Error(
      'food plan day cap exceeded (60 per plan): SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
    )
    const dayWrapper = new Error('Failed query: insert ...', {
      cause: new Error(`D1_ERROR: ${dayRoot.message}`, { cause: dayRoot }),
    })
    expect(isFoodPlanCapError(dayWrapper)).toBe(false)
  })
})

describe('/api/food-plans robustness (Codex review fixes)', () => {
  it('nested deletes of a missing or foreign child are 404, not a false success', async () => {
    const { cookie } = await signUpVerifiedUser('plan-del404@example.com', 'D')
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    const other = await createPlan(cookie, { name: 'Other', days: 1 })

    for (const path of [
      `/api/food-plans/${plan.id}/days/nope`,
      `/api/food-plans/${plan.id}/meals/nope`,
      `/api/food-plans/${plan.id}/day-meals/nope`,
    ]) {
      const res = await apiRequest(cookie, 'DELETE', path)
      expect(res.status, path).toBe(404)
    }

    // A child that belongs to a DIFFERENT plan of the same user -> 404 (the
    // delete touches no row in THIS plan).
    const foreignDay = await apiRequest(
      cookie,
      'DELETE',
      `/api/food-plans/${plan.id}/days/${other.days[0]!.id}`,
    )
    expect(foreignDay.status).toBe(404)
  })

  it('rejects an over-long id in the body with a clean 400', async () => {
    const { cookie } = await signUpVerifiedUser('plan-longid@example.com', 'L')
    const plan = await createPlan(cookie, { name: 'Trip', days: 1 })
    const huge = 'x'.repeat(200)
    const res = await apiRequest(
      cookie,
      'POST',
      `/api/food-plans/${plan.id}/entries`,
      { dayMealId: huge, foodItemId: huge, basis: 'servings', amount: 1 },
    )
    expect(res.status).toBe(400)
  })

  it('the unique/FK race-backstop matchers pin their SQLite constraint classes', () => {
    // The exact message shapes were observed live against SQLite (a duplicate
    // cell entry and a cross-owner meal insert).
    const uniqRoot = new Error(
      'UNIQUE constraint failed: food_plan_entries.day_meal_id, food_plan_entries.food_item_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
    )
    const uniqWrapper = new Error('Failed query: insert ...', {
      cause: new Error(`D1_ERROR: ${uniqRoot.message}`, { cause: uniqRoot }),
    })
    expect(isAnyUniqueViolation(uniqWrapper)).toBe(true)
    expect(isForeignKeyViolation(uniqWrapper)).toBe(false)

    const fkRoot = new Error(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
    )
    const fkWrapper = new Error('Failed query: insert ...', {
      cause: new Error('D1_ERROR: FOREIGN KEY constraint failed', { cause: fkRoot }),
    })
    expect(isForeignKeyViolation(fkWrapper)).toBe(true)
    expect(isAnyUniqueViolation(fkWrapper)).toBe(false)
  })
})

describe('PUT /api/food-plans/:id/targets', () => {
  async function targetCounts(userId: string) {
    const daily = (await env.DB.prepare(
      'select count(*) as count from food_plan_daily_targets where user_id = ?',
    ).bind(userId).first()) as { count: number }
    const meal = (await env.DB.prepare(
      'select count(*) as count from meal_targets where user_id = ?',
    ).bind(userId).first()) as { count: number }
    return { daily: daily.count, meal: meal.count }
  }

  it('404s on another user\'s plan', async () => {
    const a = await signUpVerifiedUser('tgt-put-a@example.com', 'A')
    const b = await signUpVerifiedUser('tgt-put-b@example.com', 'B')
    const plan = await createPlan(a.cookie, { name: 'Not yours' })
    const res = await apiRequest(b.cookie, 'PUT', `/api/food-plans/${plan.id}/targets`, {
      daily: [{ metric: 'calories', mode: 'min', targetMin: 2000, targetMax: null }],
      meals: [],
    })
    expect(res.status).toBe(404)
  })

  it('saves daily + meal targets and returns the fresh document', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-put-happy@example.com', 'H')
    const plan = await createPlan(cookie, { name: 'Targets happy' })
    const breakfast = mealByRole(plan, 'breakfast')

    const res = await apiRequest(cookie, 'PUT', `/api/food-plans/${plan.id}/targets`, {
      daily: [
        { metric: 'protein', mode: 'min', targetMin: 120, targetMax: null },
        { metric: 'calories', mode: 'range', targetMin: 2500, targetMax: 3500 },
      ],
      meals: [
        { mealId: breakfast.id, metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 30 },
      ],
    })
    expect(res.status).toBe(200)
    const doc = foodPlanDocumentSchema.parse(await res.json())
    // Sorted by metric; server-minted ids present.
    expect(doc.dailyTargets.map((t) => t.metric)).toEqual(['calories', 'protein'])
    expect(doc.dailyTargets[0]).toMatchObject({
      metric: 'calories', mode: 'range', targetMin: 2500, targetMax: 3500,
    })
    expect(doc.dailyTargets[0]!.id).toBeTruthy()
    expect(doc.mealTargets).toHaveLength(1)
    expect(doc.mealTargets[0]).toMatchObject({
      mealId: breakfast.id, metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 30,
    })

    // A re-GET agrees with the mutation's return.
    const again = await apiRequest(cookie, 'GET', `/api/food-plans/${plan.id}`)
    const reread = foodPlanDocumentSchema.parse(await again.json())
    expect(reread.dailyTargets).toEqual(doc.dailyTargets)
    expect(reread.mealTargets).toEqual(doc.mealTargets)
  })

  it('is a FULL replace: absent metrics are removed, empty payload clears all', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-put-replace@example.com', 'R')
    const plan = await createPlan(cookie, { name: 'Targets replace' })
    const dinner = mealByRole(plan, 'dinner')

    let res = await apiRequest(cookie, 'PUT', `/api/food-plans/${plan.id}/targets`, {
      daily: [
        { metric: 'calories', mode: 'min', targetMin: 2000, targetMax: null },
        { metric: 'fiber', mode: 'min', targetMin: 25, targetMax: null },
      ],
      meals: [
        { mealId: dinner.id, metric: 'calories', mode: 'max', targetMin: null, targetMax: 900 },
      ],
    })
    expect(res.status).toBe(200)

    res = await apiRequest(cookie, 'PUT', `/api/food-plans/${plan.id}/targets`, {
      daily: [{ metric: 'fiber', mode: 'max', targetMin: null, targetMax: 40 }],
      meals: [],
    })
    expect(res.status).toBe(200)
    let doc = foodPlanDocumentSchema.parse(await res.json())
    expect(doc.dailyTargets).toHaveLength(1)
    expect(doc.dailyTargets[0]).toMatchObject({ metric: 'fiber', mode: 'max', targetMax: 40 })
    expect(doc.mealTargets).toEqual([])

    res = await apiRequest(cookie, 'PUT', `/api/food-plans/${plan.id}/targets`, {
      daily: [],
      meals: [],
    })
    expect(res.status).toBe(200)
    doc = foodPlanDocumentSchema.parse(await res.json())
    expect(doc.dailyTargets).toEqual([])
    expect(doc.mealTargets).toEqual([])
  })

  it('400s every zod-invalid payload shape', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-put-400@example.com', 'Z')
    const plan = await createPlan(cookie, { name: 'Targets 400s' })
    const breakfast = mealByRole(plan, 'breakfast')
    const daily = (row: Record<string, unknown>) => ({ daily: [row], meals: [] })
    const meal = (row: Record<string, unknown>) => ({
      daily: [],
      meals: [{ mealId: breakfast.id, ...row }],
    })

    const badBodies: unknown[] = [
      daily({ metric: 'vibes', mode: 'min', targetMin: 1, targetMax: null }), // unknown metric
      daily({ metric: 'fat_pct', mode: 'min', targetMin: 1, targetMax: null }), // meal-only metric in daily
      daily({ metric: 'calories', mode: 'off', targetMin: null, targetMax: null }), // off is not a wire mode
      daily({ metric: 'calories', mode: 'min', targetMin: 1, targetMax: 2 }), // min mode forbids max
      daily({ metric: 'calories', mode: 'max', targetMin: 1, targetMax: 2 }), // max mode forbids min
      daily({ metric: 'calories', mode: 'range', targetMin: 1, targetMax: null }), // range needs both
      daily({ metric: 'calories', mode: 'range', targetMin: 300, targetMax: 200 }), // min <= max
      daily({ metric: 'calories', mode: 'min', targetMin: -1, targetMax: null }), // negative
      daily({ metric: 'calories', mode: 'min', targetMin: 100000000, targetMax: null }), // magnitude
      daily({ metric: 'calories', mode: 'min', targetMin: 1.00001, targetMax: null }), // > 4 dp
      meal({ metric: 'fiber', mode: 'min', targetMin: 1, targetMax: null }), // daily-only metric in meals
      meal({ metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 101 }), // pct ceiling
      {
        daily: [
          { metric: 'calories', mode: 'min', targetMin: 1, targetMax: null },
          { metric: 'calories', mode: 'max', targetMin: null, targetMax: 2 },
        ],
        meals: [],
      }, // duplicate daily metric
      {
        daily: [],
        meals: [
          { mealId: breakfast.id, metric: 'calories', mode: 'min', targetMin: 1, targetMax: null },
          { mealId: breakfast.id, metric: 'calories', mode: 'max', targetMin: null, targetMax: 2 },
        ],
      }, // duplicate (mealId, metric)
      {
        daily: [
          'calories', 'protein', 'carbs', 'fiber', 'sodium', 'calorie_density', 'calories',
        ].map((m) => ({ metric: m, mode: 'min', targetMin: 1, targetMax: null })),
        meals: [],
      }, // 7 daily rows (> 6)
      { daily: [], meals: [], extra: true }, // strict
    ]
    for (const [i, body] of badBodies.entries()) {
      const res = await apiRequest(cookie, 'PUT', `/api/food-plans/${plan.id}/targets`, body)
      expect(res.status, `bad body #${i}`).toBe(400)
    }
  })

  it('422s a meal id from another plan (same user) and writes nothing', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-put-foreign@example.com', 'F')
    const userId = await userIdFor(cookie)
    const planOne = await createPlan(cookie, { name: 'Mine one' })
    const planTwo = await createPlan(cookie, { name: 'Mine two' })

    const res = await apiRequest(cookie, 'PUT', `/api/food-plans/${planOne.id}/targets`, {
      daily: [{ metric: 'calories', mode: 'min', targetMin: 2000, targetMax: null }],
      meals: [
        {
          mealId: mealByRole(planTwo, 'breakfast').id,
          metric: 'calories', mode: 'max', targetMin: null, targetMax: 700,
        },
      ],
    })
    expect(res.status).toBe(422)
    expect(await targetCounts(userId)).toEqual({ daily: 0, meal: 0 })
  })

  it('a failing statement inside the replace batch rolls back the deletes (6b)', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-put-atomic@example.com', 'X')
    const userId = await userIdFor(cookie)
    const plan = await createPlan(cookie, { name: 'Atomic' })
    const save = await apiRequest(cookie, 'PUT', `/api/food-plans/${plan.id}/targets`, {
      daily: [
        { metric: 'calories', mode: 'min', targetMin: 2000, targetMax: null },
        { metric: 'protein', mode: 'min', targetMin: 100, targetMax: null },
      ],
      meals: [],
    })
    expect(save.status).toBe(200)

    // The route's zod makes an in-batch failure unreachable through the API,
    // so the D1 transaction property the full-replace design leans on is
    // proven at the DB layer: delete-all + a CHECK-violating insert in ONE
    // batch must leave the original rows intact.
    await expect(
      env.DB.batch([
        env.DB.prepare(
          'delete from food_plan_daily_targets where food_plan_id = ? and user_id = ?',
        ).bind(plan.id, userId),
        env.DB.prepare(
          `insert into food_plan_daily_targets
             (id, user_id, food_plan_id, metric, mode, target_min, target_max, created_at, updated_at)
           values (?, ?, ?, 'calories', 'off', null, null, 1, 1)`,
        ).bind('dt-atomic', userId, plan.id),
      ]),
    ).rejects.toThrow()
    expect(await targetCounts(userId)).toEqual({ daily: 2, meal: 0 })
  })
})

describe('PATCH /api/food-plans/:id/days/:dayId (day type override)', () => {
  it('sets, changes and clears the override, returning the fresh document', async () => {
    const { cookie } = await signUpVerifiedUser('daytype-crud@example.com', 'D')
    const plan = await createPlan(cookie, { name: 'Day types', days: 2 })
    const dayId = plan.days[0]!.id
    expect(plan.days[0]!.dayTypeOverride).toBeNull()

    let res = await apiRequest(cookie, 'PATCH', `/api/food-plans/${plan.id}/days/${dayId}`, {
      dayTypeOverride: 'partial',
    })
    expect(res.status).toBe(200)
    let doc = foodPlanDocumentSchema.parse(await res.json())
    expect(doc.days.find((d) => d.id === dayId)!.dayTypeOverride).toBe('partial')

    res = await apiRequest(cookie, 'PATCH', `/api/food-plans/${plan.id}/days/${dayId}`, {
      dayTypeOverride: 'full',
    })
    expect(res.status).toBe(200)
    doc = foodPlanDocumentSchema.parse(await res.json())
    expect(doc.days.find((d) => d.id === dayId)!.dayTypeOverride).toBe('full')

    res = await apiRequest(cookie, 'PATCH', `/api/food-plans/${plan.id}/days/${dayId}`, {
      dayTypeOverride: null,
    })
    expect(res.status).toBe(200)
    doc = foodPlanDocumentSchema.parse(await res.json())
    expect(doc.days.find((d) => d.id === dayId)!.dayTypeOverride).toBeNull()
    // The other day was never touched.
    expect(doc.days[1]!.dayTypeOverride).toBeNull()
  })

  it('400s a bad body and 404s a missing day or foreign plan', async () => {
    const a = await signUpVerifiedUser('daytype-authz-a@example.com', 'A')
    const b = await signUpVerifiedUser('daytype-authz-b@example.com', 'B')
    const plan = await createPlan(a.cookie, { name: 'Mine' })
    const dayId = plan.days[0]!.id

    for (const body of [
      { dayTypeOverride: 'weekend' }, // not in the enum
      {}, // missing key
      { dayTypeOverride: 'partial', extra: 1 }, // strict
    ]) {
      const res = await apiRequest(
        a.cookie, 'PATCH', `/api/food-plans/${plan.id}/days/${dayId}`, body,
      )
      expect(res.status).toBe(400)
    }

    const missing = await apiRequest(
      a.cookie, 'PATCH', `/api/food-plans/${plan.id}/days/nope`,
      { dayTypeOverride: 'partial' },
    )
    expect(missing.status).toBe(404)

    const cross = await apiRequest(
      b.cookie, 'PATCH', `/api/food-plans/${plan.id}/days/${dayId}`,
      { dayTypeOverride: 'partial' },
    )
    expect(cross.status).toBe(404)
  })

  it('404s a day id that belongs to ANOTHER plan of the same user, touching nothing', async () => {
    const { cookie } = await signUpVerifiedUser('daytype-crossplan@example.com', 'X')
    const planA = await createPlan(cookie, { name: 'Plan A' })
    const planB = await createPlan(cookie, { name: 'Plan B' })
    const dayB = planB.days[0]!.id

    // /planA/days/<planB's day>: user scoping alone would match the day row;
    // the same-plan predicate must refuse it and leave BOTH plans unchanged.
    const res = await apiRequest(
      cookie, 'PATCH', `/api/food-plans/${planA.id}/days/${dayB}`,
      { dayTypeOverride: 'partial' },
    )
    expect(res.status).toBe(404)
    const aDoc = foodPlanDocumentSchema.parse(
      await (await apiRequest(cookie, 'GET', `/api/food-plans/${planA.id}`)).json(),
    )
    const bDoc = foodPlanDocumentSchema.parse(
      await (await apiRequest(cookie, 'GET', `/api/food-plans/${planB.id}`)).json(),
    )
    expect(aDoc.days.every((d) => d.dayTypeOverride === null)).toBe(true)
    expect(bDoc.days.every((d) => d.dayTypeOverride === null)).toBe(true)
  })
})
