import { and, asc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Db } from '../db'
import { gearItems, listItems, lists, packingLocations } from '../db/schema'
import {
  isForeignKeyViolation,
  isTriggerAbort,
  isUniqueViolation,
} from './db-errors'

const containerItems = alias(listItems, 'container_items')
const containerGear = alias(gearItems, 'container_gear')

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
      .orderBy(asc(packingLocations.sortOrder), asc(packingLocations.name))
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
        name = source.name
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
            // a correlation into a tautology.
            sortOrder: sql`coalesce((select max(pl.sort_order) + 1 from packing_locations pl where pl.list_id = ${listId} and pl.user_id = ${userId}), 0)`,
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
