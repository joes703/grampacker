import { and, asc, eq, inArray } from 'drizzle-orm'
import { appendSortOrder } from './append-sort-order'
import type { GearStatus } from '../../shared/gear'
import type { Db, Tx } from '../db'
import { categories, gearItems } from '../db/schema'
import { isTriggerAbort } from './db-errors'
import { isCategoryCapError } from './categories'

const cols = {
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

export type GearItemRow = {
  id: string
  categoryId: string | null
  name: string
  description: string | null
  weightGrams: number
  costCents: number | null
  purchaseDate: string | null
  status: string // constrained by the DB CHECK; DTO narrows to GearStatus
  sortOrder: number
  createdAt: number // epoch ms
  updatedAt: number // epoch ms
}

export type CreateGearItemInput = {
  name: string
  description: string | null
  weightGrams: number
  categoryId: string | null
  costCents: number | null
  purchaseDate: string | null
  status: GearStatus
}

export type ImportGearCategoryInput = { tempId: string; name: string }

export type ImportGearItemInput = {
  name: string
  description: string | null
  weightGrams: number
  costCents: number | null
  purchaseDate: string | null
  category:
    | { kind: 'existing'; id: string }
    | { kind: 'new'; tempId: string }
    | null
}

export type ImportGearResult =
  | { ok: true; createdCategories: number; createdItems: number }
  | {
      ok: false
      reason: 'invalid_category' | 'cap_exceeded' | 'category_cap_exceeded'
    }

// PATCH semantics: undefined = unchanged, null = clear (nullable fields).
export type UpdateGearItemPatch = {
  name?: string
  description?: string | null
  weightGrams?: number
  categoryId?: string | null
  costCents?: number | null
  purchaseDate?: string | null
  status?: GearStatus
}

// Narrowed per method, like RotateShareLinkResult in lists.ts: create
// writes a new row so it can hit the cap but cannot miss an existing one;
// update touches an existing row so it can miss but cannot hit the cap. A
// shared union would let the PATCH route's else-branch mislabel a cap error
// as Not found.
export type CreateGearResult =
  | { ok: true; row: GearItemRow }
  | { ok: false; reason: 'cap_exceeded' | 'invalid_category' }

export type UpdateGearResult =
  | { ok: true; row: GearItemRow }
  | { ok: false; reason: 'invalid_category' | 'not_found' }

// The DB trigger enforces shared/gear.ts's GEAR_ITEM_CAP. A refused insert
// maps to a friendly result without a read-then-insert race.
// Match only the root cause (db-errors.ts); the live cap test proves the
// actual SQLite error shape.
export function isCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'gear item cap exceeded')
}

// Every method that reads before it writes runs its ownership checks, writes
// and response read-back in ONE SQLite transaction on the process's only
// connection, with `behavior: 'immediate'` so the write lock is taken before
// the first read. The callbacks are synchronous, so a category or gear row
// that passes a check still exists when the write runs: a foreign-key
// failure can only be a defect and stays a 500. list and remove are single
// statements and need no explicit transaction.
//
// Bulk id lists reach SQL as one unchunked inArray. That is safe because the
// bulk request schemas cap them at 500 ids (shared/gear.ts), 501 bound
// parameters with the user id; SQLite allows 32766 (server/db/sqlite.test.ts).
export function createGearItemsRepo(db: Db, userId: string) {
  function ownsCategory(tx: Tx, categoryId: string): boolean {
    const row = tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1)
      .get()
    return Boolean(row)
  }

  // Owned-set membership in JS rather than inArray over the input: one query
  // whatever the input size, and the gear cap bounds the scan at 500 rows.
  function ownsAllGearIds(tx: Tx, ids: string[]): boolean {
    const owned = new Set(
      tx
        .select({ id: gearItems.id })
        .from(gearItems)
        .where(eq(gearItems.userId, userId))
        .all()
        .map((r) => r.id),
    )
    return ids.every((id) => owned.has(id))
  }

  return {
    async list(): Promise<GearItemRow[]> {
      return db
        .select(cols)
        .from(gearItems)
        .where(eq(gearItems.userId, userId))
        .orderBy(asc(gearItems.sortOrder), asc(gearItems.name))
    },

    async create(input: CreateGearItemInput): Promise<CreateGearResult> {
      try {
        return db.transaction(
          (tx): CreateGearResult => {
            if (input.categoryId !== null && !ownsCategory(tx, input.categoryId)) {
              return { ok: false, reason: 'invalid_category' }
            }
            const now = Date.now()
            const row = tx
              .insert(gearItems)
              .values({
                id: crypto.randomUUID(),
                userId,
                categoryId: input.categoryId,
                name: input.name,
                description: input.description,
                weightGrams: input.weightGrams,
                costCents: input.costCents,
                purchaseDate: input.purchaseDate,
                status: input.status,
                sortOrder: appendSortOrder(gearItems, gearItems.sortOrder, eq(gearItems.userId, userId)),
                createdAt: now,
                updatedAt: now,
              })
              .returning(cols)
              .get()
            return { ok: true, row }
          },
          { behavior: 'immediate' },
        )
      } catch (err) {
        if (isCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        throw err
      }
    },

    // Atomic CSV import: the ownership check and every write run in ONE
    // transaction. The old app created categories before the gear insert
    // non-atomically, so a mid-flight failure orphaned the categories - here
    // a cap abort on any item rolls back the new categories too. Every
    // referenced existing category must be the caller's, checked before any
    // write. No cap preflight on purpose: the trigger stays the single
    // enforcement point for shared/gear.ts's GEAR_ITEM_CAP.
    async importBatch(input: {
      categories: ImportGearCategoryInput[]
      items: ImportGearItemInput[]
    }): Promise<ImportGearResult> {
      const existingIds = new Set(
        input.items.flatMap((i) =>
          i.category?.kind === 'existing' ? [i.category.id] : [],
        ),
      )
      const newCategories = input.categories.map((c) => ({
        tempId: c.tempId,
        id: crypto.randomUUID(),
        name: c.name,
      }))
      const idByTempId = new Map(newCategories.map((c) => [c.tempId, c.id]))
      const resolveCategoryId = (
        ref: ImportGearItemInput['category'],
      ): string | null => {
        if (ref === null) return null
        if (ref.kind === 'existing') return ref.id
        const id = idByTempId.get(ref.tempId)
        // Unreachable: the DTO refine rejects unknown tempIds.
        if (!id) throw new Error(`unknown category tempId: ${ref.tempId}`)
        return id
      }

      try {
        return db.transaction(
          (tx): ImportGearResult => {
            if (existingIds.size > 0) {
              // Membership against ALL owned category ids: one query
              // whatever the import size, bounded by the category cap.
              const owned = new Set(
                tx
                  .select({ id: categories.id })
                  .from(categories)
                  .where(eq(categories.userId, userId))
                  .all()
                  .map((r) => r.id),
              )
              for (const id of existingIds) {
                if (!owned.has(id)) return { ok: false, reason: 'invalid_category' }
              }
            }

            const now = Date.now()
            // One statement per row, so each max(sortOrder)+1 subquery sees
            // the rows inserted before it - both appended blocks come out
            // contiguous, past the existing max.
            for (const c of newCategories) {
              tx.insert(categories)
                .values({
                  id: c.id,
                  userId,
                  name: c.name,
                  sortOrder: appendSortOrder(categories, categories.sortOrder, eq(categories.userId, userId)),
                  createdAt: now,
                })
                .run()
            }
            for (const item of input.items) {
              tx.insert(gearItems)
                .values({
                  id: crypto.randomUUID(),
                  userId,
                  categoryId: resolveCategoryId(item.category),
                  name: item.name,
                  description: item.description,
                  weightGrams: item.weightGrams,
                  costCents: item.costCents,
                  purchaseDate: item.purchaseDate,
                  // Status is app-internal only; CSV import does not carry it.
                  status: 'active',
                  sortOrder: appendSortOrder(gearItems, gearItems.sortOrder, eq(gearItems.userId, userId)),
                  createdAt: now,
                  updatedAt: now,
                })
                .run()
            }
            return {
              ok: true,
              createdCategories: input.categories.length,
              createdItems: input.items.length,
            }
          },
          { behavior: 'immediate' },
        )
      } catch (err) {
        if (isCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        // An import can carry new categories, so the 0021 category cap can
        // abort it too - everything rolls back, zero partial rows.
        if (isCategoryCapError(err)) {
          return { ok: false, reason: 'category_cap_exceeded' }
        }
        throw err
      }
    },

    async update(
      id: string,
      patch: UpdateGearItemPatch,
    ): Promise<UpdateGearResult> {
      const set: Record<string, unknown> = { updatedAt: Date.now() }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.description !== undefined) set.description = patch.description
      if (patch.weightGrams !== undefined) set.weightGrams = patch.weightGrams
      if (patch.categoryId !== undefined) set.categoryId = patch.categoryId
      if (patch.costCents !== undefined) set.costCents = patch.costCents
      if (patch.purchaseDate !== undefined)
        set.purchaseDate = patch.purchaseDate
      if (patch.status !== undefined) set.status = patch.status
      return db.transaction(
        (tx): UpdateGearResult => {
          if (typeof patch.categoryId === 'string' && !ownsCategory(tx, patch.categoryId)) {
            return { ok: false, reason: 'invalid_category' }
          }
          const row = tx
            .update(gearItems)
            .set(set)
            .where(and(eq(gearItems.id, id), eq(gearItems.userId, userId)))
            .returning(cols)
            .get()
          return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
        },
        { behavior: 'immediate' },
      )
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(gearItems)
        .where(and(eq(gearItems.id, id), eq(gearItems.userId, userId)))
        .returning({ id: gearItems.id })
      return rows.length > 0
    },

    // Bulk ops are all-or-nothing: one non-owned id rejects the whole call
    // with zero writes (stricter than the old RLS silent-skip; the UI never
    // legitimately sends foreign ids).
    async bulkDelete(ids: string[]): Promise<boolean> {
      return db.transaction(
        (tx) => {
          if (!ownsAllGearIds(tx, ids)) return false
          tx.delete(gearItems)
            .where(and(eq(gearItems.userId, userId), inArray(gearItems.id, ids)))
            .run()
          return true
        },
        { behavior: 'immediate' },
      )
    },

    async bulkMove(
      ids: string[],
      categoryId: string | null,
    ): Promise<'ok' | 'invalid_category' | 'not_found'> {
      return db.transaction(
        (tx) => {
          if (categoryId !== null && !ownsCategory(tx, categoryId)) {
            return 'invalid_category'
          }
          if (!ownsAllGearIds(tx, ids)) return 'not_found'
          tx.update(gearItems)
            .set({ categoryId, updatedAt: Date.now() })
            .where(and(eq(gearItems.userId, userId), inArray(gearItems.id, ids)))
            .run()
          return 'ok'
        },
        { behavior: 'immediate' },
      )
    },

    // Same contract as the categories repo's reorder (kept in lockstep;
    // a generic helper costs more in drizzle type gymnastics than the
    // dozen duplicated lines are worth).
    async reorder(
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      return db.transaction(
        (tx) => {
          if (!ownsAllGearIds(tx, updates.map((u) => u.id))) return false
          for (const u of updates) {
            tx.update(gearItems)
              .set({ sortOrder: u.sortOrder })
              .where(and(eq(gearItems.id, u.id), eq(gearItems.userId, userId)))
              .run()
          }
          return true
        },
        { behavior: 'immediate' },
      )
    },
  }
}
