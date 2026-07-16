import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import {
  dayMeals,
  foodItems,
  foodPlanDays,
  foodPlanEntries,
  foodPlans,
  meals,
} from '../db/schema'
import {
  isAnyUniqueViolation,
  isForeignKeyViolation,
  isTriggerAbort,
} from './db-errors'

// The food-plan graph (food-planning-design.md slice 2). One repo owns the plan,
// its meals, days, the day x meal grid and the entries. Every method is
// pre-filtered by userId; the composite same-owner FKs make a cross-owner write
// impossible even if a handler tried. Structural mutations return the FRESH plan
// document so the editor stays a pure projection of one cache entry (design 5.5:
// coarse invalidation, no optimistic fan-out).

// ------------------------------------------------------------------- row types

type Basis = 'servings' | 'packages' | 'weight'

export type PlanSummaryRow = {
  id: string
  name: string
  sortOrder: number
  dayCount: number
  entryCount: number
  createdAt: number // epoch ms
  updatedAt: number
}

export type MealRow = {
  id: string
  name: string
  anchorRole: 'breakfast' | 'dinner' | null
  isDefault: boolean
  sortOrder: number
}

export type DayRow = {
  id: string
  dayTypeOverride: 'full' | 'partial' | null
  sortOrder: number
}

export type DayMealRow = { id: string; dayId: string; mealId: string }

export type EntryRow = {
  id: string
  dayMealId: string | null
  isExtra: boolean
  foodItemId: string
  basis: Basis
  amount: number
  sortOrder: number
}

export type FoodPlanDocumentRow = {
  id: string
  name: string
  sortOrder: number
  createdAt: number
  updatedAt: number
  meals: MealRow[]
  days: DayRow[]
  dayMeals: DayMealRow[]
  entries: EntryRow[]
}

// A mutation either produces the fresh document or explains why it could not.
// not_found: the plan is not the caller's (or gone). invalid_ref: a referenced
// day / meal / cell / food is not in this plan (or not owned). duplicate: the
// food is already in the target cell / Extras. cap_exceeded: a DB cap trigger
// fired.
export type PlanDocResult =
  | { ok: true; doc: FoodPlanDocumentRow }
  | { ok: false; reason: 'not_found' | 'invalid_ref' | 'duplicate' | 'cap_exceeded' }

// ---------------------------------------------------------------- cap matchers
// Root-cause-only matching (see db-errors.ts). Keep each marker in lockstep with
// the RAISE(ABORT) text of its trigger in migration 0008. The four markers are
// mutually non-substring so includes() cannot cross-match.
export function isFoodPlanCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'food plan cap exceeded')
}
export function isFoodPlanDayCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'food plan day cap exceeded')
}
export function isMealCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'meal cap exceeded')
}
export function isFoodPlanEntryCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'food plan entry cap exceeded')
}

// The three seeded meals (design section 8 / old build buildFoodPlanStructure).
const DEFAULT_MEALS: { name: string; anchorRole: 'breakfast' | 'dinner' | null }[] =
  [
    { name: 'Breakfast', anchorRole: 'breakfast' },
    { name: 'On-trail food', anchorRole: null },
    { name: 'Dinner', anchorRole: 'dinner' },
  ]

export function createFoodPlansRepo(db: Db, userId: string) {
  const planCols = {
    id: foodPlans.id,
    name: foodPlans.name,
    sortOrder: foodPlans.sortOrder,
    createdAt: foodPlans.createdAt,
    updatedAt: foodPlans.updatedAt,
  }

  function nextPlanSortOrder() {
    return sql<number>`coalesce((select max(${foodPlans.sortOrder}) + 1 from ${foodPlans} where ${foodPlans.userId} = ${userId}), 0)`
  }

  async function requirePlan(planId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: foodPlans.id })
      .from(foodPlans)
      .where(and(eq(foodPlans.id, planId), eq(foodPlans.userId, userId)))
      .limit(1)
    return row !== undefined
  }

  // The single batched plan read (design 5.2): the plan row plus its four child
  // collections in ONE db.batch (a D1 transaction, so all five see a consistent
  // snapshot - no interleaving with a concurrent write). Each child is filtered
  // by (food_plan_id, user_id) so ownership is structural, not a post-filter.
  // Returns null when the plan is not owned (the children come back empty too).
  async function getDocument(
    planId: string,
  ): Promise<FoodPlanDocumentRow | null> {
    const [planRows, mealRows, dayRows, dayMealRows, entryRows] = await db.batch(
      [
        db
          .select(planCols)
          .from(foodPlans)
          .where(and(eq(foodPlans.id, planId), eq(foodPlans.userId, userId)))
          .limit(1),
        db
          .select({
            id: meals.id,
            name: meals.name,
            anchorRole: meals.anchorRole,
            isDefault: meals.isDefault,
            sortOrder: meals.sortOrder,
          })
          .from(meals)
          .where(and(eq(meals.foodPlanId, planId), eq(meals.userId, userId)))
          .orderBy(asc(meals.sortOrder), asc(meals.createdAt)),
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
          )
          .orderBy(asc(foodPlanDays.sortOrder), asc(foodPlanDays.createdAt)),
        db
          .select({
            id: dayMeals.id,
            dayId: dayMeals.dayId,
            mealId: dayMeals.mealId,
          })
          .from(dayMeals)
          .where(
            and(eq(dayMeals.foodPlanId, planId), eq(dayMeals.userId, userId)),
          ),
        db
          .select({
            id: foodPlanEntries.id,
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
          )
          .orderBy(
            asc(foodPlanEntries.sortOrder),
            asc(foodPlanEntries.createdAt),
          ),
      ],
    )

    const plan = planRows[0]
    if (!plan) return null
    return {
      ...plan,
      meals: mealRows,
      days: dayRows,
      dayMeals: dayMealRows,
      entries: entryRows,
    }
  }

  async function okDoc(planId: string): Promise<PlanDocResult> {
    const doc = await getDocument(planId)
    if (!doc) throw new Error('plan vanished mid-mutation')
    return { ok: true, doc }
  }

  return {
    getDocument,

    // Plans index. dayCount / entryCount are correlated counts; the plan cap
    // (100) bounds the scan.
    async listSummaries(): Promise<PlanSummaryRow[]> {
      return db
        .select({
          id: foodPlans.id,
          name: foodPlans.name,
          sortOrder: foodPlans.sortOrder,
          createdAt: foodPlans.createdAt,
          updatedAt: foodPlans.updatedAt,
          dayCount: sql<number>`(select count(*) from ${foodPlanDays} where ${foodPlanDays.foodPlanId} = ${foodPlans.id})`,
          entryCount: sql<number>`(select count(*) from ${foodPlanEntries} where ${foodPlanEntries.foodPlanId} = ${foodPlans.id})`,
        })
        .from(foodPlans)
        .where(eq(foodPlans.userId, userId))
        .orderBy(asc(foodPlans.sortOrder), asc(foodPlans.name))
    },

    // Seed a new plan atomically: the plan + 3 default meals + `days` day rows +
    // a full day x meal grid, all in one db.batch (a D1 transaction). Each row
    // is its OWN single-row insert statement, so the batch never approaches the
    // 100-bound-param-per-STATEMENT limit no matter how many days are seeded.
    // Batch order is plan -> meals + days -> day_meals so every FK target
    // precedes its referrers. The plan-cap trigger aborts (and rolls back the
    // whole batch) if the user is at 100.
    async create(name: string, days: number): Promise<PlanDocResult> {
      const planId = crypto.randomUUID()
      const now = Date.now()
      const mealDefs = DEFAULT_MEALS.map((m, i) => ({
        id: crypto.randomUUID(),
        name: m.name,
        anchorRole: m.anchorRole,
        sortOrder: i,
      }))
      const dayDefs = Array.from({ length: days }, (_, i) => ({
        id: crypto.randomUUID(),
        sortOrder: i,
      }))
      const insertPlan = db.insert(foodPlans).values({
        id: planId,
        userId,
        name,
        sortOrder: nextPlanSortOrder(),
        createdAt: now,
        updatedAt: now,
      })
      const insertMeals = mealDefs.map((m) =>
        db.insert(meals).values({
          id: m.id,
          userId,
          foodPlanId: planId,
          name: m.name,
          anchorRole: m.anchorRole,
          isDefault: true,
          sortOrder: m.sortOrder,
          createdAt: now,
          updatedAt: now,
        }),
      )
      const insertDays = dayDefs.map((d) =>
        db.insert(foodPlanDays).values({
          id: d.id,
          userId,
          foodPlanId: planId,
          sortOrder: d.sortOrder,
          createdAt: now,
          updatedAt: now,
        }),
      )
      const insertGrid = dayDefs.flatMap((d) =>
        mealDefs.map((m) =>
          db.insert(dayMeals).values({
            id: crypto.randomUUID(),
            userId,
            foodPlanId: planId,
            dayId: d.id,
            mealId: m.id,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      )
      try {
        await db.batch([insertPlan, ...insertMeals, ...insertDays, ...insertGrid])
      } catch (err) {
        if (isFoodPlanCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        throw err
      }
      return okDoc(planId)
    },

    async rename(planId: string, name: string): Promise<PlanDocResult> {
      const [row] = await db
        .update(foodPlans)
        .set({ name, updatedAt: Date.now() })
        .where(and(eq(foodPlans.id, planId), eq(foodPlans.userId, userId)))
        .returning({ id: foodPlans.id })
      if (!row) return { ok: false, reason: 'not_found' }
      return okDoc(planId)
    },

    // The whole graph cascades from the plan row. The atomic detach-then-delete
    // batch (design 2.3.1) is a slice-3 concern - no list points at a plan yet.
    async remove(planId: string): Promise<boolean> {
      const rows = await db
        .delete(foodPlans)
        .where(and(eq(foodPlans.id, planId), eq(foodPlans.userId, userId)))
        .returning({ id: foodPlans.id })
      return rows.length > 0
    },

    // Append a day and schedule every existing meal on it (a full grid row), so
    // the new day has cells to add food to immediately. The day-cap trigger
    // aborts the batch at 60.
    //
    // ACCEPTED race (design 6 / 12.3 philosophy - a single-user planner does not
    // build machinery to close concurrent-edit races): the meal read happens
    // before the write batch, so a concurrent addMeal can create a meal this
    // addDay never sees, leaving that (new day, new meal) cell unscheduled. That
    // is indistinguishable from an intentionally omitted cell and is recoverable
    // from the UI's "add back" pill; slice 2b also serializes structural
    // mutations behind pending state, so it does not arise in normal use.
    async addDay(planId: string): Promise<PlanDocResult> {
      if (!(await requirePlan(planId))) return { ok: false, reason: 'not_found' }
      const mealRows = await db
        .select({ id: meals.id })
        .from(meals)
        .where(and(eq(meals.foodPlanId, planId), eq(meals.userId, userId)))
      const dayId = crypto.randomUUID()
      const now = Date.now()
      const insertDay = db.insert(foodPlanDays).values({
        id: dayId,
        userId,
        foodPlanId: planId,
        sortOrder: sql`coalesce((select max(${foodPlanDays.sortOrder}) + 1 from ${foodPlanDays} where ${foodPlanDays.foodPlanId} = ${planId}), 0)`,
        createdAt: now,
        updatedAt: now,
      })
      const insertCells = mealRows.map((m) =>
        db.insert(dayMeals).values({
          id: crypto.randomUUID(),
          userId,
          foodPlanId: planId,
          dayId,
          mealId: m.id,
          createdAt: now,
          updatedAt: now,
        }),
      )
      try {
        await db.batch([insertDay, ...insertCells])
      } catch (err) {
        if (isFoodPlanDayCapError(err)) {
          return { ok: false, reason: 'cap_exceeded' }
        }
        // The plan was deleted between requirePlan and the batch.
        if (isForeignKeyViolation(err)) return { ok: false, reason: 'not_found' }
        throw err
      }
      return okDoc(planId)
    },

    async removeDay(planId: string, dayId: string): Promise<PlanDocResult> {
      if (!(await requirePlan(planId))) return { ok: false, reason: 'not_found' }
      // Cascade clears this day's day_meals and their entries. A 0-row delete
      // means the day is not in this plan -> 404 rather than a false success.
      const rows = await db
        .delete(foodPlanDays)
        .where(
          and(
            eq(foodPlanDays.id, dayId),
            eq(foodPlanDays.foodPlanId, planId),
            eq(foodPlanDays.userId, userId),
          ),
        )
        .returning({ id: foodPlanDays.id })
      if (rows.length === 0) return { ok: false, reason: 'not_found' }
      return okDoc(planId)
    },

    // Add a meal definition and schedule it on every existing day. The meal-cap
    // trigger aborts the batch at 20.
    async addMeal(planId: string, name: string): Promise<PlanDocResult> {
      if (!(await requirePlan(planId))) return { ok: false, reason: 'not_found' }
      const dayRows = await db
        .select({ id: foodPlanDays.id })
        .from(foodPlanDays)
        .where(
          and(
            eq(foodPlanDays.foodPlanId, planId),
            eq(foodPlanDays.userId, userId),
          ),
        )
      const mealId = crypto.randomUUID()
      const now = Date.now()
      const insertMeal = db.insert(meals).values({
        id: mealId,
        userId,
        foodPlanId: planId,
        name,
        anchorRole: null,
        isDefault: false,
        sortOrder: sql`coalesce((select max(${meals.sortOrder}) + 1 from ${meals} where ${meals.foodPlanId} = ${planId}), 0)`,
        createdAt: now,
        updatedAt: now,
      })
      const insertCells = dayRows.map((d) =>
        db.insert(dayMeals).values({
          id: crypto.randomUUID(),
          userId,
          foodPlanId: planId,
          dayId: d.id,
          mealId,
          createdAt: now,
          updatedAt: now,
        }),
      )
      try {
        await db.batch([insertMeal, ...insertCells])
      } catch (err) {
        if (isMealCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        // The plan was deleted between requirePlan and the batch.
        if (isForeignKeyViolation(err)) return { ok: false, reason: 'not_found' }
        throw err
      }
      return okDoc(planId)
    },

    async removeMeal(planId: string, mealId: string): Promise<PlanDocResult> {
      if (!(await requirePlan(planId))) return { ok: false, reason: 'not_found' }
      // Cascade clears this meal's day_meals and their entries on every day. A
      // 0-row delete means the meal is not in this plan -> 404.
      const rows = await db
        .delete(meals)
        .where(
          and(
            eq(meals.id, mealId),
            eq(meals.foodPlanId, planId),
            eq(meals.userId, userId),
          ),
        )
        .returning({ id: meals.id })
      if (rows.length === 0) return { ok: false, reason: 'not_found' }
      return okDoc(planId)
    },

    // Schedule a (day, meal) cell - the restore side of omit/restore. Idempotent:
    // an already-scheduled cell is a no-op success. A day or meal not in this
    // plan is invalid_ref (prechecked, so control flow never leans on FK error
    // text).
    async addDayMeal(
      planId: string,
      dayId: string,
      mealId: string,
    ): Promise<PlanDocResult> {
      if (!(await requirePlan(planId))) return { ok: false, reason: 'not_found' }
      const [day] = await db
        .select({ id: foodPlanDays.id })
        .from(foodPlanDays)
        .where(
          and(
            eq(foodPlanDays.id, dayId),
            eq(foodPlanDays.foodPlanId, planId),
            eq(foodPlanDays.userId, userId),
          ),
        )
        .limit(1)
      const [meal] = await db
        .select({ id: meals.id })
        .from(meals)
        .where(
          and(
            eq(meals.id, mealId),
            eq(meals.foodPlanId, planId),
            eq(meals.userId, userId),
          ),
        )
        .limit(1)
      if (!day || !meal) return { ok: false, reason: 'invalid_ref' }
      const [existing] = await db
        .select({ id: dayMeals.id })
        .from(dayMeals)
        .where(and(eq(dayMeals.dayId, dayId), eq(dayMeals.mealId, mealId)))
        .limit(1)
      if (!existing) {
        const now = Date.now()
        try {
          await db.insert(dayMeals).values({
            id: crypto.randomUUID(),
            userId,
            foodPlanId: planId,
            dayId,
            mealId,
            createdAt: now,
            updatedAt: now,
          })
        } catch (err) {
          // A concurrent restore already created the cell -> idempotent success
          // (fall through to okDoc). Any other constraint (the day or meal
          // deleted between the precheck and the insert) is invalid_ref.
          if (!isAnyUniqueViolation(err)) {
            if (isForeignKeyViolation(err)) {
              return { ok: false, reason: 'invalid_ref' }
            }
            throw err
          }
        }
      }
      return okDoc(planId)
    },

    async removeDayMeal(
      planId: string,
      dayMealId: string,
    ): Promise<PlanDocResult> {
      if (!(await requirePlan(planId))) return { ok: false, reason: 'not_found' }
      // Cascade clears this cell's entries. A 0-row delete means the cell is not
      // in this plan -> 404.
      const rows = await db
        .delete(dayMeals)
        .where(
          and(
            eq(dayMeals.id, dayMealId),
            eq(dayMeals.foodPlanId, planId),
            eq(dayMeals.userId, userId),
          ),
        )
        .returning({ id: dayMeals.id })
      if (rows.length === 0) return { ok: false, reason: 'not_found' }
      return okDoc(planId)
    },

    // Add a food to a cell or to Extras. Referenced food and cell are prechecked
    // against ownership / plan membership (invalid_ref), and the target is
    // checked for an existing entry of the same food (duplicate) - the partial
    // unique indexes are the DB backstop. The entry-cap trigger aborts at 2000.
    async addEntry(
      planId: string,
      input: {
        dayMealId: string | null
        isExtra: boolean
        foodItemId: string
        basis: Basis
        amount: number
      },
    ): Promise<PlanDocResult> {
      if (!(await requirePlan(planId))) return { ok: false, reason: 'not_found' }
      const [food] = await db
        .select({ id: foodItems.id })
        .from(foodItems)
        .where(
          and(eq(foodItems.id, input.foodItemId), eq(foodItems.userId, userId)),
        )
        .limit(1)
      if (!food) return { ok: false, reason: 'invalid_ref' }

      if (input.isExtra) {
        const [dup] = await db
          .select({ id: foodPlanEntries.id })
          .from(foodPlanEntries)
          .where(
            and(
              eq(foodPlanEntries.foodPlanId, planId),
              eq(foodPlanEntries.isExtra, true),
              eq(foodPlanEntries.foodItemId, input.foodItemId),
            ),
          )
          .limit(1)
        if (dup) return { ok: false, reason: 'duplicate' }
      } else {
        const dayMealId = input.dayMealId
        if (dayMealId === null) return { ok: false, reason: 'invalid_ref' }
        const [cell] = await db
          .select({ id: dayMeals.id })
          .from(dayMeals)
          .where(
            and(
              eq(dayMeals.id, dayMealId),
              eq(dayMeals.foodPlanId, planId),
              eq(dayMeals.userId, userId),
            ),
          )
          .limit(1)
        if (!cell) return { ok: false, reason: 'invalid_ref' }
        const [dup] = await db
          .select({ id: foodPlanEntries.id })
          .from(foodPlanEntries)
          .where(
            and(
              eq(foodPlanEntries.dayMealId, dayMealId),
              eq(foodPlanEntries.foodItemId, input.foodItemId),
            ),
          )
          .limit(1)
        if (dup) return { ok: false, reason: 'duplicate' }
      }

      const now = Date.now()
      try {
        await db.insert(foodPlanEntries).values({
          id: crypto.randomUUID(),
          userId,
          foodPlanId: planId,
          dayMealId: input.isExtra ? null : input.dayMealId,
          isExtra: input.isExtra,
          foodItemId: input.foodItemId,
          basis: input.basis,
          amount: input.amount,
          sortOrder: sql`coalesce((select max(${foodPlanEntries.sortOrder}) + 1 from ${foodPlanEntries} where ${foodPlanEntries.foodPlanId} = ${planId}), 0)`,
          createdAt: now,
          updatedAt: now,
        })
      } catch (err) {
        if (isFoodPlanEntryCapError(err)) {
          return { ok: false, reason: 'cap_exceeded' }
        }
        // Race backstops behind the prechecks above: a concurrent identical add
        // trips a partial UNIQUE index; the food or cell being deleted mid-flight
        // trips an FK. Both map to the same friendly results the prechecks give.
        if (isAnyUniqueViolation(err)) return { ok: false, reason: 'duplicate' }
        if (isForeignKeyViolation(err)) {
          return { ok: false, reason: 'invalid_ref' }
        }
        throw err
      }
      return okDoc(planId)
    },

    // basis / amount only. Switching to `packages` for a food with no
    // servings_per_package is allowed - the projection flags itself incomplete
    // (design 5.4), it is not a write-time error.
    async updateEntry(
      planId: string,
      entryId: string,
      patch: { basis?: Basis; amount?: number },
    ): Promise<PlanDocResult> {
      const set: Record<string, unknown> = { updatedAt: Date.now() }
      if (patch.basis !== undefined) set.basis = patch.basis
      if (patch.amount !== undefined) set.amount = patch.amount
      const [row] = await db
        .update(foodPlanEntries)
        .set(set)
        .where(
          and(
            eq(foodPlanEntries.id, entryId),
            eq(foodPlanEntries.foodPlanId, planId),
            eq(foodPlanEntries.userId, userId),
          ),
        )
        .returning({ id: foodPlanEntries.id })
      if (!row) return { ok: false, reason: 'not_found' }
      return okDoc(planId)
    },

    async removeEntry(
      planId: string,
      entryId: string,
    ): Promise<PlanDocResult> {
      const rows = await db
        .delete(foodPlanEntries)
        .where(
          and(
            eq(foodPlanEntries.id, entryId),
            eq(foodPlanEntries.foodPlanId, planId),
            eq(foodPlanEntries.userId, userId),
          ),
        )
        .returning({ id: foodPlanEntries.id })
      if (rows.length === 0) return { ok: false, reason: 'not_found' }
      return okDoc(planId)
    },
  }
}
