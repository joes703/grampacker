import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { GearStatus } from '../../shared/gear'
import type { Db } from '../db'
import { categories, gearItems } from '../db/schema'

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

// The trigger's RAISE(ABORT) text arrives wrapped (DrizzleQueryError ->
// D1_ERROR -> the SQLite message). Match ONLY the root cause: the outer
// DrizzleQueryError message embeds the bound params, so matching any link
// in the chain would let user-controlled text (an item literally named
// 'gear item cap exceeded') misclassify an unrelated insert failure as the
// cap (Codex finding, PR #14). The raw SQLite message never embeds values,
// and requiring the trigger's constraint marker pins it to RAISE(ABORT).
// Exported for the false-positive/true-positive unit tests; the live
// 501st-item test pins the REAL error shape workerd produces.
export function isCapError(err: unknown): boolean {
  let root: unknown = err
  while (root instanceof Error && root.cause instanceof Error) {
    root = root.cause
  }
  return (
    root instanceof Error &&
    root.message.includes('gear item cap exceeded') &&
    root.message.includes('SQLITE_CONSTRAINT_TRIGGER')
  )
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
