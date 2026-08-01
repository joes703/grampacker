import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Db } from '../db'
import { gearItems, listItems, lists, packingLocations } from '../db/schema'
import {
  isForeignKeyViolation,
  isPackRankRangeError,
  isTriggerAbort,
  isUniqueViolation,
} from './db-errors'

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

  function readOwnedList(listId: string): Promise<PackingLocationRow[]> {
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
        const [inserted] = await db
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
        if (!inserted) throw new Error('packing location insert returned no row')
        const rows = await readOwnedList(listId)
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
      const [row] = await db
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
      if (!row) return { ok: false, reason: 'not_found' }
      const rows = await readOwnedList(listId)
      const updated = rows.find((candidate) => candidate.id === id)
      if (!updated) return { ok: false, reason: 'not_found' }
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
    ): Promise<'deleted' | 'not_found' | 'pack_rank_exhausted'> {
      // Read the orphans in their current pack order. Ordering the read is
      // what makes "keep their relative order" true rather than incidental.
      const orphans = await db
        .select({ id: listItems.id })
        .from(listItems)
        .where(
          and(
            eq(listItems.packingLocationId, id),
            eq(listItems.listId, listId),
            eq(listItems.userId, userId),
          ),
        )
        .orderBy(asc(listItems.packSortOrder), asc(listItems.id))

      // One past the Unassigned cohort's current maximum. Worn rows count:
      // they render outside the packing tree but keep their slot reserved, so
      // ignoring them here would drop an orphan onto a rank a worn row owns.
      const [maxRow] = await db
        .select({ max: sql<number | null>`max(${listItems.packSortOrder})` })
        .from(listItems)
        .where(
          and(
            eq(listItems.listId, listId),
            eq(listItems.userId, userId),
            isNull(listItems.packingLocationId),
          ),
        )
      const base = (maxRow?.max ?? -1) + 1

      const now = Date.now()
      // Appending, so no two-phase write is needed: every rank claimed here is
      // above every rank Unassigned currently holds. If a concurrent write
      // takes one first the unique index rejects the batch and the whole
      // delete rolls back, which is the outcome we want - a loud retry beats a
      // half-deleted bag.
      const reassign = orphans.map((orphan, i) =>
        db
          .update(listItems)
          .set({
            packingLocationId: null,
            packSortOrder: base + i,
            updatedAt: now,
          })
          .where(
            and(
              eq(listItems.id, orphan.id),
              eq(listItems.listId, listId),
              eq(listItems.userId, userId),
            ),
          ),
      )
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
      const [first, ...rest] = [...reassign, remove]
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
