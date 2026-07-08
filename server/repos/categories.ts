import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { categories, gearItems } from '../db/schema'

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
    async create(name: string): Promise<CategoryRow> {
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
      return row
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
    // SET NULL on the composite FK, so the repo owns the pair. batch() is
    // a transaction on D1: both statements or neither.
    async remove(id: string): Promise<boolean> {
      const [existing] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.userId, userId)))
        .limit(1)
      if (!existing) return false
      await db.batch([
        db
          .update(gearItems)
          .set({ categoryId: null, updatedAt: Date.now() })
          .where(
            and(eq(gearItems.categoryId, id), eq(gearItems.userId, userId)),
          ),
        db
          .delete(categories)
          .where(and(eq(categories.id, id), eq(categories.userId, userId))),
      ])
      return true
    },

    // All-or-nothing: every id must be an owned row (ids are deduped by
    // the DTO) or nothing is written. The per-row updates are additionally
    // user-scoped, so a row deleted between check and batch just updates
    // nothing - no cross-user write is expressible.
    async reorder(
      updates: { id: string; sortOrder: number }[],
    ): Promise<boolean> {
      const ids = updates.map((u) => u.id)
      const owned = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.userId, userId), inArray(categories.id, ids)))
      if (owned.length !== ids.length) return false
      const [first, ...rest] = updates.map((u) =>
        db
          .update(categories)
          .set({ sortOrder: u.sortOrder })
          .where(and(eq(categories.id, u.id), eq(categories.userId, userId))),
      )
      if (!first) return true // unreachable: DTO enforces min(1)
      await db.batch([first, ...rest])
      return true
    },
  }
}
