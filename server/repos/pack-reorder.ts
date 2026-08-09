import { and, eq, sql } from 'drizzle-orm'
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
  isPackRankNotNullViolation,
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

// Chunked rank writes, shared by the union reorder and by
// packingLocations.remove()'s dense fallback. The row mapping travels as ONE
// JSON parameter unpacked by json_each(): a UNION ALL of per-row SELECTs
// tripped D1's compound-SELECT term limit well below the payload caps, and
// per-row bound params would fight the 100-param statement cap. Two or three
// params per statement regardless of chunk size.
//
// DRIFT DETECTION is per row: the SET subquery matches on (id, expected
// current rank) and yields NULL when the row has moved - and pack_sort_order
// is NOT NULL, so a drifted row ABORTS the whole batch instead of being
// silently skipped.
//
// `cohortMatch` is optional: the reorder pins one cohort for the whole
// statement; the location-delete fallback renumbers rows across TWO cohorts
// and instead pins each row's EXPECTED SOURCE COHORT inside the mapping (the
// entry's `loc`). Without that per-row assertion, an orphan concurrently
// moved to another bag while KEEPING its rank would still match on
// (id, rank) and be silently yanked back to Unassigned (GATE 2 round-5
// finding 3) - with it, the drifted row's subquery yields NULL and the NOT
// NULL rank column aborts the whole batch. `alsoUnassign` additionally
// clears packing_location_id, for the fallback's orphan settle.
const RANK_CHUNK = 100
export function chunkedRankWrites(opts: {
  db: Db
  tableName: 'list_items' | 'list_food_items'
  table: typeof listItems | typeof listFoodItems
  entries: { id: string; from: number; to: number; loc?: string | null }[]
  userId: string
  listId: string
  cohortMatch?: ReturnType<typeof sql>
  requireNotWorn: boolean
  alsoUnassign?: boolean
  touchUpdatedAt?: number
}) {
  const {
    db,
    tableName,
    table,
    entries,
    userId,
    listId,
    cohortMatch,
    requireNotWorn,
    alsoUnassign,
    touchUpdatedAt,
  } = opts
  const tbl = sql.raw(tableName)
  const statements = []
  const matchLocation = entries.some((e) => e.loc !== undefined)
  for (let i = 0; i < entries.length; i += RANK_CHUNK) {
    const chunk = JSON.stringify(entries.slice(i, i + RANK_CHUNK))
    const set: Record<string, unknown> = {
      packSortOrder: matchLocation
        ? sql`(select json_extract(je.value, '$.to') from json_each(${chunk}) as je where json_extract(je.value, '$.id') = ${tbl}.id and json_extract(je.value, '$.from') = ${tbl}.pack_sort_order and json_extract(je.value, '$.loc') is ${tbl}.packing_location_id)`
        : sql`(select json_extract(je.value, '$.to') from json_each(${chunk}) as je where json_extract(je.value, '$.id') = ${tbl}.id and json_extract(je.value, '$.from') = ${tbl}.pack_sort_order)`,
    }
    if (alsoUnassign) set.packingLocationId = null
    if (touchUpdatedAt !== undefined) set.updatedAt = touchUpdatedAt
    statements.push(
      db
        .update(table)
        .set(set)
        .where(
          sql`${tbl}.user_id = ${userId} and ${tbl}.list_id = ${listId}${
            requireNotWorn ? sql` and ${tbl}.is_worn = 0` : sql``
          }${cohortMatch ? sql` and ${cohortMatch}` : sql``} and ${tbl}.id in (select json_extract(value, '$.id') from json_each(${chunk}))`,
        ),
    )
  }
  return statements
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

      // INDEX-SAFETY validation, which is what the unique indexes actually
      // demand - the exact multiset-permutation rule this replaced was both
      // stricter and weaker than needed (GATE 2 round-4 finding 1):
      //
      //   * stricter: a permutation PRESERVES cross-table rank ties, so a
      //     cohort holding one (a degraded old-worker interval, or 0023's
      //     dense fallback) could never be healed by reordering - and some
      //     otherwise-valid drags deterministically 409ed when both tied
      //     rows landed in one table.
      //   * weaker than it looked: its real job was only ever to keep the
      //     settle writes off ranks that live rows outside the payload hold.
      //
      // So check THAT directly, per table: payload ranks must be unique
      // within their table's half, and must not equal the CURRENT rank of
      // any same-cohort row in the SAME table that the payload does not
      // touch (including worn gear, whose reserved slots must stay
      // reserved). A permutation always satisfies this; so does the dense
      // renumber the client sends when it detects ties - which is what
      // makes "the next reorder dissolves the tie" true.
      const validateHalf = (
        entries: { id: string; packSortOrder: number }[],
        cohortRows: { id: string; packSortOrder: number }[],
      ): boolean => {
        const payloadIds = new Set(entries.map((u) => u.id))
        const payloadRanks = new Set<number>()
        for (const u of entries) {
          if (payloadRanks.has(u.packSortOrder)) return false
          payloadRanks.add(u.packSortOrder)
        }
        for (const row of cohortRows) {
          if (payloadIds.has(row.id)) continue
          if (payloadRanks.has(row.packSortOrder)) return false
        }
        return true
      }
      const gearCohortRows = gearRows.filter(
        (r) => r.packingLocationId === cohort,
      )
      const foodCohortRows = foodRows.filter(
        (r) => r.packingLocationId === cohort,
      )
      if (
        !validateHalf(payload.items, gearCohortRows) ||
        !validateHalf(payload.foodItems, foodCohortRows)
      ) {
        return { ok: false, reason: 'not_a_permutation' }
      }

      // Park/settle per table, each inside its own scratch band (-300 wide
      // for gear, -200 for food - each exactly its cap, so the index always
      // fits). CHUNKED multi-row statements rather than one statement per
      // row: D1 counts every batch statement against its ~1000
      // queries-per-invocation ceiling, and the accepted payload allows 500
      // rows - per-row statements put a full-cohort reorder
      // deterministically over the limit (GATE 2 round-3 finding; also the
      // AGENTS.md trap about keeping batch statement counts low). At 20
      // rows per statement the worst case is ~54 statements.
      //
      // Each chunk still RE-ASSERTS what the pre-read saw, per row: the SET
      // subquery matches on (id, current rank) and yields NULL when a row
      // has drifted - and pack_sort_order is NOT NULL, so a drifted row
      // ABORTS the whole batch instead of being silently skipped. That is
      // per-row exactness on top of the census guards below. Identifiers
      // are hand-written throughout (the unqualified-rendering trap).
      const cohortMatch =
        cohort === null
          ? sql`packing_location_id is null`
          : sql`packing_location_id = ${cohort}`
      const scratch = (i: number) => -1 - i
      const writeOpts = { db, userId, listId, cohortMatch }
      const gearPark = chunkedRankWrites({
        ...writeOpts,
        tableName: 'list_items',
        table: listItems,
        entries: payload.items.map((u, i) => ({
          id: u.id,
          from: gearById.get(u.id)!.packSortOrder,
          to: scratch(i),
        })),
        requireNotWorn: true,
      })
      const foodPark = chunkedRankWrites({
        ...writeOpts,
        tableName: 'list_food_items',
        table: listFoodItems,
        entries: payload.foodItems.map((u, i) => ({
          id: u.id,
          from: foodById.get(u.id)!.packSortOrder,
          to: scratch(i),
        })),
        requireNotWorn: false,
      })

      // One fail-loud guard per table (each table's negative count is an
      // exact park census - see 0019/0022). Both run even when that table's
      // half of the payload is empty: count(*) = 0 still has to hold, and an
      // unconditional shape keeps the batch statement list deterministic.
      // Raw SQL rides insert builders because db.run(sql) typechecks as a
      // batch item and then crashes the D1 driver.
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

      const gearSettle = chunkedRankWrites({
        ...writeOpts,
        tableName: 'list_items',
        table: listItems,
        entries: payload.items.map((u, i) => ({
          id: u.id,
          from: scratch(i),
          to: u.packSortOrder,
        })),
        requireNotWorn: true,
      })
      const foodSettle = chunkedRankWrites({
        ...writeOpts,
        tableName: 'list_food_items',
        table: listFoodItems,
        entries: payload.foodItems.map((u, i) => ({
          id: u.id,
          from: scratch(i),
          to: u.packSortOrder,
        })),
        requireNotWorn: false,
      })

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
        // Someone beat us, in one of four shapes: a concurrent reorder took
        // a rank first (unique violation on either table's cohort index), a
        // drifted row fed NULL into its NOT NULL rank column inside a chunk,
        // or one of the guards counted a missing park (NOT NULL violation on
        // that guard's `ok`). All rolled the whole batch back; the
        // client refetches and retries.
        if (
          isAnyUniqueViolation(err) ||
          isPackGuardViolation(err) ||
          isFoodPackGuardViolation(err) ||
          isPackRankNotNullViolation(err)
        ) {
          return { ok: false, reason: 'conflict' }
        }
        throw err
      }
      return { ok: true }
    },
  }
}
