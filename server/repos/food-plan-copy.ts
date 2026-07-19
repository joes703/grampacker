import type { BatchItem } from 'drizzle-orm/batch'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import {
  dayMeals,
  foodPlanDailyTargets,
  foodPlanDays,
  foodPlanEntries,
  foodPlans,
  meals,
  mealTargets,
} from '../db/schema'
import { isTriggerAbort } from './db-errors'

// Deep-copy machinery for the food-plan graph, shared by
// foodPlans.duplicate() and lists.duplicate(). One plan backs at most one
// list (lists_food_plan_id_unique), so duplicating a LIST cannot carry the
// plan pointer over - it must copy the plan too (design 3.1), and two
// implementations of "copy a plan graph" would drift.
//
// This module sits below both repos (it imports only schema + db-errors), so
// each can import it without lists.ts <-> food-plans.ts becoming a cycle.

type Basis = 'servings' | 'packages' | 'weight'
type TargetMode = 'range' | 'min' | 'max'
type DailyMetric =
  | 'calories'
  | 'protein'
  | 'carbs'
  | 'fiber'
  | 'sodium'
  | 'calorie_density'
type MealMetric =
  | 'calories'
  | 'protein'
  | 'fat_pct'
  | 'sugar_pct'
  | 'carb_protein_ratio'

// The six child collections, field-compatible with the document row types in
// food-plans.ts (which are one source of a graph; readPlanGraph is the other).
export type PlanGraph = {
  meals: {
    id: string
    name: string
    anchorRole: 'breakfast' | 'dinner' | null
    isDefault: boolean
    sortOrder: number
  }[]
  days: {
    id: string
    dayTypeOverride: 'full' | 'partial' | null
    sortOrder: number
  }[]
  dayMeals: { id: string; dayId: string; mealId: string }[]
  entries: {
    dayMealId: string | null
    isExtra: boolean
    foodItemId: string
    basis: Basis
    amount: number
    sortOrder: number
  }[]
  // Targets copy with the plan (slice 7): a duplicate is "the same menu for
  // another trip", and its goals are part of the menu. Meal target rows cite
  // meal ids, remapped through the same id map as the grid.
  dailyTargets: {
    metric: DailyMetric
    mode: TargetMode
    targetMin: number | null
    targetMax: number | null
  }[]
  mealTargets: {
    mealId: string
    metric: MealMetric
    mode: TargetMode
    targetMin: number | null
    targetMax: number | null
  }[]
}

// Lives here (not food-plans.ts) so lists.duplicate can map the plan-cap
// trigger without importing food-plans.ts (which imports lists.ts).
// food-plans.ts re-exports it, so route/test imports are unchanged. Marker in
// lockstep with the 0008 trigger's RAISE text.
export function isFoodPlanCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'food plan cap exceeded')
}

// floor(90 / columns) rows per multi-row INSERT. Column count is read off the
// first row so a schema change reflows the chunking instead of silently
// blowing D1's 100-bound-params-per-statement cap; 90 for the same headroom
// as chunk-ids.ts. Empty input -> no statements.
export function chunkForParamCap<T extends Record<string, unknown>>(
  rows: T[],
): T[][] {
  const first = rows[0]
  if (!first) return []
  const perStatement = Math.max(1, Math.floor(90 / Object.keys(first).length))
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += perStatement) {
    out.push(rows.slice(i, i + perStatement))
  }
  return out
}

// The graph of an owned plan (plus its name, for copyName), read as one
// db.batch (a D1 transaction, so all five reads are a consistent snapshot).
// For callers that do not already hold a plan document (lists.duplicate);
// foodPlans.duplicate feeds its document straight into
// buildPlanCopyStatements instead. Null when the plan does not exist or is
// not the caller's.
export async function readPlanGraph(
  db: Db,
  userId: string,
  planId: string,
): Promise<(PlanGraph & { name: string }) | null> {
  const [
    planRows,
    mealRows,
    dayRows,
    dayMealRows,
    entryRows,
    dailyTargetRows,
    mealTargetRows,
  ] = await db.batch([
    db
      .select({ name: foodPlans.name })
      .from(foodPlans)
      .where(and(eq(foodPlans.id, planId), eq(foodPlans.userId, userId))),
    db
      .select({
        id: meals.id,
        name: meals.name,
        anchorRole: meals.anchorRole,
        isDefault: meals.isDefault,
        sortOrder: meals.sortOrder,
      })
      .from(meals)
      .where(and(eq(meals.foodPlanId, planId), eq(meals.userId, userId))),
    db
      .select({
        id: foodPlanDays.id,
        dayTypeOverride: foodPlanDays.dayTypeOverride,
        sortOrder: foodPlanDays.sortOrder,
      })
      .from(foodPlanDays)
      .where(
        and(
          eq(foodPlanDays.foodPlanId, planId),
          eq(foodPlanDays.userId, userId),
        ),
      ),
    db
      .select({
        id: dayMeals.id,
        dayId: dayMeals.dayId,
        mealId: dayMeals.mealId,
      })
      .from(dayMeals)
      .where(and(eq(dayMeals.foodPlanId, planId), eq(dayMeals.userId, userId))),
    db
      .select({
        dayMealId: foodPlanEntries.dayMealId,
        isExtra: foodPlanEntries.isExtra,
        foodItemId: foodPlanEntries.foodItemId,
        basis: foodPlanEntries.basis,
        amount: foodPlanEntries.amount,
        sortOrder: foodPlanEntries.sortOrder,
      })
      .from(foodPlanEntries)
      .where(
        and(
          eq(foodPlanEntries.foodPlanId, planId),
          eq(foodPlanEntries.userId, userId),
        ),
      ),
    db
      .select({
        metric: foodPlanDailyTargets.metric,
        mode: foodPlanDailyTargets.mode,
        targetMin: foodPlanDailyTargets.targetMin,
        targetMax: foodPlanDailyTargets.targetMax,
      })
      .from(foodPlanDailyTargets)
      .where(
        and(
          eq(foodPlanDailyTargets.foodPlanId, planId),
          eq(foodPlanDailyTargets.userId, userId),
        ),
      ),
    db
      .select({
        mealId: mealTargets.mealId,
        metric: mealTargets.metric,
        mode: mealTargets.mode,
        targetMin: mealTargets.targetMin,
        targetMax: mealTargets.targetMax,
      })
      .from(mealTargets)
      .where(
        and(
          eq(mealTargets.foodPlanId, planId),
          eq(mealTargets.userId, userId),
        ),
      ),
  ])
  const plan = planRows[0]
  if (!plan) return null
  return {
    name: plan.name,
    meals: mealRows,
    days: dayRows,
    dayMeals: dayMealRows,
    entries: entryRows,
    dailyTargets: dailyTargetRows,
    mealTargets: mealTargetRows,
  }
}

// INSERT statements for a full copy of `graph` under a fresh plan, in FK
// order (plan first, then children whose parents already exist). Fresh ids
// throughout; entries reference the same account-wide food_items. The
// non-null map assertions are structurally safe: every child row came from
// the same consistent snapshot as the rows its FKs point at. Always returns
// at least the plan insert, so callers may spread it into db.batch directly.
export function buildPlanCopyStatements(
  db: Db,
  userId: string,
  graph: PlanGraph,
  opts: { newPlanId: string; name: string; now: number },
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] {
  const { newPlanId, name, now } = opts
  const mealIdMap = new Map(graph.meals.map((m) => [m.id, crypto.randomUUID()]))
  const dayIdMap = new Map(graph.days.map((d) => [d.id, crypto.randomUUID()]))
  const dayMealIdMap = new Map(
    graph.dayMeals.map((dm) => [dm.id, crypto.randomUUID()]),
  )

  const mealRows = graph.meals.map((m) => ({
    id: mealIdMap.get(m.id) as string,
    userId,
    foodPlanId: newPlanId,
    name: m.name,
    anchorRole: m.anchorRole,
    isDefault: m.isDefault,
    sortOrder: m.sortOrder,
    createdAt: now,
    updatedAt: now,
  }))
  const dayRows = graph.days.map((d) => ({
    id: dayIdMap.get(d.id) as string,
    userId,
    foodPlanId: newPlanId,
    dayTypeOverride: d.dayTypeOverride,
    sortOrder: d.sortOrder,
    createdAt: now,
    updatedAt: now,
  }))
  const dayMealRows = graph.dayMeals.map((dm) => ({
    id: dayMealIdMap.get(dm.id) as string,
    userId,
    foodPlanId: newPlanId,
    dayId: dayIdMap.get(dm.dayId) as string,
    mealId: mealIdMap.get(dm.mealId) as string,
    createdAt: now,
    updatedAt: now,
  }))
  const entryRows = graph.entries.map((e) => ({
    id: crypto.randomUUID(),
    userId,
    foodPlanId: newPlanId,
    dayMealId:
      e.dayMealId === null ? null : (dayMealIdMap.get(e.dayMealId) as string),
    isExtra: e.isExtra,
    foodItemId: e.foodItemId,
    basis: e.basis,
    amount: e.amount,
    sortOrder: e.sortOrder,
    createdAt: now,
    updatedAt: now,
  }))
  const dailyTargetRows = graph.dailyTargets.map((t) => ({
    id: crypto.randomUUID(),
    userId,
    foodPlanId: newPlanId,
    metric: t.metric,
    mode: t.mode,
    targetMin: t.targetMin,
    targetMax: t.targetMax,
    createdAt: now,
    updatedAt: now,
  }))
  const mealTargetRows = graph.mealTargets.map((t) => ({
    id: crypto.randomUUID(),
    userId,
    foodPlanId: newPlanId,
    mealId: mealIdMap.get(t.mealId) as string,
    metric: t.metric,
    mode: t.mode,
    targetMin: t.targetMin,
    targetMax: t.targetMax,
    createdAt: now,
    updatedAt: now,
  }))

  const insertPlan = db.insert(foodPlans).values({
    id: newPlanId,
    userId,
    name,
    sortOrder: sql<number>`coalesce((select max(${foodPlans.sortOrder}) + 1 from ${foodPlans} where ${foodPlans.userId} = ${userId}), 0)`,
    createdAt: now,
    updatedAt: now,
  })
  return [
    insertPlan,
    ...chunkForParamCap(mealRows).map((rows) => db.insert(meals).values(rows)),
    ...chunkForParamCap(dayRows).map((rows) =>
      db.insert(foodPlanDays).values(rows),
    ),
    ...chunkForParamCap(dayMealRows).map((rows) =>
      db.insert(dayMeals).values(rows),
    ),
    ...chunkForParamCap(entryRows).map((rows) =>
      db.insert(foodPlanEntries).values(rows),
    ),
    ...chunkForParamCap(dailyTargetRows).map((rows) =>
      db.insert(foodPlanDailyTargets).values(rows),
    ),
    ...chunkForParamCap(mealTargetRows).map((rows) =>
      db.insert(mealTargets).values(rows),
    ),
  ]
}
