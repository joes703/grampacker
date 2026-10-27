import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { appendSortOrder } from './append-sort-order'
import { ownsList } from './owns-list'
import type { Db, Tx } from '../db'
import {
  listFoodItemSlots,
  listFoodItems,
  listFoodSlots,
  packingLocations,
} from '../db/schema'
import { MEALS, foodUnitCount } from '../../shared/food'
import {
  isPackRankRangeError,
  isTriggerAbort,
} from './db-errors'
import { nextUnionPackRank } from './pack-reorder'

// The food estimate: slots are the trip's eating periods, items are what you
// CARRY, and the association between them expresses intent only.
//
// THE RULE THIS FILE EXISTS TO PROTECT: weight is summed over ITEMS ALONE. The
// obvious query - join items to slots and sum weight x quantity - returns
// 2500 g for one 500 g bag of trail mix eaten across five lunches. There is no
// such join anywhere in this file, and there must never be one.

type FoodSlotRow = Pick<typeof listFoodSlots.$inferSelect, 'id' | 'dayNumber' | 'meal'>

// Quantity is per MEAL when isPerMeal, a total otherwise; unitCount (computed)
// is what you carry. Weight stays summed over items alone, wherever they are
// packed.
export type FoodItemRow = Pick<
  typeof listFoodItems.$inferSelect,
  | 'id'
  | 'name'
  | 'weightGrams'
  | 'quantity'
  | 'isPerMeal'
  | 'sortOrder'
  | 'isPacked'
  | 'isReady'
  | 'packingLocationId'
  | 'packSortOrder'
> & {
  unitCount: number
  slotIds: string[]
}

export type ListFood = {
  dayCount: number
  slots: FoodSlotRow[]
  items: FoodItemRow[]
}

export type FoodWriteResult<T> =
  | { ok: true; row: T }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'cap_exceeded'
        | 'invalid_slots'
        | 'invalid_location'
        | 'pack_rank_exhausted'
    }

function isFoodItemCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'food item cap exceeded')
}

// The item columns every read and write returns. slotIds and unitCount are
// added from the association rows.
const itemCols = {
  id: listFoodItems.id,
  name: listFoodItems.name,
  weightGrams: listFoodItems.weightGrams,
  quantity: listFoodItems.quantity,
  isPerMeal: listFoodItems.isPerMeal,
  sortOrder: listFoodItems.sortOrder,
  isPacked: listFoodItems.isPacked,
  isReady: listFoodItems.isReady,
  packingLocationId: listFoodItems.packingLocationId,
  packSortOrder: listFoodItems.packSortOrder,
}

// The writes trip these database rules on purpose. Each becomes a client
// result; anything else (a foreign key, another unique index, an unknown
// trigger) is a defect and stays a 500.
function classifyWriteError(
  err: unknown,
): 'cap_exceeded' | 'pack_rank_exhausted' | null {
  if (isFoodItemCapError(err)) return 'cap_exceeded'
  // The food pack rank range trigger: the destination cohort's rank space is exhausted,
  // so the union max + 1 stepped past PACK_RANK_MAX.
  if (isPackRankRangeError(err)) return 'pack_rank_exhausted'
  return null
}

// Every method runs its whole read, ownership check, planning and write
// sequence in ONE SQLite transaction on the process's only connection.
// Writes use `behavior: 'immediate'`, so the write lock is taken before the
// first read and no other connection can write between a check and the write
// it allows. The callback is synchronous, so no other request on this
// connection can run in the middle either. A check that passes therefore still
// holds when the write runs, and any failure rolls back everything the method
// wrote.
//
// Client-supplied id lists reach SQL as one unchunked inArray or one
// multi-row INSERT. That is safe only because the request schemas bound them:
// at most FOOD_SLOT_CAP (90) slot ids per item and FOOD_DAY_CAP (30) days,
// so the largest statement here binds about 90 x 7 = 630 parameters. SQLite as
// built into better-sqlite3 allows 32766 (server/db/sqlite.test.ts pins it).
// Raising either cap far enough to approach that needs chunking again.
export function createFoodRepo(db: Db, userId: string) {
  // The whole estimate for one owned list. Reads inside the caller's
  // transaction, so an item cannot appear with associations to slots that a
  // day-trim already removed.
  function readFood(tx: Tx, listId: string): ListFood {
    const slotRows = tx
      .select({
        id: listFoodSlots.id,
        dayNumber: listFoodSlots.dayNumber,
        meal: listFoodSlots.meal,
      })
      .from(listFoodSlots)
      .where(and(eq(listFoodSlots.listId, listId), eq(listFoodSlots.userId, userId)))
      .orderBy(asc(listFoodSlots.dayNumber))
      .all()
    const itemRows = tx
      .select(itemCols)
      .from(listFoodItems)
      .where(and(eq(listFoodItems.listId, listId), eq(listFoodItems.userId, userId)))
      .orderBy(asc(listFoodItems.sortOrder))
      .all()
    const linkRows = tx
      .select({
        foodItemId: listFoodItemSlots.foodItemId,
        slotId: listFoodItemSlots.slotId,
      })
      .from(listFoodItemSlots)
      .where(
        and(
          eq(listFoodItemSlots.listId, listId),
          eq(listFoodItemSlots.userId, userId),
        ),
      )
      .all()

    const slotsByItem = new Map<string, string[]>()
    for (const link of linkRows) {
      const existing = slotsByItem.get(link.foodItemId)
      if (existing) existing.push(link.slotId)
      else slotsByItem.set(link.foodItemId, [link.slotId])
    }

    // dayCount is DERIVED, never stored. A stored copy could disagree with
    // the rows, and the rows are the thing the user actually edits.
    const dayCount = slotRows.reduce((max, slot) => Math.max(max, slot.dayNumber), 0)

    return {
      dayCount,
      slots: slotRows,
      // unitCount is computed HERE and shipped, not left to each reader. The
      // public share needs the count and must never receive the schedule it
      // derives from, and three surfaces computing it independently is how
      // the share came to report a lighter pack than the owner's own page
      // once already.
      items: itemRows.map((item) => withLinks(item, slotsByItem.get(item.id) ?? [])),
    }
  }

  // One item's stored columns, and separately its associations. The write
  // methods answer with these reads, taken after their writes in the same
  // transaction, so the response is the row that committed.
  function readItem(
    tx: Tx,
    listId: string,
    itemId: string,
  ): Omit<FoodItemRow, 'slotIds' | 'unitCount'> | undefined {
    return tx
      .select(itemCols)
      .from(listFoodItems)
      .where(
        and(
          eq(listFoodItems.id, itemId),
          eq(listFoodItems.listId, listId),
          eq(listFoodItems.userId, userId),
        ),
      )
      .get()
  }

  function readLinks(tx: Tx, listId: string, itemId: string): string[] {
    return tx
      .select({ slotId: listFoodItemSlots.slotId })
      .from(listFoodItemSlots)
      .where(
        and(
          eq(listFoodItemSlots.foodItemId, itemId),
          eq(listFoodItemSlots.listId, listId),
          eq(listFoodItemSlots.userId, userId),
        ),
      )
      .all()
      .map((link) => link.slotId)
  }

  /**
   * True when every client-supplied slot id is on THIS list and owned by THIS
   * user. A bad request then fails rather than silently dropping placements
   * the user asked for. The ids arrive de-duplicated (slotIdsSchema), so
   * comparing counts is enough.
   */
  function ownsAllSlots(tx: Tx, listId: string, slotIds: string[]): boolean {
    if (slotIds.length === 0) return true
    const found = tx
      .select({ id: listFoodSlots.id })
      .from(listFoodSlots)
      .where(
        and(
          eq(listFoodSlots.listId, listId),
          eq(listFoodSlots.userId, userId),
          inArray(listFoodSlots.id, slotIds),
        ),
      )
      .all()
    return found.length === new Set(slotIds).size
  }

  function insertLinks(tx: Tx, listId: string, foodItemId: string, slotIds: string[]) {
    if (slotIds.length === 0) return
    tx.insert(listFoodItemSlots)
      .values(slotIds.map((slotId) => ({ foodItemId, slotId, userId, listId })))
      .run()
  }

  return {
    async forList(listId: string): Promise<ListFood | null> {
      return db.transaction((tx) => (ownsList(tx, userId, listId) ? readFood(tx, listId) : null))
    },

    /**
     * Generate/trim the day x meal grid, and answer with the resulting
     * estimate (null when the list is not the caller's).
     *
     * Contract, all of it load-bearing:
     *   - re-entering the same number is a no-op.
     *   - holes are repaired. Never derive the existing range from
     *     max(day_number): a missing middle day would stay missing forever.
     *   - surviving slots keep their IDs, so associations survive too. That
     *     rules out delete-all-then-reinsert.
     *   - trimming DOES cascade its associations away. Reducing to 3 and back
     *     to 5 gives days 4-5 back as fresh, empty slots.
     */
    async setDayCount(listId: string, days: number): Promise<ListFood | null> {
      return db.transaction(
        (tx) => {
          if (!ownsList(tx, userId, listId)) return null

          const existing = tx
            .select({ dayNumber: listFoodSlots.dayNumber, meal: listFoodSlots.meal })
            .from(listFoodSlots)
            .where(and(eq(listFoodSlots.listId, listId), eq(listFoodSlots.userId, userId)))
            .all()
          const present = new Set(existing.map((slot) => `${slot.dayNumber}:${slot.meal}`))
          const now = Date.now()
          const missing: (typeof listFoodSlots.$inferInsert)[] = []
          for (let day = 1; day <= days; day++) {
            for (const meal of MEALS) {
              if (present.has(`${day}:${meal}`)) continue
              missing.push({
                id: crypto.randomUUID(),
                userId,
                listId,
                dayNumber: day,
                meal,
                createdAt: now,
                updatedAt: now,
              })
            }
          }

          if (missing.length > 0) tx.insert(listFoodSlots).values(missing).run()
          tx.delete(listFoodSlots)
            .where(
              and(
                eq(listFoodSlots.listId, listId),
                eq(listFoodSlots.userId, userId),
                gt(listFoodSlots.dayNumber, days),
              ),
            )
            .run()
          return readFood(tx, listId)
        },
        { behavior: 'immediate' },
      )
    },

    async createItem(
      listId: string,
      input: {
        name: string
        weightGrams: number
        quantity: number
        isPerMeal?: boolean
        slotIds: string[]
      },
    ): Promise<FoodWriteResult<FoodItemRow>> {
      try {
        return db.transaction(
          (tx): FoodWriteResult<FoodItemRow> => {
            if (!ownsList(tx, userId, listId)) return { ok: false, reason: 'not_found' }
            if (!ownsAllSlots(tx, listId, input.slotIds)) {
              return { ok: false, reason: 'invalid_slots' }
            }

            const id = crypto.randomUUID()
            const now = Date.now()
            tx.insert(listFoodItems)
              .values({
                id,
                userId,
                listId,
                name: input.name,
                weightGrams: input.weightGrams,
                // Exactly what the caller asked for. Per-meal unless told
                // otherwise, matching the column default: the count you CARRY
                // is derived from this and the schedule (foodUnitCount), never
                // stored.
                quantity: input.quantity,
                isPerMeal: input.isPerMeal ?? true,
                sortOrder: appendSortOrder(
                  listFoodItems,
                  listFoodItems.sortOrder,
                  eq(listFoodItems.listId, listId),
                  eq(listFoodItems.userId, userId),
                ),
                // A new food item arrives Unassigned, one past that cohort's
                // UNION maximum (gear and food - see pack-reorder.ts). DEFAULT
                // 0 would collide with whatever already holds rank 0 there.
                packSortOrder: nextUnionPackRank(listId, userId, null),
                createdAt: now,
                updatedAt: now,
              })
              .run()
            insertLinks(tx, listId, id, input.slotIds)

            const row = readItem(tx, listId, id)
            if (!row) throw new Error('food item insert could not be read back')
            // The links just inserted are exactly the submitted ids. The
            // response keeps the caller's order rather than the index's.
            return { ok: true, row: withLinks(row, input.slotIds) }
          },
          { behavior: 'immediate' },
        )
      } catch (err) {
        const reason = classifyWriteError(err)
        if (reason !== null) return { ok: false, reason }
        throw err
      }
    },

    async updateItem(
      listId: string,
      itemId: string,
      patch: {
        name?: string
        weightGrams?: number
        quantity?: number
        isPerMeal?: boolean
        slotIds?: string[]
        isPacked?: boolean
        isReady?: boolean
        packingLocationId?: string | null
      },
    ): Promise<FoodWriteResult<FoodItemRow>> {
      try {
        return db.transaction(
          (tx): FoodWriteResult<FoodItemRow> => {
            if (!ownsList(tx, userId, listId)) return { ok: false, reason: 'not_found' }
            if (!readItem(tx, listId, itemId)) return { ok: false, reason: 'not_found' }

            // Omitted slotIds means "leave the associations alone"; [] means
            // "unschedule". Those are different operations.
            if (patch.slotIds !== undefined && !ownsAllSlots(tx, listId, patch.slotIds)) {
              return { ok: false, reason: 'invalid_slots' }
            }

            // A real assignment is accepted only when the target location
            // belongs to this same list and user. Null (Unassigned) skips the
            // check. The list_food_items_location_same_list_update trigger
            // enforces the same rule in the database; inside this transaction it can only fire on a defect.
            // Food cannot back a container, so there is no cycle to check,
            // unlike the gear move.
            if (patch.packingLocationId !== undefined && patch.packingLocationId !== null) {
              const location = tx
                .select({ id: packingLocations.id })
                .from(packingLocations)
                .where(
                  and(
                    eq(packingLocations.id, patch.packingLocationId),
                    eq(packingLocations.listId, listId),
                    eq(packingLocations.userId, userId),
                  ),
                )
                .limit(1)
                .get()
              if (!location) return { ok: false, reason: 'invalid_location' }
            }

            const set: Record<string, unknown> = { updatedAt: Date.now() }
            if (patch.name !== undefined) set.name = patch.name
            if (patch.weightGrams !== undefined) set.weightGrams = patch.weightGrams
            if (patch.quantity !== undefined) set.quantity = patch.quantity
            if (patch.isPerMeal !== undefined) set.isPerMeal = patch.isPerMeal
            if (patch.isPacked !== undefined) set.isPacked = patch.isPacked
            if (patch.isReady !== undefined) set.isReady = patch.isReady
            if (patch.packingLocationId !== undefined) {
              set.packingLocationId = patch.packingLocationId
              // Mirrors the gear move exactly (list-items.ts update): a move
              // rebases the PACK rank only, landing the row LAST in its
              // destination's union cohort; the did-it-actually-change test
              // lives INSIDE the statement so a re-assignment to the current
              // bag does not walk the row to the bottom of its own bag. `IS`
              // because the target may be null (Unassigned).
              set.packSortOrder = sql`case
                when ${listFoodItems.packingLocationId} is ${patch.packingLocationId}
                then ${listFoodItems.packSortOrder}
                else ${nextUnionPackRank(listId, userId, patch.packingLocationId)}
              end`
            }
            tx.update(listFoodItems)
              .set(set)
              .where(
                and(
                  eq(listFoodItems.id, itemId),
                  eq(listFoodItems.listId, listId),
                  eq(listFoodItems.userId, userId),
                ),
              )
              .run()

            // A reschedule is a full replace: delete every link, then insert
            // the submitted set. A failure after the delete rolls it back, so
            // a rejected reschedule never leaves the item unscheduled.
            if (patch.slotIds !== undefined) {
              tx.delete(listFoodItemSlots)
                .where(
                  and(
                    eq(listFoodItemSlots.foodItemId, itemId),
                    eq(listFoodItemSlots.listId, listId),
                    eq(listFoodItemSlots.userId, userId),
                  ),
                )
                .run()
              insertLinks(tx, listId, itemId, patch.slotIds)
            }

            const row = readItem(tx, listId, itemId)
            if (!row) throw new Error('food item update could not be read back')
            return { ok: true, row: withLinks(row, readLinks(tx, listId, itemId)) }
          },
          { behavior: 'immediate' },
        )
      } catch (err) {
        const reason = classifyWriteError(err)
        if (reason !== null) return { ok: false, reason }
        throw err
      }
    },

    async deleteItem(listId: string, itemId: string): Promise<boolean> {
      return db.transaction(
        (tx) => {
          if (!ownsList(tx, userId, listId)) return false
          // The item's associations go with it (ON DELETE CASCADE).
          const result = tx
            .delete(listFoodItems)
            .where(
              and(
                eq(listFoodItems.id, itemId),
                eq(listFoodItems.listId, listId),
                eq(listFoodItems.userId, userId),
              ),
            )
            .run()
          return result.changes > 0
        },
        { behavior: 'immediate' },
      )
    },
  }
}

function withLinks(
  item: Omit<FoodItemRow, 'slotIds' | 'unitCount'>,
  slotIds: string[],
): FoodItemRow {
  return { ...item, slotIds, unitCount: foodUnitCount({ ...item, slotIds }) }
}
