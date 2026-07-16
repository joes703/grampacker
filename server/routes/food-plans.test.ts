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

    // Seed 2000 foods + 2000 Extras entries directly (each Extras entry is unique
    // per (food_plan_id, food_item_id), so each needs a distinct food). The rows
    // go in in chunks: one 2000-tuple VALUES statement exceeds D1's statement
    // length limit (SQLITE_TOOBIG).
    const CHUNK = 250
    for (let i = 0; i < 2001; i += CHUNK) {
      const rows = Array.from(
        { length: Math.min(CHUNK, 2001 - i) },
        (_, j) => `('cf-${i + j}', '${userId}', 'Cap food ${i + j}', 1, 0, ${i + j}, 0, 0)`,
      ).join(',')
      await env.DB.prepare(
        `insert into food_items (id, user_id, name, serving_weight_grams, calories_per_serving, sort_order, created_at, updated_at) values ${rows}`,
      ).run()
    }
    for (let i = 0; i < 2000; i += CHUNK) {
      const rows = Array.from(
        { length: Math.min(CHUNK, 2000 - i) },
        (_, j) =>
          `('ce-${i + j}', '${userId}', '${plan.id}', null, 1, 'cf-${i + j}', 'servings', 1, ${i + j}, 0, 0)`,
      ).join(',')
      await env.DB.prepare(
        `insert into food_plan_entries (id, user_id, food_plan_id, day_meal_id, is_extra, food_item_id, basis, amount, sort_order, created_at, updated_at) values ${rows}`,
      ).run()
    }

    // The 2001st entry (a fresh food, so not a duplicate) hits the cap.
    const over = await apiRequest(cookie, 'POST', `/api/food-plans/${plan.id}/entries`, {
      isExtra: true,
      foodItemId: 'cf-2000',
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
