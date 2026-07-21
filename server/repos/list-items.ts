import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { categories, gearItems, listItems, lists } from '../db/schema'
import { isTriggerAbort } from './db-errors'
import type { GearItemRow } from './gear-items'

const itemCols = {
  id: listItems.id,
  listId: listItems.listId,
  gearItemId: listItems.gearItemId,
  quantity: listItems.quantity,
  isWorn: listItems.isWorn,
  isConsumable: listItems.isConsumable,
  isPacked: listItems.isPacked,
  isReady: listItems.isReady,
  packingLocationId: listItems.packingLocationId,
  sortOrder: listItems.sortOrder,
  createdAt: listItems.createdAt,
  updatedAt: listItems.updatedAt,
}

const gearCols = {
  id: gearItems.id,
  categoryId: gearItems.categoryId,
  name: gearItems.name,
  description: gearItems.description,
  weightGrams: gearItems.weightGrams,
  costCents: gearItems.costCents,
  purchaseDate: gearItems.purchaseDate,
  status: gearItems.status,
  sortOrder: gearItems.sortOrder,
  createdAt: gearItems.createdAt,
  updatedAt: gearItems.updatedAt,
}

export type ListItemRow = {
  id: string
  listId: string
  gearItemId: string
  quantity: number
  isWorn: boolean
  isConsumable: boolean
  isPacked: boolean
  isReady: boolean
  packingLocationId: string | null
  sortOrder: number
  createdAt: number // epoch ms
  updatedAt: number // epoch ms
}

// The joined shape the routes serialize: membership row + its gear row
// (embedded gear_item response shape, REWRITE_PLAN.md section 5).
export type ListItemWithGear = { item: ListItemRow; gear: GearItemRow }

export type UpdateListItemPatch = {
  quantity?: number
  isWorn?: boolean
  isConsumable?: boolean
  isPacked?: boolean
  isReady?: boolean
  packingLocationId?: string | null
}

export type QuickAddInput = {
  name: string
  description: string | null
  weightGrams: number
  categoryId: string | null
  quantity: number
  isWorn: boolean
  isConsumable: boolean
}

export type ListItemWriteResult =
  | { ok: true; row: ListItemWithGear }
  | {
      ok: false
      reason:
        | 'list_not_found'
        | 'not_found'
        | 'invalid_gear'
        | 'invalid_category'
        | 'invalid_location'
        | 'worn_consumable_conflict'
        | 'cap_exceeded'
        | 'gear_cap_exceeded'
    }

// The 0004 trigger is the single enforcement point; keep in lockstep
// with its WHEN clause and message.
export const LIST_ITEM_CAP = 300

export function isListItemCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'list item cap exceeded')
}

function isGearCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'gear item cap exceeded')
}

export function createListItemsRepo(db: Db, userId: string) {
  async function ownsList(listId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
      .limit(1)
    return Boolean(row)
  }

  function nextItemSortOrder(listId: string) {
    return sql`coalesce((select max(${listItems.sortOrder}) + 1 from ${listItems} where ${listItems.listId} = ${listId} and ${listItems.userId} = ${userId}), 0)`
  }

  // Joined same-owner read; the FK guarantees item.userId == gear.userId,
  // the join condition re-asserts it anyway (belt and braces, zero cost).
  function joinedSelect() {
    return db
      .select({ item: itemCols, gear: gearCols })
      .from(listItems)
      .innerJoin(
        gearItems,
        and(
          eq(listItems.gearItemId, gearItems.id),
          eq(listItems.userId, gearItems.userId),
        ),
      )
  }

  return {
    // null = list not owned (the route's 404); [] = owned but empty.
    async forList(listId: string): Promise<ListItemWithGear[] | null> {
      if (!(await ownsList(listId))) return null
      return joinedSelect()
        .where(and(eq(listItems.listId, listId), eq(listItems.userId, userId)))
        .orderBy(asc(listItems.sortOrder), asc(gearItems.name))
    },

    async addExisting(
      listId: string,
      gearItemId: string,
    ): Promise<ListItemWriteResult> {
      if (!(await ownsList(listId))) {
        return { ok: false, reason: 'list_not_found' }
      }
      const [gear] = await db
        .select(gearCols)
        .from(gearItems)
        .where(and(eq(gearItems.id, gearItemId), eq(gearItems.userId, userId)))
        .limit(1)
      if (!gear) return { ok: false, reason: 'invalid_gear' }
      const now = Date.now()
      try {
        const [item] = await db
          .insert(listItems)
          .values({
            id: crypto.randomUUID(),
            userId,
            listId,
            gearItemId,
            sortOrder: nextItemSortOrder(listId),
            createdAt: now,
            updatedAt: now,
          })
          .returning(itemCols)
        if (!item) throw new Error('list item insert returned no row')
        return { ok: true, row: { item, gear } }
      } catch (err) {
        if (isListItemCapError(err)) {
          return { ok: false, reason: 'cap_exceeded' }
        }
        throw err
      }
    },

    // Quick-Add: gear row + membership row in ONE batch (a real
    // transaction on D1) - the old add_gear_item_with_list_item RPC.
    // Either cap trigger aborts the whole thing; zero partial rows.
    async quickAdd(
      listId: string,
      input: QuickAddInput,
    ): Promise<ListItemWriteResult> {
      if (!(await ownsList(listId))) {
        return { ok: false, reason: 'list_not_found' }
      }
      if (input.categoryId !== null) {
        const [cat] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.id, input.categoryId),
              eq(categories.userId, userId),
            ),
          )
          .limit(1)
        if (!cat) return { ok: false, reason: 'invalid_category' }
      }
      const gearId = crypto.randomUUID()
      const now = Date.now()
      const insertGear = db
        .insert(gearItems)
        .values({
          id: gearId,
          userId,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          weightGrams: input.weightGrams,
          sortOrder: sql`coalesce((select max(${gearItems.sortOrder}) + 1 from ${gearItems} where ${gearItems.userId} = ${userId}), 0)`,
          createdAt: now,
          updatedAt: now,
        })
        .returning(gearCols)
      const insertItem = db
        .insert(listItems)
        .values({
          id: crypto.randomUUID(),
          userId,
          listId,
          gearItemId: gearId,
          quantity: input.quantity,
          isWorn: input.isWorn,
          isConsumable: input.isConsumable,
          sortOrder: nextItemSortOrder(listId),
          createdAt: now,
          updatedAt: now,
        })
        .returning(itemCols)
      try {
        const [gearRows, itemRows] = await db.batch([insertGear, insertItem])
        const gear = gearRows[0]
        const item = itemRows[0]
        if (!gear || !item) throw new Error('quick-add returned no rows')
        return { ok: true, row: { item, gear } }
      } catch (err) {
        if (isGearCapError(err)) {
          return { ok: false, reason: 'gear_cap_exceeded' }
        }
        if (isListItemCapError(err)) {
          return { ok: false, reason: 'cap_exceeded' }
        }
        throw err
      }
    },

    // Parent-path consistency: the item must belong to THIS list AND
    // this user, or the call 404s (REWRITE_PLAN.md section 6). The
    // worn/consumable exclusivity is checked against the MERGED row in
    // code (explicit and testable); the DB CHECK stays as the backstop.
    async update(
      listId: string,
      itemId: string,
      patch: UpdateListItemPatch,
    ): Promise<ListItemWriteResult> {
      const [current] = await db
        .select(itemCols)
        .from(listItems)
        .where(
          and(
            eq(listItems.id, itemId),
            eq(listItems.listId, listId),
            eq(listItems.userId, userId),
          ),
        )
        .limit(1)
      if (!current) return { ok: false, reason: 'not_found' }
      const mergedWorn = patch.isWorn ?? current.isWorn
      const mergedConsumable = patch.isConsumable ?? current.isConsumable
      if (mergedWorn && mergedConsumable) {
        return { ok: false, reason: 'worn_consumable_conflict' }
      }
      const set: Record<string, unknown> = { updatedAt: Date.now() }
      if (patch.quantity !== undefined) set.quantity = patch.quantity
      if (patch.isWorn !== undefined) set.isWorn = patch.isWorn
      if (patch.isConsumable !== undefined)
        set.isConsumable = patch.isConsumable
      if (patch.isPacked !== undefined) set.isPacked = patch.isPacked
      if (patch.isReady !== undefined) set.isReady = patch.isReady
      if (patch.packingLocationId !== undefined) {
        set.packingLocationId = patch.packingLocationId
      }
      // A real assignment is accepted only when the target location belongs
      // to this same list and user. The aliases are hand-written because
      // drizzle can render interpolated columns unqualified inside a
      // correlated subquery. Null (Unassigned) deliberately skips the gate.
      const packingLocationGate =
        patch.packingLocationId === undefined ||
        patch.packingLocationId === null
          ? undefined
          : sql`exists (select 1 from packing_locations pl where pl.id = ${patch.packingLocationId} and pl.list_id = ${listId} and pl.user_id = ${userId})
              and not exists (
                with recursive container_ancestors(item_id) as (
                  select pl.container_list_item_id
                    from packing_locations pl
                   where pl.id = ${patch.packingLocationId}
                     and pl.list_id = ${listId}
                     and pl.user_id = ${userId}
                     and pl.container_list_item_id is not null
                  union
                  select parent.container_list_item_id
                    from container_ancestors ca
                    join list_items li
                      on li.id = ca.item_id
                     and li.list_id = ${listId}
                     and li.user_id = ${userId}
                    join packing_locations parent
                      on parent.id = li.packing_location_id
                     and parent.list_id = ${listId}
                     and parent.user_id = ${userId}
                   where parent.container_list_item_id is not null
                )
                select 1 from container_ancestors where item_id = ${itemId}
              )`
      // listId in the WRITE's where-clause too, not just the SELECT
      // above: today nothing can move an item between lists, but the
      // write must stay parent-path-consistent by construction if that
      // ever changes (Codex hardening note, PR #19).
      const [item] = await db
        .update(listItems)
        .set(set)
        .where(
          and(
            eq(listItems.id, itemId),
            eq(listItems.listId, listId),
            eq(listItems.userId, userId),
            packingLocationGate,
          ),
        )
        .returning(itemCols)
      if (!item) {
        if (packingLocationGate !== undefined) {
          const [stillExists] = await db
            .select({ id: listItems.id })
            .from(listItems)
            .where(
              and(
                eq(listItems.id, itemId),
                eq(listItems.listId, listId),
                eq(listItems.userId, userId),
              ),
            )
            .limit(1)
          if (stillExists) return { ok: false, reason: 'invalid_location' }
        }
        return { ok: false, reason: 'not_found' }
      }
      const [gear] = await db
        .select(gearCols)
        .from(gearItems)
        .where(
          and(eq(gearItems.id, item.gearItemId), eq(gearItems.userId, userId)),
        )
        .limit(1)
      if (!gear) throw new Error('list item lost its gear row')
      return { ok: true, row: { item, gear } }
    },

    // Removes the membership row only; the gear stays in the library.
    async remove(listId: string, itemId: string): Promise<boolean> {
      const rows = await db
        .delete(listItems)
        .where(
          and(
            eq(listItems.id, itemId),
            eq(listItems.listId, listId),
            eq(listItems.userId, userId),
          ),
        )
        .returning({ id: listItems.id })
      return rows.length > 0
    },

    // sortOrder ONLY - reorders must not bump updatedAt (product rule).
    // Every id must belong to this list and user, all-or-nothing.
    async reorder(
      listId: string,
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      // Owned-set membership, not inArray over the input: D1 caps bound
      // parameters at 100 per query and the reorder DTO allows
      // LIST_ITEM_CAP (300) ids (see chunk-ids.ts). The per-list cap
      // bounds the scan at 300 rows.
      const ids = updates.map((u) => u.id)
      const ownedRows = await db
        .select({ id: listItems.id })
        .from(listItems)
        .where(
          and(eq(listItems.listId, listId), eq(listItems.userId, userId)),
        )
      const owned = new Set(ownedRows.map((r) => r.id))
      if (!ids.every((id) => owned.has(id))) return false
      const [first, ...rest] = updates.map((u) =>
        db
          .update(listItems)
          .set({ sortOrder: u.sortOrder })
          .where(
            and(eq(listItems.id, u.id), eq(listItems.userId, userId)),
          ),
      )
      if (!first) return true // unreachable: DTO enforces min(1)
      await db.batch([first, ...rest])
      return true
    },

    // Pack-mode resets. Only touches rows where the flag is set, so an
    // untouched item's updatedAt stays honest.
    async resetPacked(listId: string): Promise<boolean> {
      if (!(await ownsList(listId))) return false
      await db
        .update(listItems)
        .set({ isPacked: false, updatedAt: Date.now() })
        .where(
          and(
            eq(listItems.listId, listId),
            eq(listItems.userId, userId),
            eq(listItems.isPacked, true),
          ),
        )
      return true
    },

    async resetReady(listId: string): Promise<boolean> {
      if (!(await ownsList(listId))) return false
      await db
        .update(listItems)
        .set({ isReady: false, updatedAt: Date.now() })
        .where(
          and(
            eq(listItems.listId, listId),
            eq(listItems.userId, userId),
            eq(listItems.isReady, true),
          ),
        )
      return true
    },
  }
}
