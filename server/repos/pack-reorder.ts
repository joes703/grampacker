import { and, eq, isNull, sql } from 'drizzle-orm'
import type { ReorderPackPayload } from '../../shared/lists'
import type { SQL } from 'drizzle-orm'
import type { Db, Tx } from '../db'
import { listFoodItems, listItems } from '../db/schema'

// The ONE implementation of "permute a packing cohort safely", shared by both
// packable tables.
//
// A COHORT is a UNION: the list_items rows and the list_food_items rows
// sharing (list_id, packing_location_id), displayed merged by
// (pack_sort_order, gear-before-food, id). A reorder payload rearranges ranks
// across the whole union - moving a food row between two gear rows hands the
// food row a rank a gear row held and vice versa - so validation reasons per
// table HALF (index safety: no duplicate within a half, no landing on an
// untouched same-table row), not about a permutation of the union multiset.
// See rule 4 in reorder() below.
//
// Each table keeps its own unique cohort index, so uniqueness is enforced
// WITHIN a table only. A cross-table duplicate cannot corrupt anything: it
// displays by the deterministic tiebreak and dissolves on the next reorder,
// which rewrites the union densely.
//
// The whole read, validation and write sequence runs in ONE immediate SQLite
// transaction on the process's only connection, so no other write can land
// between the read and the writes. That is why the D1-era defenses are gone:
// the guard-table census and the NULL-on-drift rank assertions existed only
// because a D1 batch could not read and could not branch, and a concurrent
// request could move rows between the pre-read and the batch. Neither can
// happen here, so the 409 they produced for a lost race cannot occur.

export type PackReorderResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'cross_cohort'
        | 'not_a_permutation'
        | 'worn_row'
    }

// The next rank an ARRIVAL takes in a cohort: one past the UNION maximum.
// Cohort-scoped for the 0018 reasons; union-scoped because a bag's contents
// are the union, and a per-table maximum would land a new gear row visually
// ABOVE food already sitting at higher ranks in the same bag.
//
// Worn rows are counted. They render outside the packing tree but keep their
// rank reserved, so excluding them would let an arrival land on a slot a
// worn row will come back to.
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

// Moves one pack row to rank `to`, inside a transaction. The WHERE names the
// row's expected cohort (and, for gear, that it is not worn), and exactly one
// row must change: anything else means the plan was computed from a state that
// does not exist, and throwing rolls the whole transaction back rather than
// leaving a half-applied reorder.
export function movePackRank(
  tx: Tx,
  opts: {
    kind: 'gear' | 'food'
    id: string
    userId: string
    listId: string
    // The cohort the row must be in when it moves.
    from: string | null
    to: number
    requireNotWorn?: boolean
    // Also move the row to Unassigned and bump updatedAt (location delete).
    unassignAt?: number
  },
): void {
  const { kind, id, userId, listId, from, to, requireNotWorn, unassignAt } = opts
  const set = {
    packSortOrder: to,
    ...(unassignAt === undefined ? {} : { packingLocationId: null, updatedAt: unassignAt }),
  }
  const changes =
    kind === 'gear'
      ? tx
          .update(listItems)
          .set(set)
          .where(
            and(
              eq(listItems.id, id),
              eq(listItems.listId, listId),
              eq(listItems.userId, userId),
              from === null
                ? isNull(listItems.packingLocationId)
                : eq(listItems.packingLocationId, from),
              requireNotWorn ? eq(listItems.isWorn, false) : undefined,
            ),
          )
          .run().changes
      : tx
          .update(listFoodItems)
          .set(set)
          .where(
            and(
              eq(listFoodItems.id, id),
              eq(listFoodItems.listId, listId),
              eq(listFoodItems.userId, userId),
              from === null
                ? isNull(listFoodItems.packingLocationId)
                : eq(listFoodItems.packingLocationId, from),
            ),
          )
          .run().changes
  if (changes !== 1) {
    throw new Error(`pack rank move matched ${changes} rows, expected 1`)
  }
}

export function createPackReorderRepo(db: Db, userId: string) {
  return {
    // packSortOrder ONLY - reorders must not bump updatedAt (product rule).
    //
    // Validation, matching what the gear-only implementation enforced:
    //   1. every id owned by this user on this list (else not_found)
    //   2. worn gear rows rejected (they render outside the packing tree)
    //   3. the whole payload inside ONE cohort, across both tables
    //   4. incoming ranks INDEX-SAFE against the union's current ranks: no
    //      rank duplicated within a table half, and none landing on an
    //      untouched row of the same table. A free rank is legal - this is
    //      deliberately weaker than the permutation rule the gear-only
    //      implementation enforced, so a payload can heal a degraded cohort
    //      (docs/authz-matrix.md, the pack-order row)
    async reorder(
      listId: string,
      payload: ReorderPackPayload,
    ): Promise<PackReorderResult> {
      // A unique-index failure here would mean validation rule 4 and the
      // index disagree: a defect, answered 500, with the transaction rolled
      // back.
      return db.transaction(
        (tx) => reorderInTransaction(tx, userId, listId, payload),
        { behavior: 'immediate' },
      )
    },
  }
}

function reorderInTransaction(
  tx: Tx,
  userId: string,
  listId: string,
  payload: ReorderPackPayload,
): PackReorderResult {
  // Both cohort scans, inside the transaction, so validation and writes see
  // one state. Owned-set membership rather than a query per id; the per-list
  // caps bound the scans.
  const gearRows = tx
    .select({
      id: listItems.id,
      packingLocationId: listItems.packingLocationId,
      packSortOrder: listItems.packSortOrder,
      isWorn: listItems.isWorn,
    })
    .from(listItems)
    .where(and(eq(listItems.listId, listId), eq(listItems.userId, userId)))
    .all()
  const foodRows = tx
    .select({
      id: listFoodItems.id,
      packingLocationId: listFoodItems.packingLocationId,
      packSortOrder: listFoodItems.packSortOrder,
    })
    .from(listFoodItems)
    .where(
      and(eq(listFoodItems.listId, listId), eq(listFoodItems.userId, userId)),
    )
    .all()
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
  // demand. An exact multiset-permutation rule was both stricter and weaker
  // than needed:
  //
  //   * stricter: a permutation PRESERVES cross-table rank ties, so a
  //     cohort holding one (a degraded old interval, or 0023's dense
  //     fallback) could never be healed by reordering - and some
  //     otherwise-valid drags deterministically failed when both tied
  //     rows landed in one table.
  //   * weaker than it looked: its real job was only ever to keep the
  //     settle writes off ranks that live rows outside the payload hold.
  //
  // So check THAT directly, per table: payload ranks must be unique
  // within their table's half, and must not equal the CURRENT rank of
  // any same-cohort row in the SAME table that the payload does not
  // touch (including worn gear, whose reserved slots must stay
  // reserved). A permutation of the union's ranks satisfies this unless
  // the union already holds a cross-table tie (a permutation could then
  // hand both copies to one table, which its index would reject); the
  // dense renumber the client sends when it detects ties satisfies it
  // outright - which is what makes "the next reorder dissolves the tie"
  // true.
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
  const gearCohortRows = gearRows.filter((r) => r.packingLocationId === cohort)
  const foodCohortRows = foodRows.filter((r) => r.packingLocationId === cohort)
  if (
    !validateHalf(payload.items, gearCohortRows) ||
    !validateHalf(payload.foodItems, foodCohortRows)
  ) {
    return { ok: false, reason: 'not_a_permutation' }
  }

  // Two phases, because SQLite checks the unique cohort index after EACH
  // statement: moving row A onto the rank row B still holds would fail even
  // though B is about to move. So every payload row first PARKS on its own
  // negative scratch rank (-1, -2, ... - each table's band is its per-list
  // cap wide, within migration 0019's range), then SETTLES on its target.
  const scratch = (i: number) => -1 - i
  const common = { userId, listId, from: cohort }
  payload.items.forEach((u, i) =>
    movePackRank(tx, { ...common, kind: 'gear', id: u.id, to: scratch(i), requireNotWorn: true }),
  )
  payload.foodItems.forEach((u, i) =>
    movePackRank(tx, { ...common, kind: 'food', id: u.id, to: scratch(i) }),
  )
  for (const u of payload.items) {
    movePackRank(tx, { ...common, kind: 'gear', id: u.id, to: u.packSortOrder, requireNotWorn: true })
  }
  for (const u of payload.foodItems) {
    movePackRank(tx, { ...common, kind: 'food', id: u.id, to: u.packSortOrder })
  }
  return { ok: true }
}
