import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  foodPlanDocumentSchema,
  type FoodPlanDocument,
} from '../../shared/food-plans'
import { apiRequest } from '../test/api-helpers'
import { signUpVerifiedUser } from '../test/auth-helpers'

// DB-layer constraint tests for the three target tables (migration 0012).
// The route layer's zod mirrors every rule here, so through the API these are
// unreachable 500s - which is exactly why they get raw-SQL coverage: they are
// the backstop that holds when a future code path forgets the mirror.

async function userIdFor(cookie: string): Promise<string> {
  const res = await apiRequest(cookie, 'GET', '/api/me')
  const body = (await res.json()) as { id: string }
  return body.id
}

async function createPlan(cookie: string, name: string): Promise<FoodPlanDocument> {
  const res = await apiRequest(cookie, 'POST', '/api/food-plans', {
    name,
    days: 2,
  })
  if (res.status !== 201) throw new Error(`create plan failed: ${res.status}`)
  return foodPlanDocumentSchema.parse(await res.json())
}

const TS = 1784200000000

type TargetRow = {
  id: string
  userId: string
  metric: string
  mode: string
  min: number | null
  max: number | null
}

function insertDaily(row: TargetRow & { planId: string }) {
  return env.DB.prepare(
    `insert into food_plan_daily_targets
       (id, user_id, food_plan_id, metric, mode, target_min, target_max, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.userId, row.planId, row.metric, row.mode, row.min, row.max, TS, TS)
    .run()
}

function insertMeal(row: TargetRow & { planId: string; mealId: string }) {
  return env.DB.prepare(
    `insert into meal_targets
       (id, user_id, food_plan_id, meal_id, metric, mode, target_min, target_max, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.userId, row.planId, row.mealId, row.metric, row.mode, row.min, row.max, TS, TS)
    .run()
}

function insertDefault(row: TargetRow) {
  return env.DB.prepare(
    `insert into food_plan_target_defaults
       (id, user_id, metric, mode, target_min, target_max, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.userId, row.metric, row.mode, row.min, row.max, TS, TS)
    .run()
}

async function countRows(table: string, userId: string): Promise<number> {
  const { count } = (await env.DB.prepare(
    `select count(*) as count from ${table} where user_id = ?`,
  )
    .bind(userId)
    .first()) as { count: number }
  return count
}

describe('target tables: mode/bounds CHECK (I-BOUNDS, I-NO-OFF)', () => {
  it('accepts min, max and range shapes on all three tables', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-1@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Bounds ok')
    const mealId = doc.meals[0]!.id

    await insertDaily({ id: 'dt-min', userId, planId: doc.id, metric: 'calories', mode: 'min', min: 2500, max: null })
    await insertDaily({ id: 'dt-max', userId, planId: doc.id, metric: 'sodium', mode: 'max', min: null, max: 4000 })
    await insertDaily({ id: 'dt-range', userId, planId: doc.id, metric: 'protein', mode: 'range', min: 100, max: 150 })
    await insertMeal({ id: 'mt-range', userId, planId: doc.id, mealId, metric: 'fat_pct', mode: 'range', min: 20, max: 35 })
    await insertDefault({ id: 'df-min', userId, metric: 'fiber', mode: 'min', min: 25, max: null })

    expect(await countRows('food_plan_daily_targets', userId)).toBe(3)
    expect(await countRows('meal_targets', userId)).toBe(1)
    expect(await countRows('food_plan_target_defaults', userId)).toBe(1)
  })

  it('rejects every malformed mode/bounds shape', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-2@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Bounds bad')

    const bad: Array<Pick<TargetRow, 'mode' | 'min' | 'max'>> = [
      { mode: 'off', min: null, max: null }, // I-NO-OFF: off is unrepresentable
      { mode: 'min', min: null, max: null }, // min mode needs a min
      { mode: 'min', min: 100, max: 200 }, // min mode forbids a max
      { mode: 'max', min: 100, max: 200 }, // max mode forbids a min
      { mode: 'max', min: null, max: null }, // max mode needs a max
      { mode: 'range', min: 100, max: null }, // range needs both
      { mode: 'range', min: null, max: 200 },
      { mode: 'range', min: 300, max: 200 }, // range needs min <= max
      { mode: 'min', min: -1, max: null }, // no negative bounds
      { mode: 'min', min: 100000000, max: null }, // magnitude < 1e8 (old numeric(12,4))
    ]
    for (const [i, shape] of bad.entries()) {
      await expect(
        insertDaily({
          id: `dt-bad-${i}`,
          userId,
          planId: doc.id,
          metric: 'calories',
          mode: shape.mode,
          min: shape.min,
          max: shape.max,
        }),
      ).rejects.toThrow(/CHECK constraint failed/)
    }
    expect(await countRows('food_plan_daily_targets', userId)).toBe(0)
  })

  it('rejects the same malformed shapes on meal targets and defaults', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-3@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Bounds bad 2')
    const mealId = doc.meals[0]!.id

    await expect(
      insertMeal({ id: 'mt-off', userId, planId: doc.id, mealId, metric: 'calories', mode: 'off', min: null, max: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertMeal({ id: 'mt-inverted', userId, planId: doc.id, mealId, metric: 'calories', mode: 'range', min: 900, max: 400 }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertDefault({ id: 'df-off', userId, metric: 'calories', mode: 'off', min: null, max: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertDefault({ id: 'df-huge', userId, metric: 'calories', mode: 'max', min: null, max: 100000000 }),
    ).rejects.toThrow(/CHECK constraint failed/)
  })

  it('rejects fat_pct/sugar_pct bounds over 100 (I-PCT), accepts 100 exactly', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-4@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Pct ceiling')
    const mealId = doc.meals[0]!.id

    await expect(
      insertMeal({ id: 'mt-fat-101', userId, planId: doc.id, mealId, metric: 'fat_pct', mode: 'max', min: null, max: 101 }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertMeal({ id: 'mt-sugar-101', userId, planId: doc.id, mealId, metric: 'sugar_pct', mode: 'min', min: 101, max: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
    // 100 exactly is legal; and non-pct metrics take values over 100 freely.
    await insertMeal({ id: 'mt-fat-100', userId, planId: doc.id, mealId, metric: 'fat_pct', mode: 'max', min: null, max: 100 })
    await insertMeal({ id: 'mt-cal-900', userId, planId: doc.id, mealId, metric: 'calories', mode: 'max', min: null, max: 900 })
  })

  it('rejects metrics outside each table\'s set', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-5@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Metric enums')
    const mealId = doc.meals[0]!.id

    // Meal-only metric on the daily table, daily-only metric on the meal
    // table, meal-only metric on defaults, and pure garbage everywhere.
    await expect(
      insertDaily({ id: 'dt-fatpct', userId, planId: doc.id, metric: 'fat_pct', mode: 'min', min: 1, max: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertMeal({ id: 'mt-fiber', userId, planId: doc.id, mealId, metric: 'fiber', mode: 'min', min: 1, max: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertDefault({ id: 'df-ratio', userId, metric: 'carb_protein_ratio', mode: 'min', min: 1, max: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
    await expect(
      insertDaily({ id: 'dt-junk', userId, planId: doc.id, metric: 'vibes', mode: 'min', min: 1, max: null }),
    ).rejects.toThrow(/CHECK constraint failed/)
  })
})

describe('target tables: uniqueness (I-ONE-PER-METRIC)', () => {
  it('rejects a second row per (plan, metric), (meal, metric) and (user, metric)', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-6@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Uniques')
    const mealId = doc.meals[0]!.id

    await insertDaily({ id: 'dt-u1', userId, planId: doc.id, metric: 'calories', mode: 'min', min: 2000, max: null })
    await expect(
      insertDaily({ id: 'dt-u2', userId, planId: doc.id, metric: 'calories', mode: 'max', min: null, max: 3000 }),
    ).rejects.toThrow(/UNIQUE constraint failed/)

    await insertMeal({ id: 'mt-u1', userId, planId: doc.id, mealId, metric: 'protein', mode: 'min', min: 20, max: null })
    await expect(
      insertMeal({ id: 'mt-u2', userId, planId: doc.id, mealId, metric: 'protein', mode: 'max', min: null, max: 40 }),
    ).rejects.toThrow(/UNIQUE constraint failed/)
    // The same metric on ANOTHER meal of the same plan is fine.
    const otherMeal = doc.meals[1]!.id
    await insertMeal({ id: 'mt-u3', userId, planId: doc.id, mealId: otherMeal, metric: 'protein', mode: 'min', min: 15, max: null })

    await insertDefault({ id: 'df-u1', userId, metric: 'sodium', mode: 'max', min: null, max: 5000 })
    await expect(
      insertDefault({ id: 'df-u2', userId, metric: 'sodium', mode: 'min', min: 100, max: null }),
    ).rejects.toThrow(/UNIQUE constraint failed/)
  })
})

describe('target tables: ownership FKs (I-OWNER)', () => {
  it('rejects a target whose user does not own the plan (cross-owner composite FK)', async () => {
    const { cookie: cookieA } = await signUpVerifiedUser('tgt-schema-7@example.com', 'T')
    const { cookie: cookieB } = await signUpVerifiedUser('tgt-schema-8@example.com', 'T')
    const userA = await userIdFor(cookieA)
    const userB = await userIdFor(cookieB)
    const planA = await createPlan(cookieA, 'Owner A plan')

    await expect(
      insertDaily({ id: 'dt-cross', userId: userB, planId: planA.id, metric: 'calories', mode: 'min', min: 1, max: null }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/)
    await expect(
      insertMeal({ id: 'mt-cross', userId: userB, planId: planA.id, mealId: planA.meals[0]!.id, metric: 'calories', mode: 'min', min: 1, max: null }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/)
    expect(await countRows('food_plan_daily_targets', userA)).toBe(0)
  })

  it('rejects a meal target pointing at another plan\'s meal (same-plan composite FK)', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-9@example.com', 'T')
    const userId = await userIdFor(cookie)
    const planOne = await createPlan(cookie, 'Plan one')
    const planTwo = await createPlan(cookie, 'Plan two')

    // Same owner everywhere; only the (meal_id, food_plan_id) pair is stitched
    // across plans. The composite FK must refuse it.
    await expect(
      insertMeal({
        id: 'mt-stitch',
        userId,
        planId: planOne.id,
        mealId: planTwo.meals[0]!.id,
        metric: 'calories',
        mode: 'min',
        min: 1,
        max: null,
      }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/)
  })
})

describe('plan document carries targets', () => {
  it('a fresh plan has empty target arrays', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-doc-1@example.com', 'T')
    const doc = await createPlan(cookie, 'Doc empty')
    expect(doc.dailyTargets).toEqual([])
    expect(doc.mealTargets).toEqual([])
  })

  it('seeded targets come back camelCase, sorted by metric / (mealId, metric)', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-doc-2@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Doc targets')
    const mealA = doc.meals[0]!.id
    const mealB = doc.meals[1]!.id

    // Inserted out of order to prove the read sorts.
    await insertDaily({ id: 'dt-doc-2', userId, planId: doc.id, metric: 'protein', mode: 'range', min: 100, max: 150 })
    await insertDaily({ id: 'dt-doc-1', userId, planId: doc.id, metric: 'calories', mode: 'min', min: 2500, max: null })
    await insertMeal({ id: 'mt-doc-2', userId, planId: doc.id, mealId: mealB, metric: 'calories', mode: 'max', min: null, max: 700 })
    await insertMeal({ id: 'mt-doc-1', userId, planId: doc.id, mealId: mealA, metric: 'fat_pct', mode: 'max', min: null, max: 35 })

    const res = await apiRequest(cookie, 'GET', `/api/food-plans/${doc.id}`)
    expect(res.status).toBe(200)
    const body = foodPlanDocumentSchema.parse(await res.json())
    expect(body.dailyTargets).toEqual([
      { id: 'dt-doc-1', metric: 'calories', mode: 'min', targetMin: 2500, targetMax: null },
      { id: 'dt-doc-2', metric: 'protein', mode: 'range', targetMin: 100, targetMax: 150 },
    ])
    expect(body.mealTargets).toEqual([
      { id: 'mt-doc-1', mealId: mealA, metric: 'fat_pct', mode: 'max', targetMin: null, targetMax: 35 },
      { id: 'mt-doc-2', mealId: mealB, metric: 'calories', mode: 'max', targetMin: null, targetMax: 700 },
    ].sort((a, b) => (a.mealId < b.mealId ? -1 : a.mealId > b.mealId ? 1 : 0)))
  })
})

describe('target tables: cascades (I-CASCADE)', () => {
  it('plan delete removes its daily and meal targets', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-10@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Cascade plan')
    await insertDaily({ id: 'dt-c1', userId, planId: doc.id, metric: 'calories', mode: 'min', min: 2000, max: null })
    await insertMeal({ id: 'mt-c1', userId, planId: doc.id, mealId: doc.meals[0]!.id, metric: 'protein', mode: 'min', min: 20, max: null })

    const res = await apiRequest(cookie, 'DELETE', `/api/food-plans/${doc.id}`)
    expect(res.status).toBe(204)
    expect(await countRows('food_plan_daily_targets', userId)).toBe(0)
    expect(await countRows('meal_targets', userId)).toBe(0)
  })

  it('meal delete removes its meal targets and leaves daily targets alone', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-11@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Cascade meal')
    const mealId = doc.meals[0]!.id
    await insertDaily({ id: 'dt-c2', userId, planId: doc.id, metric: 'calories', mode: 'min', min: 2000, max: null })
    await insertMeal({ id: 'mt-c2', userId, planId: doc.id, mealId, metric: 'protein', mode: 'min', min: 20, max: null })
    await insertMeal({ id: 'mt-c3', userId, planId: doc.id, mealId: doc.meals[1]!.id, metric: 'calories', mode: 'max', min: null, max: 800 })

    const res = await apiRequest(cookie, 'DELETE', `/api/food-plans/${doc.id}/meals/${mealId}`)
    expect(res.status).toBe(200)
    expect(await countRows('meal_targets', userId)).toBe(1)
    expect(await countRows('food_plan_daily_targets', userId)).toBe(1)
  })

  it('user delete empties all three tables (account-delete cascade)', async () => {
    const { cookie } = await signUpVerifiedUser('tgt-schema-12@example.com', 'T')
    const userId = await userIdFor(cookie)
    const doc = await createPlan(cookie, 'Cascade user')
    await insertDaily({ id: 'dt-c4', userId, planId: doc.id, metric: 'calories', mode: 'min', min: 2000, max: null })
    await insertMeal({ id: 'mt-c4', userId, planId: doc.id, mealId: doc.meals[0]!.id, metric: 'protein', mode: 'min', min: 20, max: null })
    await insertDefault({ id: 'df-c4', userId, metric: 'fiber', mode: 'min', min: 25, max: null })

    // Raw delete exercises the same FK graph the account-delete flow relies on.
    await env.DB.prepare('delete from user where id = ?').bind(userId).run()
    expect(await countRows('food_plan_daily_targets', userId)).toBe(0)
    expect(await countRows('meal_targets', userId)).toBe(0)
    expect(await countRows('food_plan_target_defaults', userId)).toBe(0)
  })
})
