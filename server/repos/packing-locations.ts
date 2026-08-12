import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Db } from '../db'
import {
  gearItems,
  listFoodItems,
  listItems,
  lists,
  packingLocations,
  packReorderGuard,
} from '../db/schema'
import {
  isAnyUniqueViolation,
  isForeignKeyViolation,
  isPackGuardViolation,
  isPackRankNotNullViolation,
  isPackRankRangeError,
  isTriggerAbort,
  isUniqueViolation,
} from './db-errors'
import { PACK_RANK_MAX } from '../../shared/lists'
import { chunkedRankWrites, unionOrder } from './pack-reorder'

const containerItems = alias(listItems, 'container_items')
const containerGear = alias(gearItems, 'container_gear')
const PACKING_LOCATION_NAME_MAX_LENGTH = 60

const cols = {
  id: packingLocations.id,
  name: sql<string>`coalesce(${containerGear.name}, ${packingLocations.name})`,
  sortOrder: packingLocations.sortOrder,
  containerListItemId: packingLocations.containerListItemId,
}

export type PackingLocationRow = {
  id: string
  name: string
  sortOrder: number
  containerListItemId: string | null
}

export type CreatePackingLocationResult =
  | { ok: true; row: PackingLocationRow }
  | {
      ok: false
      reason:
        | 'list_not_found'
        | 'invalid_container_item'
        | 'already_container'
        | 'cap_exceeded'
    }

export type RenamePackingLocationResult =
  | { ok: true; row: PackingLocationRow }
  | { ok: false; reason: 'not_found' | 'item_backed' }

export function isPackingLocationCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'packing location cap exceeded')
}

export function createPackingLocationsRepo(db: Db, userId: string) {
  async function ownsList(listId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
      .limit(1)
    return Boolean(row)
  }

  // The builder, not the awaited result, so create/rename can put the
  // read-back INSIDE the same db.batch as their write. Both used to write and
  // then read in a second round trip, which meant a read-back that threw
  // reported failure over a row that had already committed. Names are NOT
  // unique here, so retrying a "failed" create silently makes a SECOND bag
  // with the same name - the one case that does refuse is promoting gear,
  // which answers "Item is already a container" for the container you were
  // told had not been made.
  //
  // One batch is one D1 transaction, so a statement that fails rolls the
  // sequence back. That covers the read-back failing, which is the case this
  // addresses; a transport failure after the commit lands is still ambiguous
  // and no amount of batching fixes that.
  function ownedListQuery(listId: string) {
    return db
      .select(cols)
      .from(packingLocations)
      .leftJoin(
        containerItems,
        and(
          eq(packingLocations.containerListItemId, containerItems.id),
          eq(packingLocations.listId, containerItems.listId),
          eq(packingLocations.userId, containerItems.userId),
        ),
      )
      .leftJoin(
        containerGear,
        and(
          eq(containerItems.gearItemId, containerGear.id),
          eq(containerItems.userId, containerGear.userId),
        ),
      )
      .where(
        and(
          eq(packingLocations.listId, listId),
          eq(packingLocations.userId, userId),
        ),
      )
      .orderBy(asc(packingLocations.sortOrder), asc(cols.name))
  }

  function readOwnedList(listId: string): Promise<PackingLocationRow[]> {
    return ownedListQuery(listId)
  }

  return {
    // null means the list is not the caller's; [] is an owned, unorganized
    // list. Both states are significant to the Pack Mode grouping switch.
    async forList(listId: string): Promise<PackingLocationRow[] | null> {
      if (!(await ownsList(listId))) return null
      return readOwnedList(listId)
    },

    async create(
      listId: string,
      input: { name: string } | { containerListItemId: string },
    ): Promise<CreatePackingLocationResult> {
      if (!(await ownsList(listId))) {
        return { ok: false, reason: 'list_not_found' }
      }
      let name: string
      let containerListItemId: string | null = null
      if ('containerListItemId' in input) {
        const [source] = await db
          .select({ name: gearItems.name })
          .from(listItems)
          .innerJoin(
            gearItems,
            and(
              eq(listItems.gearItemId, gearItems.id),
              eq(listItems.userId, gearItems.userId),
            ),
          )
          .where(
            and(
              eq(listItems.id, input.containerListItemId),
              eq(listItems.listId, listId),
              eq(listItems.userId, userId),
            ),
          )
          .limit(1)
        if (!source) return { ok: false, reason: 'invalid_container_item' }
        // The live read joins back to the gear row, so this stored value is
        // only a fallback snapshot. Keep it within packing_locations' tighter
        // CHECK constraint even though gear names may be up to 256 characters.
        name = source.name.slice(0, PACKING_LOCATION_NAME_MAX_LENGTH)
        containerListItemId = input.containerListItemId
      } else {
        name = input.name
      }
      try {
        const now = Date.now()
        const insertLocation = db
          .insert(packingLocations)
          .values({
            id: crypto.randomUUID(),
            userId,
            listId,
            name,
            containerListItemId,
            // Hand-alias the subquery: drizzle renders interpolated columns
            // unqualified in single-table statements, which can silently turn
            // a correlation into a tautology. Named locations append; promoted
            // gear containers prepend so they appear directly after the fixed
            // Unassigned section instead of jumping to the bottom.
            sortOrder: containerListItemId === null
              ? sql`coalesce((select max(pl.sort_order) + 1 from packing_locations pl where pl.list_id = ${listId} and pl.user_id = ${userId}), 0)`
              : sql`coalesce((select min(pl.sort_order) - 1 from packing_locations pl where pl.list_id = ${listId} and pl.user_id = ${userId}), 0)`,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: packingLocations.id })
        // Insert and read-back in ONE batch. Statements run in order inside the
        // transaction, so the select sees the row the insert just wrote.
        const [insertedRows, rows] = await db.batch([
          insertLocation,
          ownedListQuery(listId),
        ])
        const [inserted] = insertedRows
        if (!inserted) throw new Error('packing location insert returned no row')
        const row = rows.find((candidate) => candidate.id === inserted.id)
        if (!row) throw new Error('packing location insert could not be read')
        return { ok: true, row }
      } catch (err) {
        if (isPackingLocationCapError(err)) {
          return { ok: false, reason: 'cap_exceeded' }
        }
        if (isUniqueViolation(err, 'packing_locations.container_list_item_id')) {
          return { ok: false, reason: 'already_container' }
        }
        if (isTriggerAbort(err, 'container item does not belong to this list')) {
          return { ok: false, reason: 'invalid_container_item' }
        }
        if (isForeignKeyViolation(err)) {
          return { ok: false, reason: 'invalid_container_item' }
        }
        throw err
      }
    },

    async rename(
      listId: string,
      id: string,
      name: string,
    ): Promise<RenamePackingLocationResult> {
      const [existing] = await db
        .select({ containerListItemId: packingLocations.containerListItemId })
        .from(packingLocations)
        .where(
          and(
            eq(packingLocations.id, id),
            eq(packingLocations.listId, listId),
            eq(packingLocations.userId, userId),
          ),
        )
        .limit(1)
      if (!existing) return { ok: false, reason: 'not_found' }
      if (existing.containerListItemId !== null) {
        return { ok: false, reason: 'item_backed' }
      }
      const renameLocation = db
        .update(packingLocations)
        .set({ name, updatedAt: Date.now() })
        .where(
          and(
            eq(packingLocations.id, id),
            eq(packingLocations.listId, listId),
            eq(packingLocations.userId, userId),
          ),
        )
        .returning({ id: packingLocations.id })
      // Update and read-back in ONE batch, for the reason on ownedListQuery.
      const [renamedRows, rows] = await db.batch([
        renameLocation,
        ownedListQuery(listId),
      ])
      const [row] = renamedRows
      // The UPDATE matched nothing, so nothing committed and not_found is the
      // honest answer. It is reachable: the row can be deleted between the
      // pre-read above and this write.
      if (!row) return { ok: false, reason: 'not_found' }
      const updated = rows.find((candidate) => candidate.id === id)
      // Unreachable now that both statements share a transaction - the select
      // ran after the update that just returned this id. It used to return
      // not_found here, which would have reported failure over a committed
      // rename; if it somehow happens, a 500 is the truthful answer.
      if (!updated) throw new Error('packing location rename could not be read')
      return { ok: true, row: updated }
    },

    // Explicitly unassign before deleting. Every statement is scoped through
    // the owned parent and they run in one D1 transaction; success comes from
    // the DELETE RETURNING row so an empty location still returns true.
    //
    // The orphans are RE-RANKED, not just unassigned. packSortOrder is a rank
    // within a cohort - the rows sharing (list_id, packing_location_id) - so
    // carrying old ranks across into Unassigned would interleave this
    // location's contents with whatever is already there, by numbers that
    // encode old cross-location accidents rather than anything the user
    // arranged. Worse, those numbers would frequently COLLIDE with existing
    // Unassigned ranks and the unique index would reject the whole delete.
    //
    // So they land as one contiguous block at the end of Unassigned, keeping
    // their order relative to each other: the bag disappears, its contents
    // stay together and stay in the order you put them in.
    async remove(
      listId: string,
      id: string,
    ): Promise<'deleted' | 'not_found' | 'pack_rank_exhausted' | 'conflict'> {
      // Read BOTH halves of the bag - the cohort is a union since 0022 - in
      // one batch so the interleaved order is a consistent snapshot. Ordering
      // the read is what makes "keep their relative order" true rather than
      // incidental.
      const [gearOrphans, foodOrphans, gearMaxRows, foodMaxRows] =
        await db.batch([
          db
            .select({
              id: listItems.id,
              packSortOrder: listItems.packSortOrder,
            })
            .from(listItems)
            .where(
              and(
                eq(listItems.packingLocationId, id),
                eq(listItems.listId, listId),
                eq(listItems.userId, userId),
              ),
            )
            .orderBy(asc(listItems.packSortOrder), asc(listItems.id)),
          db
            .select({
              id: listFoodItems.id,
              packSortOrder: listFoodItems.packSortOrder,
            })
            .from(listFoodItems)
            .where(
              and(
                eq(listFoodItems.packingLocationId, id),
                eq(listFoodItems.listId, listId),
                eq(listFoodItems.userId, userId),
              ),
            )
            .orderBy(asc(listFoodItems.packSortOrder), asc(listFoodItems.id)),
          // The Unassigned cohort's per-table maxima, in the SAME batch as
          // the orphan reads so base is computed from the snapshot the
          // reassignments will land on. Worn rows count: they render outside
          // the packing tree but keep their slot reserved, so ignoring them
          // would drop an orphan onto a rank a worn row owns.
          db
            .select({
              max: sql<number | null>`max(${listItems.packSortOrder})`,
            })
            .from(listItems)
            .where(
              and(
                eq(listItems.listId, listId),
                eq(listItems.userId, userId),
                isNull(listItems.packingLocationId),
              ),
            ),
          db
            .select({
              max: sql<number | null>`max(${listFoodItems.packSortOrder})`,
            })
            .from(listFoodItems)
            .where(
              and(
                eq(listFoodItems.listId, listId),
                eq(listFoodItems.userId, userId),
                isNull(listFoodItems.packingLocationId),
              ),
            ),
        ])
      // The bag's contents in display order, so the block that lands at the
      // end of Unassigned reads exactly as the bag did - food interleaved
      // where it was, not sorted to the back.
      const orphans = unionOrder(gearOrphans, foodOrphans)

      // One past the Unassigned cohort's UNION maximum (the bag's contents
      // are the union since 0022).
      const base =
        Math.max(gearMaxRows[0]?.max ?? -1, foodMaxRows[0]?.max ?? -1) + 1

      const now = Date.now()

      // DENSE FALLBACK (GATE 2 round-4 finding 2). The append below claims
      // base + i for each orphan, and a legacy Unassigned cohort may legally
      // sit as high as 0019's floor - the old 300-rank reserve budgeted
      // gear-only appends, and the union can move up to 500 rows. When the
      // append would step past PACK_RANK_MAX, renumber the ENTIRE merged
      // cohort (Unassigned block first, then the bag's block, both in union
      // display order) densely from 0 instead of failing the delete forever.
      // Two-phase park/settle via the shared chunked writer: dense
      // renumbering moves rows DOWN, and per-statement uniqueness would
      // collide mid-chunk without the park. Worn gear rows are included -
      // this is an administrative renumber of the whole cohort, and skipping
      // them would land a settle on a reserved slot.
      if (base + orphans.length - 1 > PACK_RANK_MAX && orphans.length > 0) {
        const [unassignedGear, unassignedFood] = await db.batch([
          db
            .select({ id: listItems.id, packSortOrder: listItems.packSortOrder })
            .from(listItems)
            .where(
              and(
                eq(listItems.listId, listId),
                eq(listItems.userId, userId),
                isNull(listItems.packingLocationId),
              ),
            )
            .orderBy(asc(listItems.packSortOrder), asc(listItems.id)),
          db
            .select({
              id: listFoodItems.id,
              packSortOrder: listFoodItems.packSortOrder,
            })
            .from(listFoodItems)
            .where(
              and(
                eq(listFoodItems.listId, listId),
                eq(listFoodItems.userId, userId),
                isNull(listFoodItems.packingLocationId),
              ),
            )
            .orderBy(asc(listFoodItems.packSortOrder), asc(listFoodItems.id)),
        ])
        const merged = [
          ...unionOrder(unassignedGear, unassignedFood).map((row) => ({
            ...row,
            orphan: false,
          })),
          ...orphans.map((row) => ({ ...row, orphan: true })),
        ]
        // Per-table scratch sequences; per-list caps bound both bands.
        let gearSeq = 0
        let foodSeq = 0
        type Entry = { id: string; from: number; to: number }
        const parks = { gear: [] as Entry[], food: [] as Entry[] }
        const settles = {
          gear: [] as Entry[],
          food: [] as Entry[],
          orphanGear: [] as Entry[],
          orphanFood: [] as Entry[],
        }
        merged.forEach((row, dense) => {
          const scratch = row.kind === 'gear' ? -1 - gearSeq++ : -1 - foodSeq++
          // `loc` pins each row's expected SOURCE cohort in the mapping: an
          // orphan concurrently moved to a third bag (possibly keeping its
          // rank) must abort the batch, not be yanked back to Unassigned.
          const sourceLoc = row.orphan ? id : null
          const park = {
            id: row.row.id,
            from: row.row.packSortOrder,
            to: scratch,
            loc: sourceLoc,
          }
          // Parked rows still sit in their source cohort (parking changes
          // only the rank), so the settle asserts the same loc.
          const settle = { id: row.row.id, from: scratch, to: dense, loc: sourceLoc }
          if (row.kind === 'gear') {
            parks.gear.push(park)
            ;(row.orphan ? settles.orphanGear : settles.gear).push(settle)
          } else {
            parks.food.push(park)
            ;(row.orphan ? settles.orphanFood : settles.food).push(settle)
          }
        })
        const writeOpts = { db, userId, listId, requireNotWorn: false }
        const statements = [
          ...chunkedRankWrites({ ...writeOpts, tableName: 'list_items', table: listItems, entries: parks.gear }),
          ...chunkedRankWrites({ ...writeOpts, tableName: 'list_food_items', table: listFoodItems, entries: parks.food }),
          ...chunkedRankWrites({ ...writeOpts, tableName: 'list_items', table: listItems, entries: settles.gear }),
          ...chunkedRankWrites({ ...writeOpts, tableName: 'list_food_items', table: listFoodItems, entries: settles.food }),
          // Orphan settles also unassign and bump updatedAt - they are the
          // rows actually leaving the deleted bag.
          ...chunkedRankWrites({ ...writeOpts, tableName: 'list_items', table: listItems, entries: settles.orphanGear, alsoUnassign: true, touchUpdatedAt: now }),
          ...chunkedRankWrites({ ...writeOpts, tableName: 'list_food_items', table: listFoodItems, entries: settles.orphanFood, alsoUnassign: true, touchUpdatedAt: now }),
          // The same fail-loud census as the append path (round-9): the
          // per-row park/settle assertions catch drift among rows the
          // pre-read SAW, but a row ARRIVING in the doomed bag after it is
          // unmapped and would fall to the cascade triggers' silent-order
          // salvage. Zero rows of either table may remain once the settles
          // have run, or the whole batch aborts into the retryable 409.
          db.insert(packReorderGuard).select(
            sql`select ${listId}, (select case when
                  (select count(*) from list_items
                    where list_id = ${listId} and user_id = ${userId}
                      and packing_location_id = ${id})
                  + (select count(*) from list_food_items
                      where list_id = ${listId} and user_id = ${userId}
                        and packing_location_id = ${id})
                  = 0 then 1 end)`,
          ),
          db.delete(packReorderGuard).where(eq(packReorderGuard.listId, listId)),
          db
            .delete(packingLocations)
            .where(
              and(
                eq(packingLocations.id, id),
                eq(packingLocations.listId, listId),
                eq(packingLocations.userId, userId),
              ),
            )
            .returning({ id: packingLocations.id }),
        ]
        const [firstStmt, ...restStmts] = statements
        if (!firstStmt) return 'not_found' // unreachable: delete is present
        let denseResults
        try {
          denseResults = await db.batch([firstStmt, ...restStmts])
        } catch (err) {
          // A drifted row fed NULL into its NOT NULL rank column, a settle
          // lost a rank race, or the census counted a late arrival. Known,
          // retryable, and the whole batch rolled back - a 409, not a 500.
          if (
            isPackRankNotNullViolation(err) ||
            isAnyUniqueViolation(err) ||
            isPackGuardViolation(err)
          ) {
            return 'conflict'
          }
          throw err
        }
        const denseDeleted = denseResults[denseResults.length - 1] as { id: string }[]
        return denseDeleted.length > 0 ? 'deleted' : 'not_found'
      }
      // Appending, so no two-phase write is needed: every rank claimed here is
      // above every rank Unassigned currently holds. If a concurrent write
      // takes one first the unique index rejects the batch and the whole
      // delete rolls back, which is the outcome we want - a loud retry beats a
      // half-deleted bag.
      // Each reassign asserts the row is STILL IN THE DOOMED BAG at its
      // PRE-READ RANK (rounds 6-8: keyed on id alone, a row concurrently
      // moved to another bag was yanked back; keyed without the rank, a
      // concurrent in-bag reorder was overwritten with the stale pre-read
      // ordering - both with 204s all round). And a partial match is NOT
      // left to the cascade triggers: they preserve every row but would
      // interleave drifted rows in an order nobody chose, silently (round-8
      // finding). The census guard below makes any miss - drift OR a fresh
      // arrival after the pre-read - abort the whole batch into the
      // retryable 409 instead.
      const reassign = orphans.map((orphan, i) =>
        orphan.kind === 'gear'
          ? db
              .update(listItems)
              .set({
                packingLocationId: null,
                packSortOrder: base + i,
                updatedAt: now,
              })
              .where(
                and(
                  eq(listItems.id, orphan.row.id),
                  eq(listItems.listId, listId),
                  eq(listItems.userId, userId),
                  eq(listItems.packingLocationId, id),
                  eq(listItems.packSortOrder, orphan.row.packSortOrder),
                ),
              )
          : db
              .update(listFoodItems)
              .set({
                packingLocationId: null,
                packSortOrder: base + i,
                updatedAt: now,
              })
              .where(
                and(
                  eq(listFoodItems.id, orphan.row.id),
                  eq(listFoodItems.listId, listId),
                  eq(listFoodItems.userId, userId),
                  eq(listFoodItems.packingLocationId, id),
                  eq(listFoodItems.packSortOrder, orphan.row.packSortOrder),
                ),
              ),
      )
      // FAIL-LOUD CENSUS, the reorder guard's mechanism reused: after every
      // reassign has run, ZERO rows of either table may remain in the doomed
      // bag - a leftover means a reassign missed (concurrent reorder, move,
      // or arrival) and the pre-read plan is stale. A batch statement cannot
      // branch, so the abort is a NULL fed into the guard's NOT NULL `ok`
      // column, rolling the whole batch back; the route answers 409 and the
      // client retries against fresh state. Guard rows never outlive their
      // batch (D1 serializes batches and the cleanup below runs in this
      // one), so sharing _pack_reorder_guard with reorderPack cannot
      // collide. Identifiers hand-written; raw SQL rides an insert builder
      // (db.run crashes the D1 driver as a batch item).
      const census = db.insert(packReorderGuard).select(
        sql`select ${listId}, (select case when
              (select count(*) from list_items
                where list_id = ${listId} and user_id = ${userId}
                  and packing_location_id = ${id})
              + (select count(*) from list_food_items
                  where list_id = ${listId} and user_id = ${userId}
                    and packing_location_id = ${id})
              = 0 then 1 end)`,
      )
      const censusCleanup = db
        .delete(packReorderGuard)
        .where(eq(packReorderGuard.listId, listId))

      const remove = db
        .delete(packingLocations)
        .where(
          and(
            eq(packingLocations.id, id),
            eq(packingLocations.listId, listId),
            eq(packingLocations.userId, userId),
          ),
        )
        .returning({ id: packingLocations.id })
      // The DELETE goes last so the reassignments are computed and applied
      // while the relationship still resolves. Anything the read missed (an
      // item added to this location between the read and the batch) still
      // falls to Unassigned via the FK's SET NULL - keeping its old rank, and
      // failing the unique index if that rank is taken, which again rolls the
      // whole thing back rather than corrupting the cohort.
      const [first, ...rest] = [...reassign, census, censusCleanup, remove]
      if (!first) return 'not_found' // unreachable: `remove` is always present
      let results
      try {
        results = await db.batch([first, ...rest])
      } catch (err) {
        // `base + i` can step past PACK_RANK_MAX when the destination cohort
        // is near the ceiling. Migration 0019 normalizes any legacy cohort
        // without LIST_ITEM_CAP ranks of headroom, so reaching this needs
        // roughly a billion arrivals - but an unclassified abort here would be
        // a 500 on an ordinary delete, and the condition is understood.
        if (isPackRankRangeError(err)) return 'pack_rank_exhausted'
        // A concurrent arrival claimed base+i first (unique index), or the
        // census counted a row the reassigns missed (guard NOT NULL). Either
        // way the whole batch rolled back. Retryable, so a 409 rather than a
        // 500 (rounds 7-8).
        if (isAnyUniqueViolation(err) || isPackGuardViolation(err)) {
          return 'conflict'
        }
        throw err
      }
      const deleted = results[results.length - 1] as { id: string }[]
      return deleted.length > 0 ? 'deleted' : 'not_found'
    },

    async reorder(
      listId: string,
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      const ownedRows = await db
        .select({ id: packingLocations.id })
        .from(packingLocations)
        .where(
          and(
            eq(packingLocations.listId, listId),
            eq(packingLocations.userId, userId),
          ),
        )
      const owned = new Set(ownedRows.map((row) => row.id))
      if (!updates.every((update) => owned.has(update.id))) return false
      const [first, ...rest] = updates.map((update) =>
        db
          .update(packingLocations)
          .set({ sortOrder: update.sortOrder })
          .where(
            and(
              eq(packingLocations.id, update.id),
              eq(packingLocations.listId, listId),
              eq(packingLocations.userId, userId),
            ),
          ),
      )
      if (!first) return true
      await db.batch([first, ...rest])
      return true
    },
  }
}
