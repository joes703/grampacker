import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../db'
import {
  categories,
  foodPackState,
  foodPlans,
  gearItems,
  listItems,
  lists,
} from '../db/schema'
import { isForeignKeyViolation, isTriggerAbort, isUniqueViolation } from './db-errors'
import {
  buildPlanCopyStatements,
  chunkForParamCap,
  isFoodPlanCapError,
  readPlanGraph,
} from './food-plan-copy'
import { isCapError as isGearCapError } from './gear-items'
import { isListItemCapError } from './list-items'

const cols = {
  id: lists.id,
  name: lists.name,
  description: lists.description,
  slug: lists.slug,
  foodPlanId: lists.foodPlanId,
  isShared: lists.isShared,
  groupWorn: lists.groupWorn,
  readyChecksEnabled: lists.readyChecksEnabled,
  isDraft: lists.isDraft,
  sortOrder: lists.sortOrder,
  createdAt: lists.createdAt,
  updatedAt: lists.updatedAt,
}

export type ListRow = {
  id: string
  name: string
  description: string | null
  slug: string
  foodPlanId: string | null
  isShared: boolean
  groupWorn: boolean
  readyChecksEnabled: boolean
  isDraft: boolean
  sortOrder: number
  createdAt: number // epoch ms
  updatedAt: number // epoch ms
}

// PATCH semantics: undefined = unchanged, null = clear (nullable fields).
export type UpdateListPatch = {
  name?: string
  description?: string | null
  isShared?: boolean
  groupWorn?: boolean
  readyChecksEnabled?: boolean
  isDraft?: boolean
}

export type ListWriteResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'cap_exceeded' | 'not_found' }

// Attaching a food plan can fail three ways: the list is not the caller's
// (not_found), the referenced plan is not the caller's / no longer exists
// (invalid_plan -> 400), or the plan already backs another list
// (plan_in_use -> 409; a plan is per-trip, reuse is duplication). Detaching
// only ever fails not_found.
export type AttachFoodPlanResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'not_found' | 'invalid_plan' | 'plan_in_use' }

// Duplicating a list can trip TWO caps: its own (100 lists/user), and - when
// the source has a food plan, whose graph the duplicate must copy - the food
// plan cap (100 plans/user). One reason cannot truthfully name both, so the
// plan trigger gets its own.
export type DuplicateListResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'cap_exceeded' | 'plan_cap_exceeded' | 'not_found' }

export type FromSelectionResult =
  | { ok: true; row: ListRow }
  | { ok: false; reason: 'cap_exceeded' | 'invalid_gear' }

export type ImportListCategoryInput = { tempId: string; name: string }

export type ImportListGearInput = {
  tempId: string
  name: string
  description: string | null
  weightGrams: number
  category:
    | { kind: 'existing'; id: string }
    | { kind: 'new'; tempId: string }
    | null
}

export type ImportListItemInput = {
  gear: { kind: 'existing'; id: string } | { kind: 'new'; tempId: string }
  quantity: number
  isWorn: boolean
  isConsumable: boolean
  sortOrder: number
}

export type ImportListResult =
  | { ok: true; row: ListRow }
  | {
      ok: false
      reason:
        | 'cap_exceeded' // list cap (100 per user)
        | 'gear_cap_exceeded' // gear inventory cap (500 per user)
        | 'item_cap_exceeded' // list item cap (300; unreachable while the DTO max matches, kept as the trigger backstop)
        | 'invalid_category'
        | 'invalid_gear'
    }

// The 0004 trigger is the single enforcement point; keep in lockstep
// with its WHEN clause and message (same discipline as GEAR_ITEM_CAP).
export const LIST_CAP = 100

export function isListCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'list cap exceeded')
}

const SLUG_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
// A fresh slug colliding twice is already ~1-in-2^71; five failures in a
// row means something is broken, not unlucky - throw and let it 500.
const SLUG_ATTEMPTS = 5

// 6-char base62 share slug, minted server-side (the old repo generated
// client-side and retried on 23505; server-side removes that trust).
// b % 62 carries a tiny modulo bias (256 = 4*62 + 8); acceptable for a
// share URL - effective entropy stays ~35.7 of 35.8 bits.
export function generateSlug(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % 62]).join('')
}

// "(copy)" suffix must not push the name past the 256 CHECK; the old
// Postgres RPC had the same latent overflow, fixed here rather than
// ported. Shared with the food-plans repo's duplicate() - both tables
// carry the same 256 CHECK, and two truncation rules would drift.
export function copyName(name: string): string {
  return `${name.slice(0, 249)} (copy)`
}

export function createListsRepo(db: Db, userId: string) {
  // Owned-set membership, not inArray over the input: D1 caps bound
  // parameters at 100 per query and the reorder DTO allows LIST_CAP (100)
  // ids - which with userId is already 101 params (see chunk-ids.ts). The
  // list cap bounds the scan at 100 rows.
  async function ownsAllListIds(ids: string[]): Promise<boolean> {
    const ownedRows = await db
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.userId, userId))
    const owned = new Set(ownedRows.map((r) => r.id))
    return ids.every((id) => owned.has(id))
  }

  function nextSortOrder() {
    return sql`coalesce((select max(${lists.sortOrder}) + 1 from ${lists} where ${lists.userId} = ${userId}), 0)`
  }

  return {
    async list(): Promise<ListRow[]> {
      return db
        .select(cols)
        .from(lists)
        .where(eq(lists.userId, userId))
        .orderBy(asc(lists.sortOrder), asc(lists.name))
    },

    async create(name: string): Promise<ListWriteResult> {
      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
        const now = Date.now()
        try {
          const [row] = await db
            .insert(lists)
            .values({
              id: crypto.randomUUID(),
              userId,
              name,
              slug: generateSlug(),
              sortOrder: nextSortOrder(),
              createdAt: now,
              updatedAt: now,
            })
            .returning(cols)
          if (!row) throw new Error('list insert returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isUniqueViolation(err, 'lists.slug')) continue
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          throw err
        }
      }
      throw new Error('slug generation exhausted retries')
    },

    async update(id: string, patch: UpdateListPatch): Promise<ListWriteResult> {
      const set: Record<string, unknown> = { updatedAt: Date.now() }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.description !== undefined) set.description = patch.description
      if (patch.isShared !== undefined) set.isShared = patch.isShared
      if (patch.groupWorn !== undefined) set.groupWorn = patch.groupWorn
      if (patch.readyChecksEnabled !== undefined)
        set.readyChecksEnabled = patch.readyChecksEnabled
      if (patch.isDraft !== undefined) set.isDraft = patch.isDraft
      const [row] = await db
        .update(lists)
        .set(set)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .returning(cols)
      return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
    },

    // Attach a food plan to a list - a LIVE REFERENCE (design 2.1/3), not a
    // copy: editing the plan re-projects this list on next read. Setting
    // food_plan_id is the whole operation, and it replaces whatever plan the
    // list had (last write wins on the LIST side). The plan must be the
    // caller's AND not already backing a DIFFERENT list (one plan per trip -
    // reuse is duplication): both are prechecked for friendly errors, with
    // the composite (food_plan_id, user_id) FK and the partial unique index
    // lists_food_plan_id_unique as the structural backstops against a plan
    // deleted / grabbed between the precheck and the write. Re-attaching the
    // plan a list already holds is a no-op success (updating a row to its own
    // value cannot collide with itself).
    //
    // The same batch clears this list's food_pack_state when the link
    // CHANGES (design 6, rule 1 - "clear on relink"): plan B may contain the
    // same food as plan A, and a surviving checkmark would render pre-checked
    // under a plan the user never packed for. Gated on the link actually
    // moving, because a no-op re-attach of the SAME plan (picker
    // double-click, retry) must not wipe a half-finished packing session.
    // The clear runs BEFORE the update - afterwards the old link is gone and
    // the gate could no longer tell a change from a no-op.
    async attachFoodPlan(
      id: string,
      foodPlanId: string,
    ): Promise<AttachFoodPlanResult> {
      // List ownership first: a list the caller cannot see is 404 no matter
      // what shape the plan side is in (authz-matrix "own list or 404" - the
      // plan prechecks must not outrank it).
      const [target] = await db
        .select({ id: lists.id })
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .limit(1)
      if (!target) return { ok: false, reason: 'not_found' }
      const [plan] = await db
        .select({ id: foodPlans.id })
        .from(foodPlans)
        .where(and(eq(foodPlans.id, foodPlanId), eq(foodPlans.userId, userId)))
        .limit(1)
      if (!plan) return { ok: false, reason: 'invalid_plan' }
      const [holder] = await db
        .select({ id: lists.id })
        .from(lists)
        .where(
          and(
            eq(lists.foodPlanId, foodPlanId),
            eq(lists.userId, userId),
            ne(lists.id, id),
          ),
        )
        .limit(1)
      if (holder) return { ok: false, reason: 'plan_in_use' }
      try {
        // `is not` is SQLite's null-safe inequality: a null current link
        // (first attach after a detach) counts as a change too - clearing an
        // already-empty set is harmless, and rule 1 stays "any move clears".
        // (Builder + raw where, not db.run: raw queries cannot batch on D1 -
        // see toggleFoodPack. Unqualified columns here are food_pack_state's
        // own; the subquery's are hand-aliased.)
        const clearOnRelink = db.delete(foodPackState).where(
          sql`list_id = ${id} and user_id = ${userId}
             and exists (
               select 1 from lists l
                where l.id = ${id} and l.user_id = ${userId}
                  and l.food_plan_id is not ${foodPlanId}
             )`,
        )
        const [, [row]] = await db.batch([
          clearOnRelink,
          db
            .update(lists)
            .set({ foodPlanId, updatedAt: Date.now() })
            .where(and(eq(lists.id, id), eq(lists.userId, userId)))
            .returning(cols),
        ])
        return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
      } catch (err) {
        // Race backstops behind the prechecks above: another list grabbed the
        // plan between precheck and write (the unique index fires), or the
        // plan was deleted (the FK fires).
        if (isUniqueViolation(err, 'lists.food_plan_id')) {
          return { ok: false, reason: 'plan_in_use' }
        }
        if (isForeignKeyViolation(err)) {
          return { ok: false, reason: 'invalid_plan' }
        }
        throw err
      }
    },

    // Detach: null the pointer. The trip is untouched; only the food link
    // goes - and the checkmarks go with it (design 6, rule 1): pack state is
    // meaningless without a plan, and clearing here is what lets a later
    // re-attach start honestly unpacked. Unconditional, unlike attach's
    // gated clear: a detach always moves the link (nulling an already-null
    // link touches no pack rows because rule 1 already cleared them). The
    // delete is scoped by user_id, so a foreign list id can never clear
    // anything (own pack rows only ever cite own lists via the composite FK).
    async detachFoodPlan(id: string): Promise<ListWriteResult> {
      const [, [row]] = await db.batch([
        db
          .delete(foodPackState)
          .where(
            and(eq(foodPackState.listId, id), eq(foodPackState.userId, userId)),
          ),
        db
          .update(lists)
          .set({ foodPlanId: null, updatedAt: Date.now() })
          .where(and(eq(lists.id, id), eq(lists.userId, userId)))
          .returning(cols),
      ])
      return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
    },

    // The food packing checklist's state (design 6): rows in food_pack_state
    // keyed (list_id, food_item_id), presence meaning packed.
    async getFoodPackState(id: string): Promise<string[] | null> {
      const [owned] = await db
        .select({ id: lists.id })
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .limit(1)
      if (!owned) return null
      const rows = await db
        .select({ foodItemId: foodPackState.foodItemId })
        .from(foodPackState)
        .where(
          and(eq(foodPackState.listId, id), eq(foodPackState.userId, userId)),
        )
      return rows.map((r) => r.foodItemId)
    },

    // The pack toggle, a compare-and-swap on the plan link the client
    // observed (design 6, rule 3). "Is the food in the list's CURRENT plan"
    // is not sufficient - two plans can contain the same food, so a stale
    // toggle from before a plan switch would pass that check and write a
    // phantom checkmark. The gate therefore requires food_plan_id to equal
    // the expectation, in BOTH directions: an ungated unpack has the mirror
    // bug (a delayed old-plan request deletes a checkmark made under the new
    // plan). A failed gate matches zero rows and reports applied:false - the
    // click lost to a plan switch, which is an outcome, not an error.
    //
    // The write and the gate are hand-written SQL: the pack gate correlates
    // lists with food_plan_entries inside one subquery, which is exactly
    // where drizzle renders sql`` column refs unqualified (AGENTS.md trap) -
    // hand-qualified aliases + the wire assertions in food-pack.test.ts
    // remove the question. ON CONFLICT DO NOTHING makes a pack retry
    // idempotent, and `applied` reads the GATE, not rows-written, so that
    // retry reports applied:true (rows-written would tell the client to roll
    // back a truthful tick). Both statements share one db.batch (a D1
    // transaction), so the gate the response reports is the gate the write
    // saw.
    async toggleFoodPack(
      id: string,
      foodItemId: string,
      packed: boolean,
      expectedFoodPlanId: string,
    ): Promise<{ ok: false } | { ok: true; applied: boolean }> {
      const [owned] = await db
        .select({ id: lists.id })
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .limit(1)
      if (!owned) return { ok: false }
      // Packing additionally requires the food to be IN the expected plan
      // (also what keeps a foreign food id out: same-owner FKs mean another
      // user's food can never appear in this user's plan, so the gate is
      // false and the insert never attempts the row). Unpacking needs only
      // the link to match - rule 2 already removed the row if the food left
      // the plan.
      const gate = packed
        ? sql<number>`exists (
            select 1 from lists l
              join food_plan_entries e
                on e.food_plan_id = l.food_plan_id and e.user_id = l.user_id
             where l.id = ${id} and l.user_id = ${userId}
               and e.food_item_id = ${foodItemId}
               and l.food_plan_id = ${expectedFoodPlanId}
          )`
        : sql<number>`exists (
            select 1 from lists l
             where l.id = ${id} and l.user_id = ${userId}
               and l.food_plan_id = ${expectedFoodPlanId}
          )`
      // Builders, not db.run(sql): SQLiteRaw type-checks as batchable but its
      // _prepare() returns itself with no .stmt, so the D1 driver's batch()
      // crashes on it at runtime (drizzle-orm 0.45.2, d1/session.js) - found
      // at the wire, the types lie. insert().select(SQL) renders the select
      // verbatim after the table's column list (definition order: list_id,
      // food_item_id, user_id, created_at), so the WHERE-gated insert-select
      // stays one atomic statement; the WHERE also resolves SQLite's UPSERT
      // parsing ambiguity so ON CONFLICT parses after a SELECT source.
      const write = packed
        ? db
            .insert(foodPackState)
            .select(
              sql`select ${id}, ${foodItemId}, ${userId}, ${Date.now()} where ${gate}`,
            )
            .onConflictDoNothing()
        : db
            .delete(foodPackState)
            .where(
              sql`list_id = ${id} and food_item_id = ${foodItemId} and user_id = ${userId} and ${gate}`,
            )
      const [, gateRows] = await db.batch([
        write,
        // Reads the gate through a one-row select on the list row itself; if
        // the list vanished between the precheck and the batch this returns
        // zero rows and applied degrades to false, which is the truth.
        db
          .select({ gate })
          .from(lists)
          .where(and(eq(lists.id, id), eq(lists.userId, userId))),
      ])
      return { ok: true, applied: (gateRows[0]?.gate ?? 0) === 1 }
    },

    // Reset packed (food side): clear every checkmark on the list. No CAS -
    // an unconditional clear is the same end state rule 1 produces on
    // relink, so there is no wrong plan to protect against.
    async resetFoodPack(id: string): Promise<boolean> {
      const [owned] = await db
        .select({ id: lists.id })
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .limit(1)
      if (!owned) return false
      await db
        .delete(foodPackState)
        .where(
          and(eq(foodPackState.listId, id), eq(foodPackState.userId, userId)),
        )
      return true
    },

    // The composite FK cascades membership rows; gear itself is untouched.
    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .returning({ id: lists.id })
      return rows.length > 0
    },

    // sortOrder ONLY - a reorder must not bump updatedAt (product rule
    // ported from the old repo's sort_order_no_op_preserves_updated_at).
    async reorder(
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      if (!(await ownsAllListIds(updates.map((u) => u.id)))) return false
      const [first, ...rest] = updates.map((u) =>
        db
          .update(lists)
          .set({ sortOrder: u.sortOrder })
          .where(and(eq(lists.id, u.id), eq(lists.userId, userId))),
      )
      if (!first) return true // unreachable: DTO enforces min(1)
      await db.batch([first, ...rest])
      return true
    },

    // Deep copy: name gets "(copy)", every membership row is copied
    // (including packed/ready state - old duplicate_list behavior), and
    // isShared/isDraft deliberately reset to false/true so a copy is
    // never silently public.
    //
    // A plan backs at most one list (lists_food_plan_id_unique), so the plan
    // POINTER cannot be carried over - when the source has a plan, its whole
    // graph is deep-copied (food-plan-copy.ts) and the new list points at the
    // copy. Everything lands in ONE db.batch in FK order (plan graph -> list
    // -> items): a late failure - either cap trigger included - leaves no
    // orphan plan and no half-copied list. Food pack state is NOT copied (it
    // is not keyed by plan, and a duplicate is a different, fully-unpacked
    // trip).
    async duplicate(id: string): Promise<DuplicateListResult> {
      const [source] = await db
        .select(cols)
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.userId, userId)))
        .limit(1)
      if (!source) return { ok: false, reason: 'not_found' }
      const items = await db
        .select({
          gearItemId: listItems.gearItemId,
          quantity: listItems.quantity,
          isWorn: listItems.isWorn,
          isConsumable: listItems.isConsumable,
          isPacked: listItems.isPacked,
          isReady: listItems.isReady,
          sortOrder: listItems.sortOrder,
        })
        .from(listItems)
        .where(and(eq(listItems.listId, id), eq(listItems.userId, userId)))

      // The plan graph is read once, outside the slug-retry loop: a retry
      // re-runs the same copy (nothing committed on a failed batch). Null
      // when the source has no plan - or when the plan vanished between
      // reading the source row and here (plan delete detaches first, so the
      // just-read foodPlanId was already stale); the copy then simply starts
      // detached, the same last-write-wins outcome as losing the race by a
      // moment.
      //
      // ACCEPTED staleness (flagged in review 2026-07-16): if a concurrent
      // request RE-LINKS the source to a different plan between these reads
      // and the batch, the duplicate still copies the plan observed at read
      // time. That is the read-then-write contract this method has always
      // had - the name and the item rows are snapshotted the same way and an
      // item edit in the window is equally invisible - and the result is a
      // coherent copy of a state the source really was in, attached to a
      // fresh plan no other list can hold. Closing it would need a CAS on
      // source.foodPlanId plus a compensating delete for the committed graph;
      // not worth it for "duplicate raced an edit by milliseconds".
      const planGraph =
        source.foodPlanId === null
          ? null
          : await readPlanGraph(db, userId, source.foodPlanId)

      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
        const newId = crypto.randomUUID()
        const newPlanId = crypto.randomUUID()
        const now = Date.now()
        const planStatements =
          planGraph === null
            ? null
            : buildPlanCopyStatements(db, userId, planGraph, {
                newPlanId,
                name: copyName(planGraph.name),
                now,
              })
        const insertList = db
          .insert(lists)
          .values({
            id: newId,
            userId,
            name: copyName(source.name),
            description: source.description,
            slug: generateSlug(),
            foodPlanId: planGraph === null ? null : newPlanId,
            isShared: false,
            groupWorn: source.groupWorn,
            readyChecksEnabled: source.readyChecksEnabled,
            isDraft: true,
            sortOrder: nextSortOrder(),
            createdAt: now,
            updatedAt: now,
          })
          .returning(cols)
        const itemRows = items.map((it) => ({
          id: crypto.randomUUID(),
          userId,
          listId: newId,
          gearItemId: it.gearItemId,
          quantity: it.quantity,
          isWorn: it.isWorn,
          isConsumable: it.isConsumable,
          isPacked: it.isPacked,
          isReady: it.isReady,
          sortOrder: it.sortOrder,
          createdAt: now,
          updatedAt: now,
        }))
        // Multi-row inserts (floor(90/columns) rows each) rather than one
        // statement per item: 300 items is ~43 statements instead of 300,
        // which matters because the whole batch already carries up to ~360
        // plan-copy statements ahead of it.
        const insertItems = chunkForParamCap(itemRows).map((rows) =>
          db.insert(listItems).values(rows),
        )
        try {
          let results: unknown[]
          if (planStatements === null) {
            results = await db.batch([insertList, ...insertItems])
          } else {
            const [planFirst, ...planRest] = planStatements
            results = await db.batch([
              planFirst,
              ...planRest,
              insertList,
              ...insertItems,
            ])
          }
          // The list row's returning() sits right after the plan-copy
          // statements (or first, when there are none).
          const inserted = results[
            planStatements === null ? 0 : planStatements.length
          ] as ListRow[]
          const row = inserted[0]
          if (!row) throw new Error('list duplicate returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isUniqueViolation(err, 'lists.slug')) continue
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          if (isFoodPlanCapError(err)) {
            return { ok: false, reason: 'plan_cap_exceeded' }
          }
          throw err
        }
      }
      throw new Error('slug generation exhausted retries')
    },

    // Atomic CSV list import: new categories, new gear, the list row,
    // and its items land in ONE db.batch (parity with the old app's
    // create_list_with_imported_items RPC - a late failure leaves no
    // orphans). Ownership of every referenced existing category/gear id
    // is checked first via owned-set membership (zero writes on failure;
    // D1's 100-param cap rules out inArray, see chunk-ids.ts). Cap
    // triggers stay the single enforcement points: any abort rolls back
    // the whole import. Batch order is list -> categories -> gear ->
    // items so FK targets always precede their referencing rows and the
    // returning list row stays at index 0 (the duplicate() pattern).
    async importFromCsv(input: {
      name: string
      categories: ImportListCategoryInput[]
      gear: ImportListGearInput[]
      items: ImportListItemInput[]
    }): Promise<ImportListResult> {
      const existingCategoryIds = new Set(
        input.gear.flatMap((g) =>
          g.category?.kind === 'existing' ? [g.category.id] : [],
        ),
      )
      if (existingCategoryIds.size > 0) {
        const ownedRows = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.userId, userId))
        const owned = new Set(ownedRows.map((r) => r.id))
        for (const id of existingCategoryIds) {
          if (!owned.has(id)) return { ok: false, reason: 'invalid_category' }
        }
      }
      const existingGearIds = new Set(
        input.items.flatMap((i) =>
          i.gear.kind === 'existing' ? [i.gear.id] : [],
        ),
      )
      if (existingGearIds.size > 0) {
        const ownedRows = await db
          .select({ id: gearItems.id })
          .from(gearItems)
          .where(eq(gearItems.userId, userId))
        const owned = new Set(ownedRows.map((r) => r.id))
        for (const id of existingGearIds) {
          if (!owned.has(id)) return { ok: false, reason: 'invalid_gear' }
        }
      }

      const newCategories = input.categories.map((c) => ({
        ...c,
        id: crypto.randomUUID(),
      }))
      const categoryIdByTempId = new Map(
        newCategories.map((c) => [c.tempId, c.id]),
      )
      const newGear = input.gear.map((g) => ({ ...g, id: crypto.randomUUID() }))
      const gearIdByTempId = new Map(newGear.map((g) => [g.tempId, g.id]))
      const resolveCategoryId = (
        ref: ImportListGearInput['category'],
      ): string | null => {
        if (ref === null) return null
        if (ref.kind === 'existing') return ref.id
        const id = categoryIdByTempId.get(ref.tempId)
        // Unreachable: the DTO refine rejects unknown tempIds.
        if (!id) throw new Error(`unknown category tempId: ${ref.tempId}`)
        return id
      }
      const resolveGearId = (ref: ImportListItemInput['gear']): string => {
        if (ref.kind === 'existing') return ref.id
        const id = gearIdByTempId.get(ref.tempId)
        if (!id) throw new Error(`unknown gear tempId: ${ref.tempId}`)
        return id
      }

      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
        const newListId = crypto.randomUUID()
        const now = Date.now()
        const insertList = db
          .insert(lists)
          .values({
            id: newListId,
            userId,
            name: input.name,
            slug: generateSlug(),
            sortOrder: nextSortOrder(),
            createdAt: now,
            updatedAt: now,
          })
          .returning(cols)
        // Statements in a batch run sequentially inside one transaction,
        // so each max(sortOrder)+1 subquery sees the rows inserted before
        // it - appended blocks come out contiguous past the existing max.
        const insertCategories = newCategories.map((c) =>
          db.insert(categories).values({
            id: c.id,
            userId,
            name: c.name,
            sortOrder: sql`coalesce((select max(${categories.sortOrder}) + 1 from ${categories} where ${categories.userId} = ${userId}), 0)`,
            createdAt: now,
          }),
        )
        const insertGear = newGear.map((g) =>
          db.insert(gearItems).values({
            id: g.id,
            userId,
            categoryId: resolveCategoryId(g.category),
            name: g.name,
            description: g.description,
            weightGrams: g.weightGrams,
            // The list CSV format carries no cost/purchaseDate; status is
            // app-internal only (same contract as the gear import).
            status: 'active',
            sortOrder: sql`coalesce((select max(${gearItems.sortOrder}) + 1 from ${gearItems} where ${gearItems.userId} = ${userId}), 0)`,
            createdAt: now,
            updatedAt: now,
          }),
        )
        const insertItems = input.items.map((item) =>
          db.insert(listItems).values({
            id: crypto.randomUUID(),
            userId,
            listId: newListId,
            gearItemId: resolveGearId(item.gear),
            quantity: item.quantity,
            isWorn: item.isWorn,
            isConsumable: item.isConsumable,
            // The original CSV row index; dropped empty-name rows leave
            // intentional gaps (old-repo parity).
            sortOrder: item.sortOrder,
            createdAt: now,
            updatedAt: now,
          }),
        )
        try {
          const [inserted] = await db.batch([
            insertList,
            ...insertCategories,
            ...insertGear,
            ...insertItems,
          ])
          const row = inserted[0]
          if (!row) throw new Error('list import returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isUniqueViolation(err, 'lists.slug')) continue
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          if (isGearCapError(err)) {
            return { ok: false, reason: 'gear_cap_exceeded' }
          }
          if (isListItemCapError(err)) {
            return { ok: false, reason: 'item_cap_exceeded' }
          }
          throw err
        }
      }
      throw new Error('slug generation exhausted retries')
    },

    // Gear-page "Create list from selection". All-or-nothing: one
    // non-owned gear id rejects the whole call with zero writes; the
    // batch is a real transaction on D1. Item order follows the array.
    async createFromSelection(
      name: string,
      description: string | null,
      gearItemIds: string[],
    ): Promise<FromSelectionResult> {
      // Owned-set membership, not inArray over the selection: D1 caps
      // bound parameters at 100 per query and the DTO allows up to 300
      // gear ids (see chunk-ids.ts). The gear cap bounds the scan at 500.
      const ownedRows = await db
        .select({ id: gearItems.id })
        .from(gearItems)
        .where(eq(gearItems.userId, userId))
      const owned = new Set(ownedRows.map((r) => r.id))
      if (!gearItemIds.every((id) => owned.has(id))) {
        return { ok: false, reason: 'invalid_gear' }
      }

      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
        const newId = crypto.randomUUID()
        const now = Date.now()
        const insertList = db
          .insert(lists)
          .values({
            id: newId,
            userId,
            name,
            description,
            slug: generateSlug(),
            sortOrder: nextSortOrder(),
            createdAt: now,
            updatedAt: now,
          })
          .returning(cols)
        const insertItems = gearItemIds.map((gearItemId, i) =>
          db.insert(listItems).values({
            id: crypto.randomUUID(),
            userId,
            listId: newId,
            gearItemId,
            sortOrder: i,
            createdAt: now,
            updatedAt: now,
          }),
        )
        try {
          const [inserted] = await db.batch([insertList, ...insertItems])
          const row = inserted[0]
          if (!row) throw new Error('list from-selection returned no row')
          return { ok: true, row }
        } catch (err) {
          if (isUniqueViolation(err, 'lists.slug')) continue
          if (isListCapError(err)) return { ok: false, reason: 'cap_exceeded' }
          throw err
        }
      }
      throw new Error('slug generation exhausted retries')
    },
  }
}
