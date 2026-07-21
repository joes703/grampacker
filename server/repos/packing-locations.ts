import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { listItems, lists, packingLocations } from '../db/schema'
import { isTriggerAbort } from './db-errors'

const cols = {
  id: packingLocations.id,
  name: packingLocations.name,
  sortOrder: packingLocations.sortOrder,
}

export type PackingLocationRow = {
  id: string
  name: string
  sortOrder: number
}

export type CreatePackingLocationResult =
  | { ok: true; row: PackingLocationRow }
  | { ok: false; reason: 'list_not_found' | 'cap_exceeded' }

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

  return {
    // null means the list is not the caller's; [] is an owned, unorganized
    // list. Both states are significant to the Pack Mode grouping switch.
    async forList(listId: string): Promise<PackingLocationRow[] | null> {
      if (!(await ownsList(listId))) return null
      return db
        .select(cols)
        .from(packingLocations)
        .where(
          and(
            eq(packingLocations.listId, listId),
            eq(packingLocations.userId, userId),
          ),
        )
        .orderBy(asc(packingLocations.sortOrder), asc(packingLocations.name))
    },

    async create(
      listId: string,
      name: string,
    ): Promise<CreatePackingLocationResult> {
      if (!(await ownsList(listId))) {
        return { ok: false, reason: 'list_not_found' }
      }
      try {
        const now = Date.now()
        const [row] = await db
          .insert(packingLocations)
          .values({
            id: crypto.randomUUID(),
            userId,
            listId,
            name,
            // Hand-alias the subquery: drizzle renders interpolated columns
            // unqualified in single-table statements, which can silently turn
            // a correlation into a tautology.
            sortOrder: sql`coalesce((select max(pl.sort_order) + 1 from packing_locations pl where pl.list_id = ${listId} and pl.user_id = ${userId}), 0)`,
            createdAt: now,
            updatedAt: now,
          })
          .returning(cols)
        if (!row) throw new Error('packing location insert returned no row')
        return { ok: true, row }
      } catch (err) {
        if (isPackingLocationCapError(err)) {
          return { ok: false, reason: 'cap_exceeded' }
        }
        throw err
      }
    },

    async rename(
      listId: string,
      id: string,
      name: string,
    ): Promise<PackingLocationRow | null> {
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
        .returning(cols)
      return row ?? null
    },

    // Explicitly unassign before deleting. Both statements are scoped through
    // the owned parent and run in one D1 transaction; success comes from the
    // DELETE RETURNING row so an empty location still returns true.
    async remove(listId: string, id: string): Promise<boolean> {
      const unassign = db
        .update(listItems)
        .set({ packingLocationId: null, updatedAt: Date.now() })
        .where(sql`packing_location_id = ${id} and list_id = ${listId} and user_id = ${userId} and exists (select 1 from packing_locations pl where pl.id = ${id} and pl.list_id = ${listId} and pl.user_id = ${userId})`)
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
      const [, deleted] = await db.batch([unassign, remove])
      return deleted.length > 0
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
