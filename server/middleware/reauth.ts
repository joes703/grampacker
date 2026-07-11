import { createMiddleware } from 'hono/factory'
import { reauthRequestSchema } from '../../shared/me'
import { createAuth } from '../auth'
import { createDb } from '../db'
import { createFreshAuthRepo } from '../repos/fresh-auth'

// POST /api/me/reauth - exchange the account password for a short-lived
// fresh-auth proof bound to THIS session. Adding or removing a passkey
// requires it (server/middleware/fresh-auth.ts).
//
// Lives in middleware rather than routes/me.ts on purpose: verifying a
// password is a better-auth operation, and the import boundary
// (eslint.config.js) keeps route handlers away from better-auth and the DB.
// Same reason the delete-user password gate sits in the composition root.
//
// Password verification mirrors better-auth's own internal checkPassword:
// find the `credential` account for the user and verify against its stored
// hash. It does NOT invent a second notion of "correct password", and it does
// not re-apply the sign-up length floor - that would reject a password
// predating the floor and read as "wrong password".
//
// Rate limited as a SENSITIVE scope (server/index.ts): this is a
// password-guessing oracle, exactly like change-password and delete-user.
//
// Failures carry BOTH `error` (the /api/* contract in shared/api.ts, which
// the SPA's fetch wrapper reads) and `code` (so the UI can name a wrong
// password precisely instead of showing a generic failure).
export const reauth = createMiddleware<{ Bindings: Env }>(async (c) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'Unauthorized' }, 401)

  const raw: unknown = await c.req.json().catch(() => null)
  const parsed = reauthRequestSchema.safeParse(raw)
  // Uniform failure shape: a malformed body and a wrong password are the same
  // 400 to the client. Nothing here should help an attacker tell them apart.
  if (!parsed.success) {
    return c.json({ error: 'Incorrect password.', code: 'INVALID_PASSWORD' }, 400)
  }

  const ctx = await auth.$context
  const accounts = await ctx.internalAdapter.findAccounts(session.user.id)
  const credential = accounts.find((a) => a.providerId === 'credential')

  // A passkey-only account has no password to confirm. Hash anyway, so this
  // path costs what a real verification costs - otherwise the response time
  // discloses whether the account has a password set.
  if (!credential?.password) {
    await ctx.password.hash(parsed.data.password)
    return c.json({ error: 'Incorrect password.', code: 'INVALID_PASSWORD' }, 400)
  }

  const ok = await ctx.password.verify({
    hash: credential.password,
    password: parsed.data.password,
  })
  if (!ok) {
    return c.json({ error: 'Incorrect password.', code: 'INVALID_PASSWORD' }, 400)
  }

  await createFreshAuthRepo(createDb(c.env.DB)).grant(
    session.session.id,
    session.user.id,
    Date.now(),
  )
  return c.body(null, 204)
})
