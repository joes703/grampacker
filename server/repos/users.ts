import { count, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { passkey, user, verification } from '../db/schema'

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

    // How many passkeys this account has. Drives the SPA's "finish setting up
    // your account" prompt, which is why it is counted rather than stored: a
    // flag would drift the moment the last passkey is deleted.
    async passkeyCount(): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(passkey)
        .where(eq(passkey.userId, userId))
      return row?.n ?? 0
    },

    // Account deletion's ON DELETE CASCADE (off user.id) wipes the user's
    // content and credentials, but better-auth's `verification` table sits
    // outside that graph: its rows are keyed by identifier/value, not user_id,
    // so nothing removes them when the user goes. Three row shapes would
    // otherwise linger as live auth artifacts of a deleted account:
    //   - passkey register/authenticate challenges: `value` is JSON whose
    //     `$.userData.id` is the user id (the passkey plugin's ceremony state).
    //   - PENDING MAGIC LINKS: `value` is JSON carrying `$.email`. These do NOT
    //     reference the user id at all, so the user-id predicate cannot see
    //     them - and a surviving one is not inert. Redeeming it after the delete
    //     would CREATE A NEW ACCOUNT on that address (magic-link verify signs up
    //     when no user matches). An empty resurrected account is not a breach,
    //     but "I deleted my account and it came back" is a bug, so purge by
    //     email too.
    //   - LEGACY password-reset tokens: `value` is the bare user id. grampacker
    //     can no longer mint these (no sendResetPassword => the request endpoint
    //     is disabled), but rows created before the passwordless cutover still
    //     exist in production until the teardown migration drops them. Keeping
    //     the predicate costs one clause and means a delete does not have to
    //     depend on that migration having run first.
    // (Email-verification / change-email use signed JWTs, not verification rows,
    // so there is nothing to clean there.) Every predicate keys on a value
    // unique to this account, so none of them can touch another user's rows;
    // json_valid guards each extract so a bare-id value is never mis-parsed.
    async purgeVerificationArtifacts(email: string): Promise<void> {
      await db
        .delete(verification)
        .where(
          sql`${verification.value} = ${userId}
              OR (json_valid(${verification.value}) AND json_extract(${verification.value}, '$.userData.id') = ${userId})
              OR (json_valid(${verification.value}) AND json_extract(${verification.value}, '$.email') = ${email})`,
        )
    },
  }
}
