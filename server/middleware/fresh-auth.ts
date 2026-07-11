import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import { createDb } from '../db'
import { createFreshAuthRepo } from '../repos/fresh-auth'

// The passkey endpoints that MUTATE the user's credential set. Gated on a
// fresh-auth proof (POST /api/me/reauth) before better-auth ever sees the
// request - a valid session alone is not enough to plant or remove a
// credential.
//
// The full plugin surface is seven endpoints; these are the four that manage
// passkeys. Deliberately NOT gated:
//   - passkey/generate-authenticate-options, passkey/verify-authentication
//     These are the SIGN-IN ceremony. The caller is anonymous by definition,
//     so requiring a session - let alone a password - would make passkey
//     sign-in impossible. (They do write rows: a challenge, and the signature
//     counter. That is the sign-in flow working, not a management action.)
//   - passkey/list-user-passkeys
//     A read. Session is sufficient.
//
// Both register endpoints are gated, not just the first. Gating only
// generate-register-options would still be sound today (verify-registration
// needs a challenge that only generate mints), but it would leave the
// invariant resting on a plugin internal. The rule stays flat and auditable:
// every passkey mutation requires fresh auth.
const GATED_PATHS = new Set([
  '/api/auth/passkey/generate-register-options',
  '/api/auth/passkey/verify-registration',
  '/api/auth/passkey/delete-passkey',
  '/api/auth/passkey/update-passkey',
])

export const requireFreshAuth = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    if (!GATED_PATHS.has(c.req.path)) return next()

    const session = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    })
    if (!session) return c.json({ error: 'Unauthorized' }, 401)

    const fresh = await createFreshAuthRepo(createDb(c.env.DB)).isFresh(
      session.session.id,
      Date.now(),
    )
    if (!fresh) {
      return c.json(
        {
          code: 'REAUTH_REQUIRED',
          message: 'Confirm your password to manage passkeys.',
        },
        403,
      )
    }
    return next()
  },
)
