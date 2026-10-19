import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { reorderOwnedSet } from './reorder'
import { ownsList } from './owns-list'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Db, Tx } from '../db'
import {
  gearItems,
  listFoodItems,
  listItems,
  packingLocations,
} from '../db/schema'
import {
  isPackRankUniqueViolation,
  isPackRankRangeError,
  isTriggerAbort,
  isUniqueViolation,
} from './db-errors'
import { PACK_RANK_MAX } from '../../shared/lists'
import { movePackRank, unionOrder } from './pack-reorder'

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

// Every method runs its whole read, validation and write sequence in ONE
// SQLite transaction on the process's only connection (immediate for writes,
// so the write lock is taken before the first read). Nothing can change
// between a method's checks and its writes, and any failure rolls back
// everything the method did.
export function createPackingLocationsRepo(db: Db, userId: string) {
  // The list's locations in display order. create and rename read it back
  // inside their own transaction, so the row they return is the row that
  // committed.
  function ownedList(tx: Tx, listId: string): PackingLocationRow[] {
    return tx
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
      .all()
  }

  return {
    // null means the list is not the caller's; [] is an owned, unorganized
    // list. Both states are significant to the Pack Mode grouping switch.
    async forList(listId: string): Promise<PackingLocationRow[] | null> {
      return db.transaction((tx) =>
        ownsList(tx, userId, listId) ? ownedList(tx, listId) : null,
      )
    },

    async create(
      listId: string,
      input: { name: string } | { containerListItemId: string },
    ): Promise<CreatePackingLocationResult> {
      try {
        return db.transaction(
          (tx): CreatePackingLocationResult => {
            if (!ownsList(tx, userId, listId)) {
              return { ok: false, reason: 'list_not_found' }
            }
            let name: string
            let containerListItemId: string | null = null
            if ('containerListItemId' in input) {
              const source = tx
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
                .get()
              if (!source) return { ok: false, reason: 'invalid_container_item' }
              // The live read joins back to the gear row, so this stored value
              // is only a fallback snapshot. Keep it within packing_locations'
              // tighter CHECK constraint even though gear names may be up to
              // 256 characters.
              name = source.name.slice(0, PACKING_LOCATION_NAME_MAX_LENGTH)
              containerListItemId = input.containerListItemId
            } else {
              name = input.name
            }
            const now = Date.now()
            const [inserted] = tx
              .insert(packingLocations)
              .values({
                id: crypto.randomUUID(),
                userId,
                listId,
                name,
                containerListItemId,
                // Hand-alias the subquery: drizzle renders interpolated columns
                // unqualified in single-table statements, which can silently
                // turn a correlation into a tautology. Named locations append;
                // promoted gear containers prepend so they appear directly
                // after the fixed Unassigned section instead of jumping to the
                // bottom.
                sortOrder: containerListItemId === null
                  ? sql`coalesce((select max(pl.sort_order) + 1 from packing_locations pl where pl.list_id = ${listId} and pl.user_id = ${userId}), 0)`
                  : sql`coalesce((select min(pl.sort_order) - 1 from packing_locations pl where pl.list_id = ${listId} and pl.user_id = ${userId}), 0)`,
                createdAt: now,
                updatedAt: now,
              })
              .returning({ id: packingLocations.id })
              .all()
            if (!inserted) throw new Error('packing location insert returned no row')
            // Read back in the same transaction: a read-back that throws takes
            // the insert down with it, so a "failed" create never leaves a bag
            // behind (names are not unique, so a retry would make a second one).
            const row = ownedList(tx, listId).find((r) => r.id === inserted.id)
            if (!row) throw new Error('packing location insert could not be read')
            return { ok: true, row }
          },
          { behavior: 'immediate' },
        )
      } catch (err) {
        // The database's own rules, still the final word inside the
        // transaction: the per-list cap trigger, one location per container
        // item, and the same-list trigger. A foreign-key failure is not
        // classified: the prechecks run in this same transaction, so it can
        // only be a defect - let it 500.
        if (isPackingLocationCapError(err)) {
          return { ok: false, reason: 'cap_exceeded' }
        }
        if (isUniqueViolation(err, 'packing_locations.container_list_item_id')) {
          return { ok: false, reason: 'already_container' }
        }
        if (isTriggerAbort(err, 'container item does not belong to this list')) {
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
      return db.transaction(
        (tx): RenamePackingLocationResult => {
          const where = and(
            eq(packingLocations.id, id),
            eq(packingLocations.listId, listId),
            eq(packingLocations.userId, userId),
          )
          const existing = tx
            .select({ containerListItemId: packingLocations.containerListItemId })
            .from(packingLocations)
            .where(where)
            .limit(1)
            .get()
          if (!existing) return { ok: false, reason: 'not_found' }
          if (existing.containerListItemId !== null) {
            return { ok: false, reason: 'item_backed' }
          }
          const changes = tx
            .update(packingLocations)
            .set({ name, updatedAt: Date.now() })
            .where(where)
            .run().changes
          // The row was read a moment ago in this same transaction.
          if (changes !== 1) throw new Error('packing location rename matched no row')
          const updated = ownedList(tx, listId).find((r) => r.id === id)
          if (!updated) throw new Error('packing location rename could not be read')
          return { ok: true, row: updated }
        },
        { behavior: 'immediate' },
      )
    },

    // Unassign everything in the bag, then delete it, in one transaction.
    // Every statement is scoped through the owned parent; success comes from
    // the DELETE RETURNING row so an empty location still counts as deleted.
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
      try {
        return db.transaction(
          (tx) => (removeInTransaction(tx, listId, id) ? 'deleted' : 'not_found'),
          { behavior: 'immediate' },
        )
      } catch (err) {
        // 0019's range triggers. The dense fallback below keeps the append
        // inside the rank space, so this should be unreachable; it stays
        // classified because a 500 on an ordinary delete would be a poor way
        // to find out otherwise.
        if (isPackRankRangeError(err)) return 'pack_rank_exhausted'
        // Not reachable through concurrency any more (nothing can change
        // between the reads and the writes). Kept as the route's documented
        // retryable answer should a PACK-RANK unique index ever disagree with
        // the plan. Any other constraint failure is a 500.
        if (isPackRankUniqueViolation(err)) return 'conflict'
        throw err
      }
    },

    async reorder(
      listId: string,
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      return db.transaction(
        (tx) =>
          reorderOwnedSet(
            tx,
            packingLocations,
            { id: packingLocations.id, sortOrder: packingLocations.sortOrder },
            [eq(packingLocations.listId, listId), eq(packingLocations.userId, userId)],
            updates,
          ),
        { behavior: 'immediate' },
      )
    },
  }

  // Returns whether the location existed (and is now deleted).
  function removeInTransaction(tx: Tx, listId: string, id: string): boolean {
    // Both halves of the bag - the cohort is a union since 0022 - in display
    // order, which is what makes "keep their relative order" true.
    const gearOrphans = tx
      .select({ id: listItems.id, packSortOrder: listItems.packSortOrder })
      .from(listItems)
      .where(
        and(
          eq(listItems.packingLocationId, id),
          eq(listItems.listId, listId),
          eq(listItems.userId, userId),
        ),
      )
      .orderBy(asc(listItems.packSortOrder), asc(listItems.id))
      .all()
    const foodOrphans = tx
      .select({ id: listFoodItems.id, packSortOrder: listFoodItems.packSortOrder })
      .from(listFoodItems)
      .where(
        and(
          eq(listFoodItems.packingLocationId, id),
          eq(listFoodItems.listId, listId),
          eq(listFoodItems.userId, userId),
        ),
      )
      .orderBy(asc(listFoodItems.packSortOrder), asc(listFoodItems.id))
      .all()
    const orphans = unionOrder(gearOrphans, foodOrphans)

    // The Unassigned cohort, both tables. Worn rows count: they render
    // outside the packing tree but keep their slot reserved, so ignoring them
    // would drop an orphan onto a rank a worn row owns.
    const unassignedGear = tx
      .select({ id: listItems.id, packSortOrder: listItems.packSortOrder })
      .from(listItems)
      .where(
        and(
          eq(listItems.listId, listId),
          eq(listItems.userId, userId),
          isNull(listItems.packingLocationId),
        ),
      )
      .orderBy(asc(listItems.packSortOrder), asc(listItems.id))
      .all()
    const unassignedFood = tx
      .select({ id: listFoodItems.id, packSortOrder: listFoodItems.packSortOrder })
      .from(listFoodItems)
      .where(
        and(
          eq(listFoodItems.listId, listId),
          eq(listFoodItems.userId, userId),
          isNull(listFoodItems.packingLocationId),
        ),
      )
      .orderBy(asc(listFoodItems.packSortOrder), asc(listFoodItems.id))
      .all()
    const unassigned = unionOrder(unassignedGear, unassignedFood)

    // One past the Unassigned cohort's UNION maximum.
    const base =
      Math.max(-1, ...unassigned.map((entry) => entry.row.packSortOrder)) + 1
    const now = Date.now()

    if (base + orphans.length - 1 > PACK_RANK_MAX && orphans.length > 0) {
      // DENSE FALLBACK. Appending would step past PACK_RANK_MAX (a legacy
      // Unassigned cohort may legally sit that high), so renumber the WHOLE
      // merged cohort densely from 0 instead: Unassigned first, then the
      // bag's contents, both in union display order. Two phases, because the
      // unique index is checked after each statement: every row parks on its
      // own negative scratch rank (one sequence per table), then settles.
      // Worn rows are included - this is an administrative renumber of the
      // whole cohort, and skipping them would land a settle on a reserved slot.
      const merged = [
        ...unassigned.map((entry) => ({ ...entry, orphan: false })),
        ...orphans.map((entry) => ({ ...entry, orphan: true })),
      ]
      let gearSeq = 0
      let foodSeq = 0
      const scratch = merged.map((entry) =>
        entry.kind === 'gear' ? -1 - gearSeq++ : -1 - foodSeq++,
      )
      merged.forEach((entry, i) =>
        movePackRank(tx, {
          kind: entry.kind,
          id: entry.row.id,
          userId,
          listId,
          from: entry.orphan ? id : null,
          to: scratch[i]!, // same length as merged
        }),
      )
      merged.forEach((entry, dense) =>
        movePackRank(tx, {
          kind: entry.kind,
          id: entry.row.id,
          userId,
          listId,
          from: entry.orphan ? id : null,
          to: dense,
          // Only the rows leaving the deleted bag are unassigned and touched.
          ...(entry.orphan ? { unassignAt: now } : {}),
        }),
      )
    } else {
      // Appending needs no parking: every rank claimed here is above every
      // rank Unassigned holds.
      orphans.forEach((entry, i) =>
        movePackRank(tx, {
          kind: entry.kind,
          id: entry.row.id,
          userId,
          listId,
          from: id,
          to: base + i,
          unassignAt: now,
        }),
      )
    }

    // The DELETE goes last, once the bag is empty, so the delete triggers'
    // own re-ranking finds nothing left to move.
    const deleted = tx
      .delete(packingLocations)
      .where(
        and(
          eq(packingLocations.id, id),
          eq(packingLocations.listId, listId),
          eq(packingLocations.userId, userId),
        ),
      )
      .returning({ id: packingLocations.id })
      .all()
    return deleted.length > 0
  }
}
