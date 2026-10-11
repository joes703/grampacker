import { and, asc, eq, sql } from 'drizzle-orm'
import { runBatch, type Db } from '../db'
import { categories, gearItems, listFoodItems, listItems, lists } from '../db/schema'
import {
  isAnyUniqueViolation,
  isForeignKeyViolation,
  isPackRankRangeError,
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

export function createListItemsRepo(db: Db, userId: string) {
  // Builders, not awaited reads: the FK-recovery path batches them so its
  // probes are one consistent snapshot. The precheck path awaits the same
  // builders, which is what keeps precheck and recovery from drifting apart.
  function listProbe(listId: string) {
    return db
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
      .limit(1)
  }

  function gearProbe(gearItemId: string) {
    return db
      .select({ id: gearItems.id })
      .from(gearItems)
      .where(and(eq(gearItems.id, gearItemId), eq(gearItems.userId, userId)))
      .limit(1)
  }

  async function ownsList(listId: string): Promise<boolean> {
    const [row] = await listProbe(listId)
    return Boolean(row)
  }

  function nextItemSortOrder(listId: string) {
    return sql`coalesce((select max(${listItems.sortOrder}) + 1 from ${listItems} where ${listItems.listId} = ${listId} and ${listItems.userId} = ${userId}), 0)`
  }

  // The pack rank a row takes when it ARRIVES in a cohort: one past the
  // cohort's current UNION maximum (gear and food together - the bag's
  // contents are the union since 0022; see pack-reorder.ts). Cohort-scoped,
  // not list-scoped - a list-wide maximum would make a location's orphans
  // interleave into Unassigned by ranks that mean nothing to the user.
  //
  // Worn rows are counted. They render outside the packing tree but keep their
  // rank reserved, so excluding them here would let an arrival land on a slot a
  // worn row will come back to.
  function nextPackSortOrderInCohort(
    listId: string,
    locationId: string | null,
  ) {
    return nextUnionPackRank(listId, userId, locationId)
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
      // FK recovery below: SQLite's FOREIGN KEY error never names the failed
      // constraint, so on one the prechecked parents are RE-PROBED - in one
      // batch, list before gear - and only a parent proven gone maps to its
      // precheck's result. An FK no probe explains rethrows: a programming
      // defect must stay a loud 500, not impersonate bad client input.
      try {
        const [item] = await db
          .insert(listItems)
          .values({
            id: crypto.randomUUID(),
            userId,
            listId,
            gearItemId,
            sortOrder: nextItemSortOrder(listId),
            // A new item is Unassigned, so its pack rank comes from that
            // cohort - independently of the document rank. Copying sortOrder
            // here would drop it into the MIDDLE of pack order once the two
            // sequences have diverged.
            packSortOrder: nextPackSortOrderInCohort(listId, null),
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
        // 0019's range trigger: this cohort's rank space is exhausted, so the
        // `max + 1` an arrival computes would step past PACK_RANK_MAX. A known
        // condition, so it gets a status rather than a 500.
        if (isPackRankRangeError(err)) {
          return { ok: false, reason: 'pack_rank_exhausted' }
        }
        if (isForeignKeyViolation(err)) {
          const [listRows, gearRows] = await runBatch(db, [
            listProbe(listId),
            gearProbe(gearItemId),
          ])
          if (!listRows[0]) return { ok: false, reason: 'list_not_found' }
          if (!gearRows[0]) return { ok: false, reason: 'invalid_gear' }
          throw err
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
          // Unassigned cohort, same as addExisting. Note this runs inside the
          // same batch as the gear insert, so both subqueries see the
          // pre-batch state - which is correct, since neither row exists yet.
          packSortOrder: nextPackSortOrderInCohort(listId, null),
          createdAt: now,
          updatedAt: now,
        })
        .returning(itemCols)
      try {
        const [gearRows, itemRows] = await runBatch(db, [insertGear, insertItem])
        const gear = gearRows[0]
        const item = itemRows[0]
        if (!gear || !item) throw new Error('quick-add returned no rows')
        return { ok: true, row: { item, gear } }
      } catch (err) {
        // 0019's range trigger: this cohort's rank space is exhausted, so the
        // `max + 1` an arrival computes would step past PACK_RANK_MAX. A known
        // condition, so it gets a status rather than a 500.
        if (isPackRankRangeError(err)) {
          return { ok: false, reason: 'pack_rank_exhausted' }
        }
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
    // this user, or the call 404s (AGENTS.md Invariants). The
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
        // A move rebases the PACK rank and nothing else. It used to rebase
        // sortOrder, which is the bug this column exists to kill: sortOrder is
        // the document order, read by List view and by the anonymous share, so
        // dropping an item into a bag walked it to the bottom of the list you
        // had written AND to the bottom of the link you had shared. Moving
        // something inside your pack is not an edit to your document.
        //
        // The row still lands LAST in its destination, exactly like a newly
        // added one - the outcome stays statable in one sentence, it is just
        // scoped to the bag now instead of the whole list.
        //
        // The "did the location actually change?" test lives INSIDE the
        // statement rather than being decided from the `current` row read
        // above. That read happens in a separate query, so comparing against
        // it would decide on state that another write could already have
        // moved on from - and a re-assignment to the location an item is
        // ALREADY in would then walk it to the bottom of its own bag. `IS`
        // rather than `=` because the target may be null (Unassigned), and
        // `=` is never true against null in SQL.
        //
        // Appending needs no two-phase write: it claims a rank above the
        // destination cohort's maximum, which by definition no live row holds.
        // If a concurrent move claims the same rank first, the unique index
        // rejects this one and the route answers 409.
        set.packSortOrder = sql`case
          when ${listItems.packingLocationId} is ${patch.packingLocationId}
          then ${listItems.packSortOrder}
          else ${nextPackSortOrderInCohort(listId, patch.packingLocationId)}
        end`
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
      // Moving into a cohort computes `max + 1`, which 0019's range trigger
      // refuses once that cohort sits at PACK_RANK_MAX. 0019 normalizes any
      // pre-existing dirty cohort so this needs about a billion arrivals to
      // reach, but an unclassified trigger abort here would be a 500, and this
      // condition is understood well enough to deserve a status.
      let item: ListItemRow | undefined
      try {
        ;[item] = await db
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
      } catch (err) {
        if (isPackRankRangeError(err)) {
          return { ok: false, reason: 'pack_rank_exhausted' }
        }
        // The rank collision the comment above promises a 409 for. The only
        // unique constraint this statement can trip is the pack-rank index,
        // so any unique violation here IS a lost race; the route answers 409
        // and the client refetches. (The rank subquery runs inside the
        // statement, so on a single serialized D1 this is defensive depth -
        // but "defensive" beats the 500 it used to be.)
        if (isAnyUniqueViolation(err)) {
          return { ok: false, reason: 'conflict' }
        }
        throw err
      }
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
      await runBatch(db, [first, ...rest])
      return true
    },

    // Pack-mode resets. Only touches rows where the flag is set, so an
    // untouched item's updatedAt stays honest. Food is cleared in the same
    // batch: "start packing over" means the whole pack, and a reset that
    // left food checked would be a lie the UI repeats.
    async resetPacked(listId: string): Promise<boolean> {
      if (!(await ownsList(listId))) return false
      const now = Date.now()
      await runBatch(db, [
        db
          .update(listItems)
          .set({ isPacked: false, updatedAt: now })
          .where(
            and(
              eq(listItems.listId, listId),
              eq(listItems.userId, userId),
              eq(listItems.isPacked, true),
            ),
          ),
        db
          .update(listFoodItems)
          .set({ isPacked: false, updatedAt: now })
          .where(
            and(
              eq(listFoodItems.listId, listId),
              eq(listFoodItems.userId, userId),
              eq(listFoodItems.isPacked, true),
            ),
          ),
      ])
      return true
    },

    async resetReady(listId: string): Promise<boolean> {
      if (!(await ownsList(listId))) return false
      const now = Date.now()
      await runBatch(db, [
        db
          .update(listItems)
          .set({ isReady: false, updatedAt: now })
          .where(
            and(
              eq(listItems.listId, listId),
              eq(listItems.userId, userId),
              eq(listItems.isReady, true),
            ),
          ),
        db
          .update(listFoodItems)
          .set({ isReady: false, updatedAt: now })
          .where(
            and(
              eq(listFoodItems.listId, listId),
              eq(listFoodItems.userId, userId),
              eq(listFoodItems.isReady, true),
            ),
          ),
      ])
      return true
    },
  }
}
