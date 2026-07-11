import { and, eq, gt, gte, lt } from 'drizzle-orm'
import type { Db } from '../db'
import { account, freshAuth } from '../db/schema'

// "Sudo mode": a short-lived, server-verified proof that the user re-entered
// their password. ADDING or REMOVING a passkey requires it
// (server/middleware/fresh-auth.ts); renaming, reading, and the passkey
// sign-in ceremony do not.
//
// Why it exists: better-auth's passkey endpoints accept a valid session and
// nothing more. Sessions are 30-day sliding, so a stolen one expires - but a
// passkey planted with it OUTLIVES the session and SURVIVES a password
// change, which is permanent, silent access. Password change and account
// deletion already demand the password; registering a credential was the last
// path to persistence that did not.
//
// 10 minutes: long enough to add a passkey and delete an old one without
// retyping; short enough that a stolen session is unlikely to land inside
// someone else's window.
export const FRESH_AUTH_TTL_MS = 10 * 60 * 1000

// Lifecycle. The proof is keyed by SESSION, so a proof earned in one session
// never authorizes another. The rest is handled by ON DELETE CASCADE on the
// fresh_auth FKs (server/db/app-schema.ts):
//   - sign-out       -> session row deleted  -> proof deleted
//   - account delete -> user's sessions gone -> proofs deleted
//   - password RESET -> revokeSessionsOnPasswordReset deletes the sessions
//                       (server/auth.ts)     -> proofs deleted
// The one case cascades do NOT cover is a password CHANGE, which leaves the
// session intact: revokeForUser handles that explicitly, because a proof
// minted with the OLD password must not survive it (wired in server/index.ts).
//
// Not part of reposForUser: the proof is scoped to a SESSION, and the gate
// that reads it runs on /api/auth/* where there is no user-scoped repo bag.
export function createFreshAuthRepo(db: Db) {
  return {
    async grant(sessionId: string, userId: string, now: number): Promise<void> {
      const expiresAt = now + FRESH_AUTH_TTL_MS
      await db
        .insert(freshAuth)
        .values({ sessionId, userId, expiresAt, grantedAt: now })
        .onConflictDoUpdate({
          target: freshAuth.sessionId,
          // Re-authenticating restarts the window rather than extending the
          // old one; userId is fixed by the session and never changes.
          set: { expiresAt, grantedAt: now },
        })

      // Opportunistic sweep, same pattern as the rate limiter: expired rows
      // are dead weight and nothing else deletes them (the cascades only fire
      // when the session or user goes away). Cheap - this runs only on
      // re-auth, which is rare.
      await db.delete(freshAuth).where(lt(freshAuth.expiresAt, now))
    },

    async isFresh(sessionId: string, now: number): Promise<boolean> {
      // Two conditions, both enforced in SQL - an expired or stale row must
      // never count as a proof, not even for an instant:
      //
      //   1. Not expired.
      //   2. Granted at or after the credential account's last update. A
      //      password change bumps account.updated_at, so a proof minted with
      //      the OLD password fails this test on its own. That makes the gate
      //      fail-CLOSED: revokeForUser (server/index.ts) is the tidy-up, not
      //      the security boundary, so a purge that never ran - or failed -
      //      cannot leave a usable proof behind.
      //
      // The join also means an account with no `credential` row can never be
      // fresh. That is correct and not a lockout: sign-up always sets a
      // password, and an account without one could not re-authenticate anyway.
      const row = await db
        .select({ sessionId: freshAuth.sessionId })
        .from(freshAuth)
        .innerJoin(
          account,
          and(
            eq(account.userId, freshAuth.userId),
            eq(account.providerId, 'credential'),
          ),
        )
        .where(
          and(
            eq(freshAuth.sessionId, sessionId),
            gt(freshAuth.expiresAt, now),
            gte(freshAuth.grantedAt, account.updatedAt),
          ),
        )
        .get()
      return row !== undefined
    },

    // After a successful password change: every proof for this user was earned
    // with the old password. isFresh() already refuses them (granted_at now
    // precedes the account's updated_at), so this is hygiene rather than the
    // control - it keeps dead rows from lingering until they expire.
    async revokeForUser(userId: string): Promise<void> {
      await db.delete(freshAuth).where(eq(freshAuth.userId, userId))
    },
  }
}

export type FreshAuthRepo = ReturnType<typeof createFreshAuthRepo>
