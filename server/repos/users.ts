import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { user } from '../db/schema'

// Selected columns are the repo's output contract - private columns stay
// out of handler reach entirely rather than being filtered at the DTO step.
// `name` is deliberately absent: grampacker never collects or stores a
// display name (data-minimization call, 2026-07-09); the better-auth
// databaseHooks in server/auth.ts blank it on every create/update.
const selfColumns = {
  id: user.id,
  email: user.email,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt,
}

export type SelfRow = {
  id: string
  email: string
  emailVerified: boolean
  createdAt: Date
}

export function createUsersRepo(db: Db, userId: string) {
  return {
    async getSelf(): Promise<SelfRow | null> {
      const [row] = await db
        .select(selfColumns)
        .from(user)
        .where(eq(user.id, userId))
      return row ?? null
    },
  }
}
