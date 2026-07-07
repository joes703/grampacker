import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { user } from '../db/schema'

// Selected columns are the repo's output contract - private columns stay
// out of handler reach entirely rather than being filtered at the DTO step.
const selfColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt,
}

export type SelfRow = {
  id: string
  name: string
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

    async updateName(name: string): Promise<SelfRow | null> {
      const [row] = await db
        .update(user)
        .set({ name })
        .where(eq(user.id, userId))
        .returning(selfColumns)
      return row ?? null
    },
  }
}
