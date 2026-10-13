import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { categories, gearItems } from '../db/schema'
import { isTriggerAbort } from './db-errors'

// Selected columns are the repo's output contract - user_id stays out of
// handler reach entirely (the client is always self).
const cols = {
  id: categories.id,
  name: categories.name,
  sortOrder: categories.sortOrder,
  createdAt: categories.createdAt,
}

export type CategoryRow = {
  id: string
  name: string
  sortOrder: number
  createdAt: number // epoch ms
}

export type CategoryCreateResult =
  | { ok: true; row: CategoryRow }
  | { ok: false; reason: 'cap_exceeded' }

// The 0021 trigger is the single enforcement point; keep in lockstep with
// its RAISE message and CATEGORY_CAP in shared/gear.ts.
export function isCategoryCapError(err: unknown): boolean {
  return isTriggerAbort(err, 'category cap exceeded')
}

export function createCategoriesRepo(db: Db, userId: string) {
  return {
    async list(): Promise<CategoryRow[]> {
      return db
        .select(cols)
        .from(categories)
        .where(eq(categories.userId, userId))
        .orderBy(asc(categories.sortOrder), asc(categories.name))
    },

    // Server-authoritative sort order: appended at max+1 (the old app
    // trusted a client-computed value; same benign concurrent-create tie
    // race, one less thing for clients to get wrong).
    async create(name: string): Promise<CategoryCreateResult> {
      try {
        const [row] = await db
          .insert(categories)
          .values({
            id: crypto.randomUUID(),
            userId,
            name,
            sortOrder: sql`coalesce((select max(${categories.sortOrder}) + 1 from ${categories} where ${categories.userId} = ${userId}), 0)`,
            createdAt: Date.now(),
          })
          .returning(cols)
        if (!row) throw new Error('category insert returned no row')
        return { ok: true, row }
      } catch (err) {
        if (isCategoryCapError(err)) return { ok: false, reason: 'cap_exceeded' }
        throw err
      }
    },

    async rename(id: string, name: string): Promise<CategoryRow | null> {
      const [row] = await db
        .update(categories)
        .set({ name })
        .where(and(eq(categories.id, id), eq(categories.userId, userId)))
        .returning(cols)
      return row ?? null
    },

    // Deleting a category uncategorizes its gear (the old ON DELETE SET
    // NULL semantics) in the SAME transaction - SQLite cannot column-list
    // SET NULL on the composite FK, so the repo owns the pair. The check,
    // the uncategorize and the delete are one immediate transaction: no gear
    // can be put back into the category between them, and a failure undoes
    // both writes.
    async remove(id: string): Promise<boolean> {
      return db.transaction(
        (tx) => {
          const existing = tx
            .select({ id: categories.id })
            .from(categories)
            .where(and(eq(categories.id, id), eq(categories.userId, userId)))
            .limit(1)
            .get()
          if (!existing) return false
          tx.update(gearItems)
            .set({ categoryId: null, updatedAt: Date.now() })
            .where(and(eq(gearItems.categoryId, id), eq(gearItems.userId, userId)))
            .run()
          tx.delete(categories)
            .where(and(eq(categories.id, id), eq(categories.userId, userId)))
            .run()
          return true
        },
        { behavior: 'immediate' },
      )
    },

    // All-or-nothing: every id must be an owned row (ids are deduped by the
    // DTO) or nothing is written; the check and the writes are one
    // transaction. Owned-set membership in JS rather than inArray over the
    // input: one query whatever the input size, bounded by the category cap.
    async reorder(
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      return db.transaction(
        (tx) => {
          const owned = new Set(
            tx
              .select({ id: categories.id })
              .from(categories)
              .where(eq(categories.userId, userId))
              .all()
              .map((r) => r.id),
          )
          if (!updates.every((u) => owned.has(u.id))) return false
          for (const u of updates) {
            tx.update(categories)
              .set({ sortOrder: u.sortOrder })
              .where(and(eq(categories.id, u.id), eq(categories.userId, userId)))
              .run()
          }
          return true
        },
        { behavior: 'immediate' },
      )
    },
  }
}
