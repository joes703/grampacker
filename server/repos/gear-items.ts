import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { GearStatus } from '../../shared/gear'
import type { Db } from '../db'
import { categories, gearItems } from '../db/schema'
import { isTriggerAbort } from './db-errors'

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
  | { ok: false; reason: 'invalid_category' | 'cap_exceeded' }

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

export type GearWriteResult =
  | { ok: true; row: GearItemRow }
  | { ok: false; reason: 'cap_exceeded' | 'invalid_category' | 'not_found' }

// The DB trigger in migration 0003 is the SINGLE enforcement point for the
// cap - no read-then-insert race to lose (Codex finding, PR #13). The repo
// maps the trigger's RAISE(ABORT) message to a friendly result; keep this
// constant, the trigger's WHEN clause, and its message in lockstep.
export const GEAR_ITEM_CAP = 500

// Root-cause-only matching rationale lives in db-errors.ts (Codex
// finding, PR #14). Exported for the false-positive/true-positive unit
// tests; the live 501st-item test pins the REAL error shape workerd
// produces.
export function isCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'gear item cap exceeded')
}

export function createGearItemsRepo(db: Db, userId: string) {
  async function ownsCategory(categoryId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.id, categoryId), eq(categories.userId, userId)),
      )
      .limit(1)
    return Boolean(row)
  }

  async function ownsAllGearIds(ids: string[]): Promise<boolean> {
    const owned = await db
      .select({ id: gearItems.id })
      .from(gearItems)
      .where(and(eq(gearItems.userId, userId), inArray(gearItems.id, ids)))
    return owned.length === ids.length
  }

  return {
    async list(): Promise<GearItemRow[]> {
      return db
        .select(cols)
        .from(gearItems)
        .where(eq(gearItems.userId, userId))
        .orderBy(asc(gearItems.sortOrder), asc(gearItems.name))
    },

    async create(input: CreateGearItemInput): Promise<GearWriteResult> {
      if (input.categoryId !== null && !(await ownsCategory(input.categoryId))) {
        return { ok: false, reason: 'invalid_category' }
      }
      const now = Date.now()
      try {
        const [row] = await db
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
            sortOrder: sql`coalesce((select max(${gearItems.sortOrder}) + 1 from ${gearItems} where ${gearItems.userId} = ${userId}), 0)`,
            createdAt: now,
            updatedAt: now,
          })
          .returning(cols)
        if (!row) throw new Error('gear item insert returned no row')
        return { ok: true, row }
      } catch (err) {
        if (isCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        throw err
      }
    },

    // Atomic CSV import: every write lands in ONE db.batch (a real SQLite
    // transaction on D1). The old app created categories before the gear
    // insert non-atomically, so a mid-flight failure orphaned the
    // categories - here a cap abort on any item rolls back the new
    // categories too. Ownership of every referenced existing category is
    // checked first with zero writes on failure. No cap preflight on
    // purpose: the trigger stays the single enforcement point (see
    // GEAR_ITEM_CAP above).
    async importBatch(input: {
      categories: ImportGearCategoryInput[]
      items: ImportGearItemInput[]
    }): Promise<ImportGearResult> {
      const existingIds = [
        ...new Set(
          input.items.flatMap((i) =>
            i.category?.kind === 'existing' ? [i.category.id] : [],
          ),
        ),
      ]
      if (existingIds.length > 0) {
        const owned = await db
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.userId, userId),
              inArray(categories.id, existingIds),
            ),
          )
        if (owned.length !== existingIds.length) {
          return { ok: false, reason: 'invalid_category' }
        }
      }

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

      const now = Date.now()
      // Statements in a batch run sequentially inside one transaction, so
      // each max(sortOrder)+1 subquery sees the rows inserted before it -
      // both appended blocks come out contiguous, past the existing max.
      const statements = [
        ...newCategories.map((c) =>
          db.insert(categories).values({
            id: c.id,
            userId,
            name: c.name,
            sortOrder: sql`coalesce((select max(${categories.sortOrder}) + 1 from ${categories} where ${categories.userId} = ${userId}), 0)`,
            createdAt: now,
          }),
        ),
        ...input.items.map((item) =>
          db.insert(gearItems).values({
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
            sortOrder: sql`coalesce((select max(${gearItems.sortOrder}) + 1 from ${gearItems} where ${gearItems.userId} = ${userId}), 0)`,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      ]
      const [first, ...rest] = statements
      if (!first) {
        // Unreachable: the DTO enforces min(1) items.
        return { ok: true, createdCategories: 0, createdItems: 0 }
      }
      try {
        await db.batch([first, ...rest])
      } catch (err) {
        if (isCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        throw err
      }
      return {
        ok: true,
        createdCategories: input.categories.length,
        createdItems: input.items.length,
      }
    },

    async update(
      id: string,
      patch: UpdateGearItemPatch,
    ): Promise<GearWriteResult> {
      if (
        typeof patch.categoryId === 'string' &&
        !(await ownsCategory(patch.categoryId))
      ) {
        return { ok: false, reason: 'invalid_category' }
      }
      const set: Record<string, unknown> = { updatedAt: Date.now() }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.description !== undefined) set.description = patch.description
      if (patch.weightGrams !== undefined) set.weightGrams = patch.weightGrams
      if (patch.categoryId !== undefined) set.categoryId = patch.categoryId
      if (patch.costCents !== undefined) set.costCents = patch.costCents
      if (patch.purchaseDate !== undefined)
        set.purchaseDate = patch.purchaseDate
      if (patch.status !== undefined) set.status = patch.status
      const [row] = await db
        .update(gearItems)
        .set(set)
        .where(and(eq(gearItems.id, id), eq(gearItems.userId, userId)))
        .returning(cols)
      return row ? { ok: true, row } : { ok: false, reason: 'not_found' }
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
    // legitimately sends foreign ids). Single statements are atomic on
    // their own; no batch needed.
    async bulkDelete(ids: string[]): Promise<boolean> {
      if (!(await ownsAllGearIds(ids))) return false
      await db
        .delete(gearItems)
        .where(and(eq(gearItems.userId, userId), inArray(gearItems.id, ids)))
      return true
    },

    async bulkMove(
      ids: string[],
      categoryId: string | null,
    ): Promise<'ok' | 'invalid_category' | 'not_found'> {
      if (categoryId !== null && !(await ownsCategory(categoryId))) {
        return 'invalid_category'
      }
      if (!(await ownsAllGearIds(ids))) return 'not_found'
      await db
        .update(gearItems)
        .set({ categoryId, updatedAt: Date.now() })
        .where(and(eq(gearItems.userId, userId), inArray(gearItems.id, ids)))
      return 'ok'
    },

    // Same contract as the categories repo's reorder (kept in lockstep;
    // a generic helper costs more in drizzle type gymnastics than the
    // dozen duplicated lines are worth).
    async reorder(
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      if (!(await ownsAllGearIds(updates.map((u) => u.id)))) return false
      const [first, ...rest] = updates.map((u) =>
        db
          .update(gearItems)
          .set({ sortOrder: u.sortOrder })
          .where(and(eq(gearItems.id, u.id), eq(gearItems.userId, userId))),
      )
      if (!first) return true // unreachable: DTO enforces min(1)
      await db.batch([first, ...rest])
      return true
    },
  }
}
