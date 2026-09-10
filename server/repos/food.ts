import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db'
import {
  listFoodItemSlots,
  listFoodItems,
  listFoodSlots,
  lists,
  packingLocations,
} from '../db/schema'
import { MEALS, foodUnitCount, type Meal } from '../../shared/food'
import { chunkForParamCap, chunkIds } from './chunk-ids'
import {
  isAnyUniqueViolation,
  isForeignKeyViolation,
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

export type FoodSlotRow = {
  id: string
  dayNumber: number
  meal: Meal
}

export type FoodItemRow = {
  id: string
  name: string
  weightGrams: number
  // Per MEAL when isPerMeal, a total otherwise. unitCount is what you carry.
  quantity: number
  isPerMeal: boolean
  unitCount: number
  sortOrder: number
  // Pack state (0022): food is a full peer of gear in Pack mode. Rank
  // semantics live on pack-reorder.ts; weight stays summed over items alone
  // regardless of where they are packed.
  isPacked: boolean
  isReady: boolean
  packingLocationId: string | null
  packSortOrder: number
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
        | 'conflict'
    }

export function isFoodItemCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'food item cap exceeded')
}

export function createFoodRepo(db: Db, userId: string) {
  // Every method takes listId and filters on it. The route's list is the only
  // authority on which list a nested resource belongs to - trusting the child
  // id alone would let one of this user's own lists reach into another's rows.
  //
  // Probes are BUILDERS so the FK-recovery paths can batch them into one
  // consistent snapshot; the prechecks await the same builders, which is what
  // keeps precheck and recovery from drifting apart.
  function listProbe(listId: string) {
    return db
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
      .limit(1)
  }

  function itemProbe(listId: string, itemId: string) {
    return db
      .select({ id: listFoodItems.id })
      .from(listFoodItems)
      .where(
        and(
          eq(listFoodItems.id, itemId),
          eq(listFoodItems.listId, listId),
          eq(listFoodItems.userId, userId),
        ),
      )
      .limit(1)
  }

  // Chunked owned-set membership over client-supplied slot ids, never an
  // unbounded inArray: D1 caps bound params at 100 per statement.
  function slotProbes(listId: string, slotIds: string[]) {
    return chunkIds(slotIds).map((chunk) =>
      db
        .select({ id: listFoodSlots.id })
        .from(listFoodSlots)
        .where(
          and(
            eq(listFoodSlots.listId, listId),
            eq(listFoodSlots.userId, userId),
            inArray(listFoodSlots.id, chunk),
          ),
        ),
    )
  }

  async function ownsList(listId: string): Promise<boolean> {
    const [row] = await listProbe(listId)
    return row !== undefined
  }

  // On a FOREIGN KEY violation from a food write: SQLite never names the
  // failed constraint, so re-probe every prechecked parent in ONE batch (a
  // consistent snapshot - sequential reads would just open a second
  // classification race) and map only a parent PROVEN gone to its precheck's
  // result. Precedence list -> item -> slots, matching the prechecks. Returns
  // null when every probe still passes: the FK is unexplained and the caller
  // must rethrow rather than dress a programming defect as client error.
  async function classifyFoodFk(
    listId: string,
    itemId: string | null,
    slotIds: string[],
  ): Promise<'not_found' | 'invalid_slots' | null> {
    const [first, ...rest] = [
      listProbe(listId),
      ...(itemId !== null ? [itemProbe(listId, itemId)] : []),
      ...slotProbes(listId, slotIds),
    ]
    if (!first) throw new Error('unreachable: the list probe is always present')
    // Every probe selects only `id`; batch typing cannot see through the
    // dynamically built tuple, so one cast pins the shape they all share.
    const results = (await db.batch([first, ...rest])) as { id: string }[][]
    const [listRows, ...restRows] = results
    if (!listRows?.[0]) return 'not_found'
    let slotRowSets = restRows
    if (itemId !== null) {
      const [itemRows, ...slotsOnly] = restRows
      if (!itemRows?.[0]) return 'not_found'
      slotRowSets = slotsOnly
    }
    const found = new Set(slotRowSets.flat().map((row) => row.id))
    if (slotIds.some((id) => !found.has(id))) return 'invalid_slots'
    return null
  }

  return {
    async forList(listId: string): Promise<ListFood | null> {
      if (!(await ownsList(listId))) return null

      // One batch: a D1 transaction, so the three reads are a consistent
      // snapshot and an item cannot appear with associations to slots that a
      // concurrent day-trim already removed.
      const [slotRows, itemRows, linkRows] = await db.batch([
        db
          .select({
            id: listFoodSlots.id,
            dayNumber: listFoodSlots.dayNumber,
            meal: listFoodSlots.meal,
          })
          .from(listFoodSlots)
          .where(and(eq(listFoodSlots.listId, listId), eq(listFoodSlots.userId, userId)))
          .orderBy(asc(listFoodSlots.dayNumber)),
        db
          .select({
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
          })
          .from(listFoodItems)
          .where(and(eq(listFoodItems.listId, listId), eq(listFoodItems.userId, userId)))
          .orderBy(asc(listFoodItems.sortOrder)),
        db
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
          ),
      ])

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
        slots: slotRows.map((slot) => ({
          id: slot.id,
          dayNumber: slot.dayNumber,
          meal: slot.meal,
        })),
        items: itemRows.map((item) => {
          const slotIds = slotsByItem.get(item.id) ?? []
          // Computed HERE and shipped, not left to each reader. The public
          // share needs the count and must never receive the schedule it
          // derives from, and three surfaces computing it independently is
          // how the share came to report a lighter pack than the owner's own
          // page once already.
          return { ...item, slotIds, unitCount: foodUnitCount({ ...item, slotIds }) }
        }),
      }
    },

    /**
     * Generate/trim the day x meal grid.
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
    async setDayCount(listId: string, days: number): Promise<boolean> {
      if (!(await ownsList(listId))) return false

      const existing = await db
        .select({
          dayNumber: listFoodSlots.dayNumber,
          meal: listFoodSlots.meal,
        })
        .from(listFoodSlots)
        .where(and(eq(listFoodSlots.listId, listId), eq(listFoodSlots.userId, userId)))

      const present = new Set(existing.map((slot) => `${slot.dayNumber}:${slot.meal}`))
      const now = Date.now()
      const missing: {
        id: string
        userId: string
        listId: string
        dayNumber: number
        meal: Meal
        createdAt: number
        updatedAt: number
      }[] = []
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

      // chunkForParamCap because 90 rows x 8 columns is ~720 bound params and
      // D1 caps a statement at 100 - including statements inside a batch.
      const inserts = chunkForParamCap(listFoodSlots, missing).map((rows) =>
        db.insert(listFoodSlots).values(rows),
      )
      const trim = db
        .delete(listFoodSlots)
        .where(
          and(
            eq(listFoodSlots.listId, listId),
            eq(listFoodSlots.userId, userId),
            gt(listFoodSlots.dayNumber, days),
          ),
        )

      // One batch so a partial failure cannot leave a day with two of its
      // three meals.
      const statements = [...inserts, trim] as const
      const [first, ...rest] = statements
      try {
        if (first) await db.batch([first, ...rest])
      } catch (err) {
        // The list was deleted between the ownership check and the batch:
        // the slot inserts fail a foreign key. A slot references both the
        // user and the (list, user) pair, and the user's deletion cascades
        // the list, so the probe is the same either way - the list is gone
        // and not-found is the right answer. An FK failure while the list is
        // still owned is something else and is rethrown.
        if (isForeignKeyViolation(err) && !(await ownsList(listId))) {
          return false
        }
        throw err
      }
      return true
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
      if (!(await ownsList(listId))) return { ok: false, reason: 'not_found' }

      const usable = await usableSlotIds(listId, input.slotIds)
      if (usable === null) return { ok: false, reason: 'invalid_slots' }

      const id = crypto.randomUUID()
      const now = Date.now()
      const [maxRow] = await db
        .select({ max: sql<number>`coalesce(max(${listFoodItems.sortOrder}), -1)` })
        .from(listFoodItems)
        .where(and(eq(listFoodItems.listId, listId), eq(listFoodItems.userId, userId)))

      const insertItem = db
        .insert(listFoodItems)
        .values({
          id,
          userId,
          listId,
          name: input.name,
          weightGrams: input.weightGrams,
          // Exactly what the caller asked for. Per-meal unless told otherwise,
          // matching the column default: the count you CARRY is derived from
          // this and the schedule (foodUnitCount), never stored.
          quantity: input.quantity,
          isPerMeal: input.isPerMeal ?? true,
          sortOrder: (maxRow?.max ?? -1) + 1,
          // A new food item arrives Unassigned, one past that cohort's UNION
          // maximum (gear and food - see pack-reorder.ts). DEFAULT 0 would
          // collide with whatever already holds rank 0 there.
          packSortOrder: nextUnionPackRank(listId, userId, null),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ packSortOrder: listFoodItems.packSortOrder })

      // Item and associations in ONE batch: a failed association must not leave
      // an orphaned item behind.
      const linkInserts = linkStatements(db, listId, userId, id, usable)
      let inserted: { packSortOrder: number } | undefined
      try {
        const [insertRows] = await db.batch([insertItem, ...linkInserts])
        inserted = insertRows[0]
      } catch (err) {
        if (isFoodItemCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        // 0022's range trigger: the Unassigned cohort sits at PACK_RANK_MAX,
        // so the max+1 above would step past it.
        if (isPackRankRangeError(err)) {
          return { ok: false, reason: 'pack_rank_exhausted' }
        }
        // The only unique constraint this batch can trip is the food pack
        // cohort index: a concurrent arrival claimed the same rank first.
        // Defensive on serialized D1 (the subquery runs inside the
        // statement), but a classified 409 beats an unexplained 500.
        if (isAnyUniqueViolation(err)) {
          return { ok: false, reason: 'conflict' }
        }
        // A concurrent delete beat the batch: the list itself (cascade took
        // the slots with it) or a day-trim that removed a slot this item was
        // being placed into. classifyFoodFk re-probes and says which; an FK
        // it cannot explain rethrows as the 500 it deserves.
        if (isForeignKeyViolation(err)) {
          const reason = await classifyFoodFk(listId, null, usable)
          if (reason !== null) return { ok: false, reason }
        }
        throw err
      }
      if (!inserted) throw new Error('food item insert returned no row')

      return {
        ok: true,
        row: {
          id,
          name: input.name,
          weightGrams: input.weightGrams,
          quantity: input.quantity,
          isPerMeal: input.isPerMeal ?? true,
          unitCount: foodUnitCount({
            quantity: input.quantity,
            isPerMeal: input.isPerMeal ?? true,
            slotIds: usable,
          }),
          sortOrder: (maxRow?.max ?? -1) + 1,
          isPacked: false,
          isReady: false,
          packingLocationId: null,
          packSortOrder: inserted.packSortOrder,
          slotIds: usable,
        },
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
      if (!(await ownsList(listId))) return { ok: false, reason: 'not_found' }

      const [item] = await db
        .select({
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
        })
        .from(listFoodItems)
        .where(
          and(
            eq(listFoodItems.id, itemId),
            eq(listFoodItems.listId, listId),
            eq(listFoodItems.userId, userId),
          ),
        )
        .limit(1)
      if (!item) return { ok: false, reason: 'not_found' }

      // Omitted slotIds means "leave the associations alone"; [] means
      // "unschedule". Those are different operations.
      let usable: string[] | null = null
      if (patch.slotIds !== undefined) {
        usable = await usableSlotIds(listId, patch.slotIds)
        if (usable === null) return { ok: false, reason: 'invalid_slots' }
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
        // destination's union cohort; the did-it-actually-change test lives
        // INSIDE the statement so a re-assignment to the current bag does
        // not walk the row to the bottom of its own bag. `IS` because the
        // target may be null (Unassigned). Appends need no two-phase write.
        set.packSortOrder = sql`case
          when ${listFoodItems.packingLocationId} is ${patch.packingLocationId}
          then ${listFoodItems.packSortOrder}
          else ${nextUnionPackRank(listId, userId, patch.packingLocationId)}
        end`
      }
      // A real assignment is accepted only when the target location belongs
      // to this same list and user. PRECHECKED rather than gated inside the
      // UPDATE's where-clause (the gear shape): this batch may also carry the
      // slot-link rewrite, and an in-statement gate that misses would let the
      // slot statements apply while the location write silently did not - a
      // partially-applied patch. A location cannot move lists (0014's
      // immutability trigger), so the only race left after the precheck is
      // deletion - and it is 0022's BEFORE UPDATE trigger, not the FK, that
      // catches it: a BEFORE trigger runs ahead of constraint checks, and its
      // marker is classified below. Food cannot back a container, so there
      // is no cycle to check, unlike the gear gate. Null (Unassigned)
      // deliberately skips the gate.
      if (
        patch.packingLocationId !== undefined &&
        patch.packingLocationId !== null
      ) {
        const [location] = await db
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
        if (!location) return { ok: false, reason: 'invalid_location' }
      }

      // The response is built from what the batch RETURNS and READS, never
      // from the pre-read: the batch is one D1 transaction, so the scalars
      // and the links it hands back are one snapshot. Composing the answer
      // from `patch.x ?? item.x` (the old shape) could pair a quantity a
      // concurrent write had already replaced with links this write made -
      // a row the database never held.
      const statements: Parameters<Db['batch']>[0][number][] = [
        db
          .update(listFoodItems)
          .set(set)
          .where(
            and(
              eq(listFoodItems.id, itemId),
              eq(listFoodItems.listId, listId),
              eq(listFoodItems.userId, userId),
            ),
          )
          .returning({
            name: listFoodItems.name,
            weightGrams: listFoodItems.weightGrams,
            quantity: listFoodItems.quantity,
            isPerMeal: listFoodItems.isPerMeal,
            sortOrder: listFoodItems.sortOrder,
            isPacked: listFoodItems.isPacked,
            isReady: listFoodItems.isReady,
            packingLocationId: listFoodItems.packingLocationId,
            packSortOrder: listFoodItems.packSortOrder,
          }),
      ]
      if (usable !== null) {
        statements.push(
          db
            .delete(listFoodItemSlots)
            .where(
              and(
                eq(listFoodItemSlots.foodItemId, itemId),
                eq(listFoodItemSlots.listId, listId),
                eq(listFoodItemSlots.userId, userId),
              ),
            ),
          ...linkStatements(db, listId, userId, itemId, usable),
        )
      }
      // Always last, so it sees the link rewrite above when there was one.
      statements.push(
        db
          .select({ slotId: listFoodItemSlots.slotId })
          .from(listFoodItemSlots)
          .where(
            and(
              eq(listFoodItemSlots.foodItemId, itemId),
              eq(listFoodItemSlots.listId, listId),
              eq(listFoodItemSlots.userId, userId),
            ),
          ),
      )
      const [first, ...rest] = statements
      type Updated = {
        name: string
        weightGrams: number
        quantity: number
        isPerMeal: boolean
        sortOrder: number
        isPacked: boolean
        isReady: boolean
        packingLocationId: string | null
        packSortOrder: number
      }
      let updated: Updated | undefined
      let links: string[] = []
      try {
        if (first) {
          const results = await db.batch([first, ...rest])
          updated = (results[0] as Updated[])[0]
          links = (results[results.length - 1] as { slotId: string }[]).map(
            (row) => row.slotId,
          )
        }
      } catch (err) {
        // 0022's range trigger: the destination cohort's rank space is
        // exhausted, so the move's union max+1 stepped past PACK_RANK_MAX.
        if (isPackRankRangeError(err)) {
          return { ok: false, reason: 'pack_rank_exhausted' }
        }
        // A concurrent move claimed the destination rank first; the unique
        // cohort index rejected the batch. Defensive on serialized D1, but a
        // classified 409 beats an unexplained 500.
        if (isAnyUniqueViolation(err)) {
          return { ok: false, reason: 'conflict' }
        }
        // The prechecked location was deleted between the precheck and the
        // batch. 0022's BEFORE UPDATE trigger fires first - ahead of the FK -
        // and names the condition, so this is a clean 400, not a 500. The
        // FK branch below keeps its own location probe for the case where a
        // future schema change makes the FK the one that fires.
        if (isTriggerAbort(err, 'packing location does not belong to this list')) {
          return { ok: false, reason: 'invalid_location' }
        }
        // Same recovery as createItem, plus the item itself and (when a
        // location was being assigned) the prechecked location: a slot
        // trimmed between precheck and batch fires the anonymous FK error.
        if (isForeignKeyViolation(err)) {
          if (
            patch.packingLocationId !== undefined &&
            patch.packingLocationId !== null
          ) {
            const [locationStillThere] = await db
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
            if (!locationStillThere) {
              return { ok: false, reason: 'invalid_location' }
            }
          }
          const reason = await classifyFoodFk(listId, itemId, usable ?? [])
          if (reason !== null) return { ok: false, reason }
        }
        throw err
      }

      // The UPDATE matching zero rows means the item was deleted between the
      // pre-read and the batch. Without this check a slot-free patch would
      // commit an empty batch and answer 200 with the stale pre-read values
      // for a row that no longer exists (GATE 2 finding).
      if (updated === undefined) return { ok: false, reason: 'not_found' }

      return {
        ok: true,
        row: {
          id: itemId,
          ...updated,
          unitCount: foodUnitCount({
            quantity: updated.quantity,
            isPerMeal: updated.isPerMeal,
            slotIds: links,
          }),
          slotIds: links,
        },
      }
    },

    async deleteItem(listId: string, itemId: string): Promise<boolean> {
      if (!(await ownsList(listId))) return false
      const result = await db
        .delete(listFoodItems)
        .where(
          and(
            eq(listFoodItems.id, itemId),
            eq(listFoodItems.listId, listId),
            eq(listFoodItems.userId, userId),
          ),
        )
        .returning({ id: listFoodItems.id })
      return result.length > 0
    },
  }

  /**
   * Resolve client-supplied slot ids to the ones on THIS list, owned by THIS
   * user. Returns null when any id is unknown, so a bad request fails rather
   * than silently dropping placements the user asked for.
   *
   * There is nothing left for it to filter on. This used to defer to the
   * list_food_item_slots_needed_only trigger, which refused to associate food
   * with a slot marked "not needed"; the Skip feature, the column and that
   * trigger are all gone (0027). What remains is the membership question -
   * is this slot on THIS list, owned by THIS user - which is what the probes
   * below answer.
   *
   * Chunked owned-set membership, never an unbounded inArray: the id list is
   * client-supplied and D1 caps bound params at 100 per statement.
   */
  async function usableSlotIds(
    listId: string,
    slotIds: string[],
  ): Promise<string[] | null> {
    if (slotIds.length === 0) return []
    const [first, ...rest] = slotProbes(listId, slotIds)
    if (!first) return []
    // One batch even when chunking splits the probe: the membership answer
    // should be a single snapshot, and the FK-recovery path reuses these
    // exact builders (classifyFoodFk), so the two cannot drift.
    const chunks = await db.batch([first, ...rest])
    const found = new Set(chunks.flat().map((row) => row.id))
    if (found.size !== new Set(slotIds).size) return null
    return slotIds
  }
}

// Association inserts are chunked too: 90 links x 4 columns is ~360 bound
// params, over the same cap the slot inserts have to respect.
function linkStatements(
  db: Db,
  listId: string,
  userId: string,
  foodItemId: string,
  slotIds: string[],
) {
  const rows = slotIds.map((slotId) => ({ foodItemId, slotId, userId, listId }))
  return chunkForParamCap(listFoodItemSlots, rows).map((chunk) =>
    db.insert(listFoodItemSlots).values(chunk),
  )
}
