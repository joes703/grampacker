import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { foodPlanTargetDefaults } from '../db/schema'
import { chunkForParamCap } from './food-plan-copy'

// Account-level default daily targets (slice 7). Copied BY VALUE into
// food_plan_daily_targets at plan create (foodPlans.create) - no linkage, so
// nothing here ever touches an existing plan.

export type TargetDefaultRow = {
  id: string
  metric: 'calories' | 'protein' | 'carbs' | 'fiber' | 'sodium' | 'calorie_density'
  mode: 'range' | 'min' | 'max'
  targetMin: number | null
  targetMax: number | null
}

const rowCols = {
  id: foodPlanTargetDefaults.id,
  metric: foodPlanTargetDefaults.metric,
  mode: foodPlanTargetDefaults.mode,
  targetMin: foodPlanTargetDefaults.targetMin,
  targetMax: foodPlanTargetDefaults.targetMax,
}

export function createTargetDefaultsRepo(db: Db, userId: string) {
  async function list(): Promise<TargetDefaultRow[]> {
    return db
      .select(rowCols)
      .from(foodPlanTargetDefaults)
      .where(eq(foodPlanTargetDefaults.userId, userId))
      .orderBy(asc(foodPlanTargetDefaults.metric))
  }

  return {
    list,

    // FULL replace, like the plan-targets save: delete-all + insert-all in
    // one batch. At most 6 rows (one per daily metric, zod-capped), so the
    // chunking is a formality that keeps the helper's invariant everywhere.
    async replaceAll(
      defaults: Omit<TargetDefaultRow, 'id'>[],
    ): Promise<TargetDefaultRow[]> {
      const now = Date.now()
      const rows = defaults.map((d) => ({
        id: crypto.randomUUID(),
        userId,
        metric: d.metric,
        mode: d.mode,
        targetMin: d.targetMin,
        targetMax: d.targetMax,
        createdAt: now,
        updatedAt: now,
      }))
      await db.batch([
        db
          .delete(foodPlanTargetDefaults)
          .where(eq(foodPlanTargetDefaults.userId, userId)),
        ...chunkForParamCap(rows).map((chunk) =>
          db.insert(foodPlanTargetDefaults).values(chunk),
        ),
      ])
      return list()
    },
  }
}
