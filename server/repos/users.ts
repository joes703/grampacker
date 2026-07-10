import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { user, verification } from '../db/schema'

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

    // Account deletion's ON DELETE CASCADE (off user.id) wipes the user's
    // content and credentials, but better-auth's `verification` table sits
    // outside that graph: its rows are keyed by identifier/value, not user_id,
    // so nothing removes them when the user goes. Two row shapes that grampacker
    // enables embed the user id and would otherwise linger as auth artifacts of
    // the deleted account until they expire:
    //   - password-reset tokens: `value` is the bare user id.
    //   - passkey register/authenticate challenges: `value` is JSON whose
    //     `$.userData.id` is the user id (the passkey plugin's ceremony state).
    // Purge both. (Email-verification / change-email use signed JWTs, not
    // verification rows, so there is nothing to clean there.) Both predicates
    // key on the unique user id, so this cannot touch another account's rows;
    // json_valid guards the extract so a bare-id value is never mis-parsed.
    async purgeVerificationArtifacts(): Promise<void> {
      await db
        .delete(verification)
        .where(
          sql`${verification.value} = ${userId} OR (json_valid(${verification.value}) AND json_extract(${verification.value}, '$.userData.id') = ${userId})`,
        )
    },
  }
}
