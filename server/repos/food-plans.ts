import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db'
import {
  dayMeals,
  foodItems,
  foodPackState,
  foodPlanDailyTargets,
  foodPlanDays,
  foodPlanEntries,
  foodPlans,
  foodPlanTargetDefaults,
  lists,
  meals,
  mealTargets,
} from '../db/schema'
import {
  isAnyUniqueViolation,
  isForeignKeyViolation,
  isTriggerAbort,
} from './db-errors'
import {
  buildPlanCopyStatements,
  chunkForParamCap,
  isFoodPlanCapError,
} from './food-plan-copy'
import { copyName } from './lists'

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
  // The list this plan backs, if any. At most one exists
  // (lists_food_plan_id_unique) - this is what lets the picker say
  // "In use by <list>" and offer Duplicate & attach without a second query.
  usedByListId: string | null
  usedByListName: string | null
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

export type UsedByListRow = { id: string; name: string }

export type DailyTargetRow = {
  id: string
  metric: 'calories' | 'protein' | 'carbs' | 'fiber' | 'sodium' | 'calorie_density'
  mode: 'range' | 'min' | 'max'
  targetMin: number | null
  targetMax: number | null
}

export type MealTargetRow = {
  id: string
  mealId: string
  metric: 'calories' | 'protein' | 'fat_pct' | 'sugar_pct' | 'carb_protein_ratio'
  mode: 'range' | 'min' | 'max'
  targetMin: number | null
  targetMax: number | null
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
  dailyTargets: DailyTargetRow[]
  mealTargets: MealTargetRow[]
  usedByList: UsedByListRow | null
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
// isFoodPlanCapError lives in food-plan-copy.ts (lists.duplicate needs it and
// cannot import this file - see the note there); re-exported so its home for
// routes and tests is unchanged.
export { isFoodPlanCapError }
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

  // Rule 2 of the pack-state lifecycle (design 6): appended to the SAME batch
  // as any mutation that can remove entries from this plan, it deletes any
  // checkmark on the list the plan backs (at most one; the IN-subselect form
  // is kept because it is already correct and self-limiting) whose food no
  // longer appears ANYWHERE in the plan. Reconciling against what REMAINS is
  // what covers every removal path by construction - the direct entry delete
  // AND the cascades from a day, meal, or cell delete, which no per-entry
  // cleanup would see - and keeps last-occurrence semantics automatic (a food
  // in two cells keeps its checkmark until the last one goes). NOT IN is
  // NULL-safe here only because food_plan_entries.food_item_id is NOT NULL.
  // Hand-written SQL, but note both subselects compare inner columns to bound
  // params only - the safe side of the drizzle unqualified-column trap
  // (AGENTS.md). Ordering: run AFTER the structural delete in the batch, so
  // "remains" means remains.
  //
  // The one removal path that does NOT exist: updateEntry cannot change
  // food_item_id (shared/food-plans.ts allows only basis/amount), so entry
  // updates never need this. If that patch surface ever widens, updateEntry
  // needs the reconcile too.
  // (Builder + raw where, not db.run(sql): raw queries type-check as batch
  // items but crash the D1 driver's batch() at runtime - see toggleFoodPack
  // in repos/lists.ts.)
  function reconcilePackState(planId: string) {
    return db.delete(foodPackState).where(
      sql`user_id = ${userId}
         and list_id in (
           select id from lists
            where food_plan_id = ${planId} and user_id = ${userId}
         )
         and food_item_id not in (
           select e.food_item_id from food_plan_entries e
            where e.food_plan_id = ${planId} and e.user_id = ${userId}
         )`,
    )
  }

  // The single batched plan read (design 5.2): the plan row plus its four child
  // collections and the list it backs, in ONE db.batch (a D1 transaction, so
  // all six see a consistent snapshot - no interleaving with a concurrent
  // write). Each child is filtered by (food_plan_id, user_id) so ownership is
  // structural, not a post-filter. Returns null when the plan is not owned (the
  // children come back empty too).
  //
  // usedByList (at most one holder - the partial unique index) rides on the
  // document rather than its own endpoint so the editor's "Used by" breadcrumb
  // reads the same cache entry as everything else it shows - a mutation that
  // returns the fresh document refreshes the breadcrumb with it.
  async function getDocument(
    planId: string,
  ): Promise<FoodPlanDocumentRow | null> {
    const [
      planRows,
      mealRows,
      dayRows,
      dayMealRows,
      entryRows,
      dailyTargetRows,
      mealTargetRows,
      usedByRows,
    ] = await db.batch([
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
        db
          .select({
            id: foodPlanDailyTargets.id,
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
          )
          .orderBy(asc(foodPlanDailyTargets.metric)),
        db
          .select({
            id: mealTargets.id,
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
          )
          .orderBy(asc(mealTargets.mealId), asc(mealTargets.metric)),
        db
          .select({ id: lists.id, name: lists.name })
          .from(lists)
          .where(and(eq(lists.foodPlanId, planId), eq(lists.userId, userId)))
          .limit(1),
      ])

    const plan = planRows[0]
    if (!plan) return null
    return {
      ...plan,
      meals: mealRows,
      days: dayRows,
      dayMeals: dayMealRows,
      entries: entryRows,
      dailyTargets: dailyTargetRows,
      mealTargets: mealTargetRows,
      usedByList: usedByRows[0] ?? null,
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
    //
    // The holder ("used by") comes from a LEFT JOIN, not a correlated
    // subselect, and the join is load-bearing beyond style: in a SINGLE-TABLE
    // select, drizzle renders every column inside a sql`` fragment
    // UNQUALIFIED, so a correlated subselect like
    //   (select ${lists.id} from ${lists} where ${lists.foodPlanId} = ${foodPlans.id})
    // becomes (select "id" from "lists" where "food_plan_id" = "id") - BOTH
    // sides resolve against the inner table and the predicate is
    // vacuously false/true. That bug shipped in the original count subselects
    // (every plan reported 0 days / 0 items on the wire; the page tests
    // mocked the fetcher and never saw it - caught by the summaries API test
    // 2026-07-16). With a join present drizzle qualifies everything,
    // including these count subselects. See AGENTS.md.
    //
    // The join matches at most one row per plan: the partial unique index
    // caps holders at one, and the same-owner condition mirrors the
    // composite FK.
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
          // Left-joined, so null on the wire when no list holds the plan.
          usedByListId: lists.id,
          usedByListName: lists.name,
        })
        .from(foodPlans)
        .leftJoin(
          lists,
          and(
            eq(lists.foodPlanId, foodPlans.id),
            eq(lists.userId, foodPlans.userId),
          ),
        )
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
      // Copy the account's default daily targets BY VALUE (I-SNAPSHOT): no
      // linkage, so later default edits never rewrite this plan. The read
      // runs before the batch; an interleaved defaults edit lands wholly
      // before or wholly after this snapshot, both fine.
      const defaultRows = await db
        .select({
          metric: foodPlanTargetDefaults.metric,
          mode: foodPlanTargetDefaults.mode,
          targetMin: foodPlanTargetDefaults.targetMin,
          targetMax: foodPlanTargetDefaults.targetMax,
        })
        .from(foodPlanTargetDefaults)
        .where(eq(foodPlanTargetDefaults.userId, userId))
      const insertDefaultTargets = chunkForParamCap(
        defaultRows.map((d) => ({
          id: crypto.randomUUID(),
          userId,
          foodPlanId: planId,
          metric: d.metric,
          mode: d.mode,
          targetMin: d.targetMin,
          targetMax: d.targetMax,
          createdAt: now,
          updatedAt: now,
        })),
      ).map((rows) => db.insert(foodPlanDailyTargets).values(rows))
      try {
        await db.batch([
          insertPlan,
          ...insertMeals,
          ...insertDays,
          ...insertGrid,
          ...insertDefaultTargets,
        ])
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

    // Delete a plan via the atomic detach-then-delete batch (design 2.3.1). The
    // plan graph (meals / days / day_meals / entries) cascades from the plan
    // row, but lists.food_plan_id is a NO ACTION reference - SQLite has no
    // column-list SET NULL, so it cannot null just food_plan_id (it would null
    // user_id too, a NOT NULL violation). Any attached list must therefore be
    // detached FIRST; skip that and the plan delete fails the FK, which is the
    // intended hard backstop, not a bug.
    //
    // All three statements run in one db.batch - a D1 transaction - so there
    // is no partial outcome. The pack-state clear (design 6, rule 1: the
    // delete detaches the holding list, which is a relink) comes FIRST,
    // because it finds the affected list through lists.food_plan_id and the
    // detach destroys exactly that link - after it, the checkmarks would be
    // unreachable (design 2.3.1 step order).
    async remove(planId: string): Promise<boolean> {
      const clearPack = db.delete(foodPackState).where(
        sql`user_id = ${userId}
           and list_id in (
             select id from lists
              where food_plan_id = ${planId} and user_id = ${userId}
           )`,
      )
      const detach = db
        .update(lists)
        .set({ foodPlanId: null, updatedAt: Date.now() })
        .where(and(eq(lists.foodPlanId, planId), eq(lists.userId, userId)))
      const del = db
        .delete(foodPlans)
        .where(and(eq(foodPlans.id, planId), eq(foodPlans.userId, userId)))
        .returning({ id: foodPlans.id })
      const [, , deleted] = await db.batch([clearPack, detach, del])
      return deleted.length > 0
    },

    // Deep-copy the plan graph with fresh ids throughout (design 3.1): meals,
    // days, the grid and the entries, referencing the same account-wide
    // food_items. The copy machinery is shared with lists.duplicate()
    // (food-plan-copy.ts): a plan backs at most one list, so duplicating a
    // LIST must copy its plan too, and two graph-copy implementations would
    // drift. No pack state is copied - pack state is not keyed by plan.
    //
    // listId is "Duplicate & attach" (design 3.1 under one-plan-per-trip):
    // when present, that list is re-pointed at the copy IN THE SAME BATCH as
    // the copy itself, so there is no window where the copy exists but the
    // trip still follows the original. The list must be the caller's
    // (invalid_ref otherwise), and the attach UPDATE is a compare-and-swap on
    // expectedFoodPlanId - the link the CLIENT OBSERVED when it offered the
    // action (null = it saw none). A concurrent attach/detach/duplicate in
    // another tab moves the link and the CAS matches zero rows instead of
    // silently overwriting it; without the CAS, two concurrent duplicates
    // would both 201 and the loser's copy would survive as an orphan plan.
    // When the CAS loses, the copy has already committed, so it is deleted
    // (cascade takes the children) and the caller gets invalid_ref - not a
    // 201 whose promised attach never happened.
    //
    // Statement budget: each child insert is a MULTI-ROW statement chunked by
    // bound-parameter count (chunkForParamCap in food-plan-copy.ts). A
    // worst-case plan (20 meals, 60 days, 1200 cells, 2000 entries) lands in
    // ~360 statements in ONE db.batch = one D1 call; per-row statements would
    // be ~3300. Batch order is plan -> meals -> days -> day_meals -> entries
    // -> attach, so every FK target precedes its referrers.
    //
    // Only the plan-cap trigger can fire (children are copied 1:1 from a plan
    // already under its caps). An entry's food deleted mid-request surfaces as
    // an FK violation -> invalid_ref, same backstop as addEntry. The new
    // lists_food_plan_id_unique index cannot fire here: the copy's id is
    // freshly generated, so no other list can already reference it.
    async duplicate(
      planId: string,
      listId: string | null,
      expectedFoodPlanId: string | null,
    ): Promise<PlanDocResult> {
      const source = await getDocument(planId)
      if (!source) return { ok: false, reason: 'not_found' }

      if (listId !== null) {
        const [list] = await db
          .select({ id: lists.id })
          .from(lists)
          .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
          .limit(1)
        if (!list) return { ok: false, reason: 'invalid_ref' }
      }

      const now = Date.now()
      const newPlanId = crypto.randomUUID()
      const [copyFirst, ...copyRest] = buildPlanCopyStatements(
        db,
        userId,
        source,
        { newPlanId, name: copyName(source.name), now },
      )
      const attach =
        listId !== null
          ? [
              // Rule 1 (design 6): the attach below re-points the list, so its
              // checkmarks clear - the copy contains the same foods, and they
              // must not render pre-checked on a plan nobody packed for. Gated
              // by the SAME compare-and-swap as the attach (`is` = SQLite's
              // null-safe equality, since the expectation may be null) and
              // ordered BEFORE it, because after the update the link no longer
              // matches the expectation. When the CAS loses, both statements
              // match zero rows: a duplicate that did not attach must not have
              // wiped anything.
              db.delete(foodPackState).where(
                sql`list_id = ${listId} and user_id = ${userId}
                   and exists (
                     select 1 from lists l
                      where l.id = ${listId} and l.user_id = ${userId}
                        and l.food_plan_id is ${expectedFoodPlanId}
                   )`,
              ),
              db
                .update(lists)
                .set({ foodPlanId: newPlanId, updatedAt: now })
                .where(
                  and(
                    eq(lists.id, listId),
                    eq(lists.userId, userId),
                    // CAS on the client's observed link (see method comment).
                    expectedFoodPlanId === null
                      ? isNull(lists.foodPlanId)
                      : eq(lists.foodPlanId, expectedFoodPlanId),
                  ),
                )
                .returning({ id: lists.id }),
            ]
          : []

      let results: unknown[]
      try {
        results = await db.batch([copyFirst, ...copyRest, ...attach])
      } catch (err) {
        if (isFoodPlanCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        if (isForeignKeyViolation(err)) return { ok: false, reason: 'invalid_ref' }
        throw err
      }

      // The attach is the batch's LAST statement; its returning() array is
      // empty when the CAS matched nothing (list deleted / detached / moved
      // between the precheck and the batch). The copy committed with it, so
      // undo it - a compensating delete rather than a rollback, because D1
      // gives no way to abort a batch on an empty UPDATE. The window where
      // the orphan copy exists is this one request's tail, and its id has
      // never left the server.
      if (attach.length > 0) {
        const attached = results[results.length - 1] as { id: string }[]
        if (attached.length === 0) {
          await db
            .delete(foodPlans)
            .where(and(eq(foodPlans.id, newPlanId), eq(foodPlans.userId, userId)))
          return { ok: false, reason: 'invalid_ref' }
        }
      }
      return okDoc(newPlanId)
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
      // The cascade can take a food's LAST occurrence with it, so the
      // pack-state reconcile rides the same batch (rule 2; a no-op when the
      // delete matched nothing).
      const [rows] = await db.batch([
        db
          .delete(foodPlanDays)
          .where(
            and(
              eq(foodPlanDays.id, dayId),
              eq(foodPlanDays.foodPlanId, planId),
              eq(foodPlanDays.userId, userId),
            ),
          )
          .returning({ id: foodPlanDays.id }),
        reconcilePackState(planId),
      ])
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
      // 0-row delete means the meal is not in this plan -> 404. Reconcile
      // rides the batch for the same reason as removeDay (rule 2).
      const [rows] = await db.batch([
        db
          .delete(meals)
          .where(
            and(
              eq(meals.id, mealId),
              eq(meals.foodPlanId, planId),
              eq(meals.userId, userId),
            ),
          )
          .returning({ id: meals.id }),
        reconcilePackState(planId),
      ])
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
      // in this plan -> 404. Reconcile rides the batch (rule 2).
      const [rows] = await db.batch([
        db
          .delete(dayMeals)
          .where(
            and(
              eq(dayMeals.id, dayMealId),
              eq(dayMeals.foodPlanId, planId),
              eq(dayMeals.userId, userId),
            ),
          )
          .returning({ id: dayMeals.id }),
        reconcilePackState(planId),
      ])
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
      // The direct removal path: if this was the food's last occurrence in
      // the plan, its checkmark clears with it (rule 2, same batch).
      const [rows] = await db.batch([
        db
          .delete(foodPlanEntries)
          .where(
            and(
              eq(foodPlanEntries.id, entryId),
              eq(foodPlanEntries.foodPlanId, planId),
              eq(foodPlanEntries.userId, userId),
            ),
          )
          .returning({ id: foodPlanEntries.id }),
        reconcilePackState(planId),
      ])
      if (rows.length === 0) return { ok: false, reason: 'not_found' }
      return okDoc(planId)
    },

    // Force a day full/partial for target grading (null = back to auto). The
    // predicate carries all THREE columns - day id, plan id, user id - not
    // just ownership: a caller who owns two plans must not be able to reach
    // plan B's day through plan A's URL (same-plan membership is its own
    // invariant, exactly like the composite FKs).
    async setDayType(
      planId: string,
      dayId: string,
      override: 'full' | 'partial' | null,
    ): Promise<PlanDocResult> {
      const rows = await db
        .update(foodPlanDays)
        .set({ dayTypeOverride: override, updatedAt: Date.now() })
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

    // FULL replace of the plan's target set (design decision 1): delete-all +
    // insert-all in one batch. The payload is zod-validated upstream (bounds,
    // pct ceiling, duplicates, size caps), so the only repo-level concerns are
    // ownership and the meal references.
    async saveTargets(
      planId: string,
      daily: Omit<DailyTargetRow, 'id'>[],
      mealTargetInputs: Omit<MealTargetRow, 'id'>[],
    ): Promise<PlanDocResult> {
      if (!(await requirePlan(planId))) return { ok: false, reason: 'not_found' }

      // Meal-ownership precheck, INVERTED: select the plan's own meal ids
      // (at most the 20-per-plan cap - 2 bound params, never chunked) and
      // test payload ids against that set in JS. The straight shape - binding
      // every payload id into one in(...) - can meet D1's 100-param cap,
      // because a zod-valid payload may carry up to 100 distinct ids.
      const ownMeals = await db
        .select({ id: meals.id })
        .from(meals)
        .where(and(eq(meals.foodPlanId, planId), eq(meals.userId, userId)))
      const ownMealIds = new Set(ownMeals.map((m) => m.id))
      for (const t of mealTargetInputs) {
        if (!ownMealIds.has(t.mealId)) return { ok: false, reason: 'invalid_ref' }
      }

      const now = Date.now()
      const dailyRows = daily.map((t) => ({
        id: crypto.randomUUID(),
        userId,
        foodPlanId: planId,
        metric: t.metric,
        mode: t.mode,
        targetMin: t.targetMin,
        targetMax: t.targetMax,
        createdAt: now,
        updatedAt: now,
      }))
      const mealRows = mealTargetInputs.map((t) => ({
        id: crypto.randomUUID(),
        userId,
        foodPlanId: planId,
        mealId: t.mealId,
        metric: t.metric,
        mode: t.mode,
        targetMin: t.targetMin,
        targetMax: t.targetMax,
        createdAt: now,
        updatedAt: now,
      }))

      try {
        await db.batch([
          db
            .delete(foodPlanDailyTargets)
            .where(
              and(
                eq(foodPlanDailyTargets.foodPlanId, planId),
                eq(foodPlanDailyTargets.userId, userId),
              ),
            ),
          db
            .delete(mealTargets)
            .where(
              and(
                eq(mealTargets.foodPlanId, planId),
                eq(mealTargets.userId, userId),
              ),
            ),
          ...chunkForParamCap(dailyRows).map((rows) =>
            db.insert(foodPlanDailyTargets).values(rows),
          ),
          ...chunkForParamCap(mealRows).map((rows) =>
            db.insert(mealTargets).values(rows),
          ),
        ])
      } catch (err) {
        // A meal deleted between the precheck and the batch trips the
        // (meal_id, food_plan_id) FK; the batch (including the deletes) rolls
        // back, so this maps to the same 422 the precheck gives - not a 500.
        if (isForeignKeyViolation(err)) return { ok: false, reason: 'invalid_ref' }
        throw err
      }
      return okDoc(planId)
    },
  }
}
