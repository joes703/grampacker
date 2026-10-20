import { and, asc, eq, sql } from 'drizzle-orm'
import { reorderOwnedSet } from './reorder'
import { appendSortOrder } from './append-sort-order'
import { ownsList } from './owns-list'
import type { Db, Tx } from '../db'
import { categories, gearItems, listFoodItems, listItems } from '../db/schema'
import {
  isPackRankRangeError,
  isPackRankUniqueViolation,
  isTriggerAbort,
} from './db-errors'
import type { GearItemRow } from './gear-items'
import { nextUnionPackRank } from './pack-reorder'

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
  packSortOrder: listItems.packSortOrder,
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
  packSortOrder: number
  createdAt: number // epoch ms
  updatedAt: number // epoch ms
}

// The joined shape the routes serialize: membership row + its gear row
// (the embedded gear_item response shape).
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
        | 'pack_rank_exhausted'
        | 'conflict'
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

// The item writes trip these database rules on purpose. Each becomes a client
// result; anything else (a foreign key, a unique index, an unknown trigger,
// the worn/consumable CHECK) is a defect and stays a 500.
function classifyWriteError(
  err: unknown,
): 'cap_exceeded' | 'gear_cap_exceeded' | 'pack_rank_exhausted' | null {
  if (isListItemCapError(err)) return 'cap_exceeded'
  if (isGearCapError(err)) return 'gear_cap_exceeded'
  // 0019's range trigger: the cohort's rank space is exhausted, so the
  // `max + 1` an arrival or a move computes would step past PACK_RANK_MAX.
  // A known condition, so it gets a status rather than a 500.
  if (isPackRankRangeError(err)) return 'pack_rank_exhausted'
  return null
}

// Every method that reads before it writes runs its reads, ownership checks,
// planning, writes and response read-back in ONE SQLite transaction on the
// process's only connection, with `behavior: 'immediate'` so the write lock
// is taken before the first read. The callbacks are synchronous, so no other
// request can run in the middle: a check that passes still holds when the
// write runs, and any failure rolls back everything the method wrote.
// remove() is a single statement and needs no explicit transaction.
export function createListItemsRepo(db: Db, userId: string) {
  function nextItemSortOrder(listId: string) {
    return appendSortOrder(
      listItems,
      listItems.sortOrder,
      eq(listItems.listId, listId),
      eq(listItems.userId, userId),
    )
  }

  function ownedGear(tx: Tx, gearItemId: string): GearItemRow | undefined {
    return tx
      .select(gearCols)
      .from(gearItems)
      .where(and(eq(gearItems.id, gearItemId), eq(gearItems.userId, userId)))
      .limit(1)
      .get()
  }

  // Both cleared flags share one shape: only rows where the flag is set are
  // touched, so an untouched item's updatedAt stays honest. Food is cleared
  // in the same transaction: "start packing over" means the whole pack, and
  // a reset that left food checked would be a lie the UI repeats.
  function resetFlag(listId: string, flag: 'isPacked' | 'isReady'): boolean {
    return db.transaction(
      (tx) => {
        if (!ownsList(tx, userId, listId)) return false
        const now = Date.now()
        tx.update(listItems)
          .set({ [flag]: false, updatedAt: now })
          .where(
            and(
              eq(listItems.listId, listId),
              eq(listItems.userId, userId),
              eq(listItems[flag], true),
            ),
          )
          .run()
        tx.update(listFoodItems)
          .set({ [flag]: false, updatedAt: now })
          .where(
            and(
              eq(listFoodItems.listId, listId),
              eq(listFoodItems.userId, userId),
              eq(listFoodItems[flag], true),
            ),
          )
          .run()
        return true
      },
      { behavior: 'immediate' },
    )
  }

  return {
    // null = list not owned (the route's 404); [] = owned but empty.
    async forList(listId: string): Promise<ListItemWithGear[] | null> {
      return db.transaction((tx) => {
        if (!ownsList(tx, userId, listId)) return null
        // Joined same-owner read; the FK guarantees item.userId ==
        // gear.userId, the join condition re-asserts it anyway.
        return tx
          .select({ item: itemCols, gear: gearCols })
          .from(listItems)
          .innerJoin(
            gearItems,
            and(
              eq(listItems.gearItemId, gearItems.id),
              eq(listItems.userId, gearItems.userId),
            ),
          )
          .where(and(eq(listItems.listId, listId), eq(listItems.userId, userId)))
          .orderBy(asc(listItems.sortOrder), asc(gearItems.name))
          .all()
      })
    },

    async addExisting(
      listId: string,
      gearItemId: string,
    ): Promise<ListItemWriteResult> {
      try {
        return db.transaction(
          (tx): ListItemWriteResult => {
            if (!ownsList(tx, userId, listId)) {
              return { ok: false, reason: 'list_not_found' }
            }
            const gear = ownedGear(tx, gearItemId)
            if (!gear) return { ok: false, reason: 'invalid_gear' }
            const now = Date.now()
            const item = tx
              .insert(listItems)
              .values({
                id: crypto.randomUUID(),
                userId,
                listId,
                gearItemId,
                sortOrder: nextItemSortOrder(listId),
                // A new item is Unassigned, so its pack rank comes from that
                // cohort - independently of the document rank. Copying
                // sortOrder here would drop it into the MIDDLE of pack order
                // once the two sequences have diverged.
                packSortOrder: nextUnionPackRank(listId, userId, null),
                createdAt: now,
                updatedAt: now,
              })
              .returning(itemCols)
              .get()
            return { ok: true, row: { item, gear } }
          },
          { behavior: 'immediate' },
        )
      } catch (err) {
        const reason = classifyWriteError(err)
        if (reason !== null) return { ok: false, reason }
        throw err
      }
    },

    // Quick-Add: gear row + membership row in ONE transaction - the old
    // add_gear_item_with_list_item RPC. Either cap trigger aborts the whole
    // thing; zero partial rows.
    async quickAdd(
      listId: string,
      input: QuickAddInput,
    ): Promise<ListItemWriteResult> {
      try {
        return db.transaction(
          (tx): ListItemWriteResult => {
            if (!ownsList(tx, userId, listId)) {
              return { ok: false, reason: 'list_not_found' }
            }
            if (input.categoryId !== null) {
              const cat = tx
                .select({ id: categories.id })
                .from(categories)
                .where(
                  and(
                    eq(categories.id, input.categoryId),
                    eq(categories.userId, userId),
                  ),
                )
                .limit(1)
                .get()
              if (!cat) return { ok: false, reason: 'invalid_category' }
            }
            const gearId = crypto.randomUUID()
            const now = Date.now()
            const gear = tx
              .insert(gearItems)
              .values({
                id: gearId,
                userId,
                categoryId: input.categoryId,
                name: input.name,
                description: input.description,
                weightGrams: input.weightGrams,
                sortOrder: appendSortOrder(gearItems, gearItems.sortOrder, eq(gearItems.userId, userId)),
                createdAt: now,
                updatedAt: now,
              })
              .returning(gearCols)
              .get()
            const item = tx
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
                // Unassigned cohort, same as addExisting.
                packSortOrder: nextUnionPackRank(listId, userId, null),
                createdAt: now,
                updatedAt: now,
              })
              .returning(itemCols)
              .get()
            return { ok: true, row: { item, gear } }
          },
          { behavior: 'immediate' },
        )
      } catch (err) {
        const reason = classifyWriteError(err)
        if (reason !== null) return { ok: false, reason }
        throw err
      }
    },

    // Parent-path consistency: the item must belong to THIS list AND
    // this user, or the call 404s (AGENTS.md Invariants). The
    // worn/consumable exclusivity is checked against the MERGED row in
    // code (explicit and testable); the DB CHECK stays as the backstop.
    async update(
      listId: string,
      itemId: string,
      patch: UpdateListItemPatch,
    ): Promise<ListItemWriteResult> {
      try {
        return db.transaction(
          (tx) => updateInTransaction(tx, listId, itemId, patch),
          { behavior: 'immediate' },
        )
      } catch (err) {
        // A move's destination rank hit a pack-rank unique index, and only
        // those. The rank is computed inside the same transaction that
        // writes it, so nothing should be able to take it first; this stays
        // as the backstop should the index and the rank computation ever
        // disagree (the same backstop as pack-reorder.ts). Adding an item
        // never answered 409, so only the move maps it.
        if (isPackRankUniqueViolation(err)) return { ok: false, reason: 'conflict' }
        const reason = classifyWriteError(err)
        if (reason !== null) return { ok: false, reason }
        throw err
      }
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
      return db.transaction(
        (tx) =>
          reorderOwnedSet(
            tx,
            listItems,
            { id: listItems.id, sortOrder: listItems.sortOrder },
            [eq(listItems.listId, listId), eq(listItems.userId, userId)],
            updates,
          ),
        { behavior: 'immediate' },
      )
    },

    async resetPacked(listId: string): Promise<boolean> {
      return resetFlag(listId, 'isPacked')
    },

    async resetReady(listId: string): Promise<boolean> {
      return resetFlag(listId, 'isReady')
    },
  }

  function updateInTransaction(
    tx: Tx,
    listId: string,
    itemId: string,
    patch: UpdateListItemPatch,
  ): ListItemWriteResult {
    const current = tx
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
      .get()
    if (!current) return { ok: false, reason: 'not_found' }
    const mergedWorn = patch.isWorn ?? current.isWorn
    const mergedConsumable = patch.isConsumable ?? current.isConsumable
    if (mergedWorn && mergedConsumable) {
      return { ok: false, reason: 'worn_consumable_conflict' }
    }
    const set: Record<string, unknown> = { updatedAt: Date.now() }
    if (patch.quantity !== undefined) set.quantity = patch.quantity
    if (patch.isWorn !== undefined) set.isWorn = patch.isWorn
    if (patch.isConsumable !== undefined) set.isConsumable = patch.isConsumable
    if (patch.isPacked !== undefined) set.isPacked = patch.isPacked
    if (patch.isReady !== undefined) set.isReady = patch.isReady
    if (patch.packingLocationId !== undefined) {
      set.packingLocationId = patch.packingLocationId
      // A move rebases the PACK rank and nothing else. It used to rebase
      // sortOrder, which is the bug this column exists to kill: sortOrder is
      // the document order, read by List view and by the anonymous share, so
      // dropping an item into a bag walked it to the bottom of the list you
      // had written AND to the bottom of the link you had shared. Moving
      // something inside your pack is not an edit to your document.
      //
      // The row still lands LAST in its destination, exactly like a newly
      // added one - the outcome stays statable in one sentence, it is just
      // scoped to the bag now instead of the whole list. A re-assignment to
      // the location the item is ALREADY in keeps its rank, so it does not
      // walk to the bottom of its own bag. `IS` rather than `=` because the
      // target may be null (Unassigned), and `=` is never true against null.
      //
      // Appending needs no two-phase write: it claims a rank above the
      // destination cohort's maximum, which by definition no live row holds.
      set.packSortOrder = sql`case
        when ${listItems.packingLocationId} is ${patch.packingLocationId}
        then ${listItems.packSortOrder}
        else ${nextUnionPackRank(listId, userId, patch.packingLocationId)}
      end`
    }
    // A real assignment is accepted only when the target location belongs
    // to this same list and user, and is not backed by this item or by an
    // item inside it (a bag cannot go inside itself). The aliases are
    // hand-written because drizzle can render interpolated columns
    // unqualified inside a correlated subquery. Null (Unassigned)
    // deliberately skips the gate.
    const packingLocationGate =
      patch.packingLocationId === undefined || patch.packingLocationId === null
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
    // listId in the WRITE's where-clause too, not just the read above:
    // today nothing can move an item between lists, but the write must stay
    // parent-path-consistent by construction if that ever changes.
    const item = tx
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
      .get()
    if (!item) {
      // The read above found the row in this same transaction, so only the
      // location gate can have excluded it.
      if (packingLocationGate !== undefined) return { ok: false, reason: 'invalid_location' }
      throw new Error('list item update matched no row')
    }
    const gear = ownedGear(tx, item.gearItemId)
    if (!gear) throw new Error('list item lost its gear row')
    return { ok: true, row: { item, gear } }
  }
}
