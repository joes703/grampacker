import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db'
import {
  listFoodItemSlots,
  listFoodItems,
  listFoodSlots,
  lists,
  packingLocations,
} from '../db/schema'
import { MEALS, type Meal } from '../../shared/food'
import { chunkForParamCap } from './chunk-ids'
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
  needed: boolean
}

export type FoodItemRow = {
  id: string
  name: string
  weightGrams: number
  quantity: number
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

// Raised by the needed_only trigger when an association insert loses a race
// with a prune. The read in usableSlotIds catches the ordinary case; this
// catches the narrow window it cannot.
export function isSlotNotNeededError(err: unknown): boolean {
  return isTriggerAbort(err, 'food slot not needed')
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
            needed: listFoodSlots.needed,
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
          needed: slot.needed,
        })),
        items: itemRows.map((item) => ({
          ...item,
          slotIds: slotsByItem.get(item.id) ?? [],
        })),
      }
    },

    /**
     * Generate/trim the day x meal grid.
     *
     * Contract, all of it load-bearing:
     *   - surviving days KEEP their `needed` flag. Re-entering the same number
     *     is a no-op; anything else would undo the user's pruning, which is the
     *     one piece of work this feature asks them to do by hand.
     *   - holes are repaired. Never derive the existing range from
     *     max(day_number): a missing middle day would stay missing forever.
     *   - surviving slots keep their IDs, so associations survive too. That
     *     rules out delete-all-then-reinsert.
     *   - trimming DOES cascade its associations away. Reducing to 3 and back
     *     to 5 gives days 4-5 back as fresh, needed, empty slots.
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
        needed: boolean
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
            needed: true,
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
      if (first) await db.batch([first, ...rest])
      return true
    },

    async setSlotNeeded(
      listId: string,
      slotId: string,
      needed: boolean,
    ): Promise<boolean> {
      if (!(await ownsList(listId))) return false

      const [slot] = await db
        .select({ id: listFoodSlots.id })
        .from(listFoodSlots)
        .where(
          and(
            eq(listFoodSlots.id, slotId),
            eq(listFoodSlots.listId, listId),
            eq(listFoodSlots.userId, userId),
          ),
        )
        .limit(1)
      if (!slot) return false

      const update = db
        .update(listFoodSlots)
        .set({ needed, updatedAt: Date.now() })
        .where(
          and(
            eq(listFoodSlots.id, slotId),
            eq(listFoodSlots.listId, listId),
            eq(listFoodSlots.userId, userId),
          ),
        )

      if (needed) {
        await db.batch([update])
        return true
      }

      // Marking a slot NOT NEEDED clears its associations in the same batch, so
      // the fourth state - "deliberately skipped, but still holding food" -
      // cannot be stored. An item that loses its last association shows up
      // under Unscheduled rather than vanishing.
      await db.batch([
        update,
        db
          .delete(listFoodItemSlots)
          .where(
            and(
              eq(listFoodItemSlots.slotId, slotId),
              eq(listFoodItemSlots.listId, listId),
              eq(listFoodItemSlots.userId, userId),
            ),
          ),
      ])
      return true
    },

    async createItem(
      listId: string,
      input: {
        name: string
        weightGrams: number
        quantity: number
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
          // Exactly what the caller asked for. Never the slot count.
          quantity: input.quantity,
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
        if (isSlotNotNeededError(err)) return { ok: false, reason: 'invalid_slots' }
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
      // deletion, which the FK catches below. Food cannot back a container,
      // so there is no cycle to check, unlike the gear gate. Null
      // (Unassigned) deliberately skips the gate.
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
      const [first, ...rest] = statements
      let updated:
        | {
            isPacked: boolean
            isReady: boolean
            packingLocationId: string | null
            packSortOrder: number
          }
        | undefined
      try {
        if (first) {
          const [updateRows] = await db.batch([first, ...rest])
          updated = (updateRows as typeof updated[])[0]
        }
      } catch (err) {
        if (isSlotNotNeededError(err)) return { ok: false, reason: 'invalid_slots' }
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
        // Same recovery as createItem, plus the item itself and (when a
        // location was being assigned) the prechecked location: a concurrent
        // location delete between precheck and batch fires the same
        // anonymous FK error a trimmed slot does.
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

      const links =
        usable ??
        (
          await db
            .select({ slotId: listFoodItemSlots.slotId })
            .from(listFoodItemSlots)
            .where(
              and(
                eq(listFoodItemSlots.foodItemId, itemId),
                eq(listFoodItemSlots.listId, listId),
                eq(listFoodItemSlots.userId, userId),
              ),
            )
        ).map((row) => row.slotId)

      return {
        ok: true,
        row: {
          id: itemId,
          name: patch.name ?? item.name,
          weightGrams: patch.weightGrams ?? item.weightGrams,
          quantity: patch.quantity ?? item.quantity,
          sortOrder: item.sortOrder,
          // From the write's RETURNING when it landed (the moved-to rank is
          // computed inside the statement and unknowable beforehand); the
          // pre-read row covers the vanished-concurrently case, where the
          // stale values are as good as answers get.
          isPacked: updated?.isPacked ?? item.isPacked,
          isReady: updated?.isReady ?? item.isReady,
          packingLocationId:
            updated !== undefined
              ? updated.packingLocationId
              : item.packingLocationId,
          packSortOrder: updated?.packSortOrder ?? item.packSortOrder,
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
   * It deliberately does NOT filter on `needed`. An earlier version did, which
   * looked like defence in depth but was really a second, weaker copy of a rule
   * the database already enforces: the read cannot see a prune that commits
   * before the insert, so it was never the guarantee. The
   * list_food_item_slots_needed_only trigger is the single enforcement point,
   * and both write paths map its abort to the same 400 - which also means the
   * API tests exercise the real mechanism rather than a precheck standing in
   * front of it.
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

// 90 ids would be 90 bound params plus the two scoping predicates; chunk well
// under D1's 100.
function chunkIds(ids: string[]): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += 80) out.push(ids.slice(i, i + 80))
  return out
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
