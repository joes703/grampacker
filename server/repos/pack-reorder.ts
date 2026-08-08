import { and, eq, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db } from '../db'
import {
  foodPackReorderGuard,
  listFoodItems,
  listItems,
  packReorderGuard,
} from '../db/schema'
import {
  isAnyUniqueViolation,
  isFoodPackGuardViolation,
  isPackGuardViolation,
} from './db-errors'

// The ONE implementation of "permute a packing cohort safely", shared by both
// packable tables. Until 0022 this lived inside the list-items repo and gear
// was its only customer; food becoming a second packable type is exactly the
// moment the machinery must stop being table-shaped.
//
// A COHORT is now a UNION: the list_items rows and the list_food_items rows
// sharing (list_id, packing_location_id), displayed merged by
// (pack_sort_order, gear-before-food, id). A reorder payload permutes ranks
// across the whole union - moving a food row between two gear rows hands the
// food row a rank a gear row held and vice versa - so the permutation check
// compares the union multiset, not per-table multisets.
//
// Each table keeps its own unique cohort index, so uniqueness is enforced
// WITHIN a table only. A cross-table duplicate cannot corrupt anything: it
// displays by the deterministic tiebreak and dissolves on the next reorder,
// which rewrites the union densely. Both tables are written in ONE db.batch
// (a single D1 transaction), so a concurrent reorder of the same cohort still
// collides on one of the two indexes - or trips one of the two guards - and
// the whole batch rolls back into the route's 409.
//
// The two-phase park/settle shape, the negative scratch bands, and the
// fail-loud guard are documented in depth on migrations 0018/0019 and on the
// gear half's original implementation notes (git history of list-items.ts);
// the mechanism here is identical, just instantiated per table.

export type PackRankUpdate = { id: string; packSortOrder: number }

export type PackReorderPayload = {
  items: PackRankUpdate[]
  foodItems: PackRankUpdate[]
}

export type PackReorderResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'cross_cohort'
        | 'not_a_permutation'
        | 'worn_row'
        | 'conflict'
    }

// The next rank an ARRIVAL takes in a cohort: one past the UNION maximum.
// Cohort-scoped for the 0018 reasons; union-scoped because a bag's contents
// are the union, and a per-table maximum would land a new gear row visually
// ABOVE food already sitting at higher ranks in the same bag.
//
// Identifiers are hand-written: drizzle renders interpolated columns
// unqualified inside correlated subqueries (the AGENTS.md sql`` trap), and
// this fragment is embedded into UPDATE ... SET on both tables.
//
// `is not distinct from` because the Unassigned cohort is keyed by NULL and
// `null = null` is null in SQL.
export function nextUnionPackRank(
  listId: string,
  userId: string,
  locationId: string | null,
): SQL<number> {
  return sql`coalesce((
    select max(m) + 1 from (
      select max(pack_sort_order) as m from list_items
       where list_id = ${listId} and user_id = ${userId}
         and packing_location_id is not distinct from ${locationId}
      union all
      select max(pack_sort_order) as m from list_food_items
       where list_id = ${listId} and user_id = ${userId}
         and packing_location_id is not distinct from ${locationId}
    )
  ), 0)`
}

// Merge a bag's two halves into display order. Shared by the repos that must
// preserve union order when appending whole cohorts (location delete), and
// mirrored client-side; rank first, gear before food on a cross-table tie,
// id as the total-order backstop.
export function unionOrder<
  T extends { packSortOrder: number; id: string },
>(gear: T[], food: T[]): { kind: 'gear' | 'food'; row: T }[] {
  const tagged = [
    ...gear.map((row) => ({ kind: 'gear' as const, row })),
    ...food.map((row) => ({ kind: 'food' as const, row })),
  ]
  return tagged.sort(
    (a, b) =>
      a.row.packSortOrder - b.row.packSortOrder ||
      (a.kind === b.kind ? 0 : a.kind === 'gear' ? -1 : 1) ||
      (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0),
  )
}

export function createPackReorderRepo(db: Db, userId: string) {
  return {
    // packSortOrder ONLY - reorders must not bump updatedAt (product rule).
    //
    // Validation, matching what the gear-only implementation enforced:
    //   1. every id owned by this user on this list (else not_found)
    //   2. worn gear rows rejected (they render outside the packing tree)
    //   3. the whole payload inside ONE cohort, across both tables
    //   4. incoming ranks a PERMUTATION of the union's current ranks
    async reorder(
      listId: string,
      payload: PackReorderPayload,
    ): Promise<PackReorderResult> {
      // Both cohort scans in one batch: a consistent snapshot, so the
      // permutation check cannot straddle a concurrent write. Owned-set
      // membership rather than inArray over the input - D1 caps bound params
      // at 100 and the payload allows LIST_ITEM_CAP + FOOD_ITEM_CAP ids; the
      // per-list caps bound the scans instead.
      const [gearRows, foodRows] = await db.batch([
        db
          .select({
            id: listItems.id,
            packingLocationId: listItems.packingLocationId,
            packSortOrder: listItems.packSortOrder,
            isWorn: listItems.isWorn,
          })
          .from(listItems)
          .where(
            and(eq(listItems.listId, listId), eq(listItems.userId, userId)),
          ),
        db
          .select({
            id: listFoodItems.id,
            packingLocationId: listFoodItems.packingLocationId,
            packSortOrder: listFoodItems.packSortOrder,
          })
          .from(listFoodItems)
          .where(
            and(
              eq(listFoodItems.listId, listId),
              eq(listFoodItems.userId, userId),
            ),
          ),
      ])
      const gearById = new Map(gearRows.map((r) => [r.id, r]))
      const foodById = new Map(foodRows.map((r) => [r.id, r]))

      const touched: {
        packingLocationId: string | null
        packSortOrder: number
      }[] = []
      for (const u of payload.items) {
        const row = gearById.get(u.id)
        if (!row) return { ok: false, reason: 'not_found' }
        if (row.isWorn) return { ok: false, reason: 'worn_row' }
        touched.push(row)
      }
      for (const u of payload.foodItems) {
        const row = foodById.get(u.id)
        if (!row) return { ok: false, reason: 'not_found' }
        touched.push(row)
      }

      const [firstTouched] = touched
      if (!firstTouched) return { ok: true } // unreachable: DTO enforces min 1
      const cohort = firstTouched.packingLocationId
      if (touched.some((r) => r.packingLocationId !== cohort)) {
        return { ok: false, reason: 'cross_cohort' }
      }

      // UNION permutation: the multiset of incoming ranks (both tables
      // together) must equal the multiset the touched rows currently hold.
      // Per-table multisets deliberately NOT compared - interleaving means a
      // food row may take a rank a gear row held.
      const before = touched.map((r) => r.packSortOrder).sort((a, b) => a - b)
      const after = [...payload.items, ...payload.foodItems]
        .map((u) => u.packSortOrder)
        .sort((a, b) => a - b)
      if (before.some((rank, i) => rank !== after[i])) {
        return { ok: false, reason: 'not_a_permutation' }
      }

      const cohortPredicate = (col: {
        packingLocationId:
          | typeof listItems.packingLocationId
          | typeof listFoodItems.packingLocationId
      }) =>
        cohort === null
          ? isNull(col.packingLocationId)
          : eq(col.packingLocationId, cohort)

      // Park/settle per table, each inside its own scratch band (-300 wide
      // for gear, -200 for food - each exactly its cap, so `i` always fits).
      // Every predicate RE-ASSERTS what the pre-read saw (id, list, cohort,
      // current rank, not-worn) so a row that moved between the read and the
      // batch is not written with a rank computed for a different bag.
      const scratch = (i: number) => -1 - i
      const gearPark = payload.items.map((u, i) =>
        db
          .update(listItems)
          .set({ packSortOrder: scratch(i) })
          .where(
            and(
              eq(listItems.id, u.id),
              eq(listItems.userId, userId),
              eq(listItems.listId, listId),
              eq(listItems.isWorn, false),
              eq(listItems.packSortOrder, gearById.get(u.id)!.packSortOrder),
              cohortPredicate(listItems),
            ),
          ),
      )
      const foodPark = payload.foodItems.map((u, i) =>
        db
          .update(listFoodItems)
          .set({ packSortOrder: scratch(i) })
          .where(
            and(
              eq(listFoodItems.id, u.id),
              eq(listFoodItems.userId, userId),
              eq(listFoodItems.listId, listId),
              eq(
                listFoodItems.packSortOrder,
                foodById.get(u.id)!.packSortOrder,
              ),
              cohortPredicate(listFoodItems),
            ),
          ),
      )

      // One fail-loud guard per table (each table's negative count is an
      // exact park census - see 0019/0022). Both run even when that table's
      // half of the payload is empty: count(*) = 0 still has to hold, and an
      // unconditional shape keeps the batch statement list deterministic.
      // Raw SQL rides insert builders because db.run(sql) typechecks as a
      // batch item and then crashes the D1 driver; identifiers hand-written
      // (unqualified-rendering trap).
      const cohortMatch =
        cohort === null
          ? sql`packing_location_id is null`
          : sql`packing_location_id = ${cohort}`
      const gearGuard = db.insert(packReorderGuard).select(
        sql`select ${listId}, (select case when count(*) = ${payload.items.length} then 1 end
              from list_items
             where list_id = ${listId} and user_id = ${userId}
               and ${cohortMatch}
               and pack_sort_order < 0)`,
      )
      const foodGuard = db.insert(foodPackReorderGuard).select(
        sql`select ${listId}, (select case when count(*) = ${payload.foodItems.length} then 1 end
              from list_food_items
             where list_id = ${listId} and user_id = ${userId}
               and ${cohortMatch}
               and pack_sort_order < 0)`,
      )

      const gearSettle = payload.items.map((u, i) =>
        db
          .update(listItems)
          .set({ packSortOrder: u.packSortOrder })
          .where(
            and(
              eq(listItems.id, u.id),
              eq(listItems.userId, userId),
              eq(listItems.listId, listId),
              eq(listItems.isWorn, false),
              eq(listItems.packSortOrder, scratch(i)),
              cohortPredicate(listItems),
            ),
          ),
      )
      const foodSettle = payload.foodItems.map((u, i) =>
        db
          .update(listFoodItems)
          .set({ packSortOrder: u.packSortOrder })
          .where(
            and(
              eq(listFoodItems.id, u.id),
              eq(listFoodItems.userId, userId),
              eq(listFoodItems.listId, listId),
              eq(listFoodItems.packSortOrder, scratch(i)),
              cohortPredicate(listFoodItems),
            ),
          ),
      )

      // Not optional: both guard tables key on list_id, so a leftover row
      // makes the NEXT reorder of this list collide on the primary key.
      const cleanup = [
        db.delete(packReorderGuard).where(eq(packReorderGuard.listId, listId)),
        db
          .delete(foodPackReorderGuard)
          .where(eq(foodPackReorderGuard.listId, listId)),
      ]

      const [first, ...rest] = [
        ...gearPark,
        ...foodPark,
        gearGuard,
        foodGuard,
        ...gearSettle,
        ...foodSettle,
        ...cleanup,
      ]
      if (!first) return { ok: true }
      try {
        await db.batch([first, ...rest])
      } catch (err) {
        // Someone beat us, in one of three shapes: a concurrent reorder took
        // a rank first (unique violation on either table's cohort index), or
        // one of the guards counted a missing park (NOT NULL violation on
        // that guard's `ok`). All three rolled the whole batch back; the
        // client refetches and retries.
        if (
          isAnyUniqueViolation(err) ||
          isPackGuardViolation(err) ||
          isFoodPackGuardViolation(err)
        ) {
          return { ok: false, reason: 'conflict' }
        }
        throw err
      }
      return { ok: true }
    },
  }
}
