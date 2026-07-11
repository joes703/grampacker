import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import { createDb } from '../db'
import { createFreshAuthRepo } from '../repos/fresh-auth'

// The passkey endpoints that change WHICH CREDENTIALS CAN SIGN IN. Gated on a
// fresh-auth proof (POST /api/me/reauth) before better-auth ever sees the
// request.
//
// What this is actually protecting: sessions are 30-day sliding, and a passkey
// planted by a session thief OUTLIVES the session and SURVIVES a password
// change - it is permanent, silent access. Password change and account
// deletion already demand the password; adding a credential was the last
// remaining path to persistence that did not. Removal is gated on the same
// proof so an attacker cannot strip the owner's other sign-in methods.
//
// Deliberately NOT gated:
//   - passkey/update-passkey
//     RENAME. It is a display label. It cannot add, remove, or alter a
//     credential, so a gate here buys exactly nothing and costs a password
//     prompt. (It WAS gated briefly, on the theory that a rule without
//     exceptions is easier to audit. That is an aesthetic argument dressed up
//     as a security one - friction with no threat behind it.)
//   - passkey/generate-authenticate-options, passkey/verify-authentication
//     The SIGN-IN ceremony. The caller is anonymous by definition, so
//     requiring a session - let alone a password - would make passkey sign-in
//     impossible. (They do write rows: a challenge, and the signature counter.
//     That is sign-in working, not a management action.)
//   - passkey/list-user-passkeys
//     A read. Session is sufficient.
//
// Both REGISTER endpoints are gated, not just the first. Gating only
// generate-register-options would be sound today (verify-registration needs a
// challenge only generate mints), but it would rest the invariant on a plugin
// internal.
const GATED_PATHS = new Set([
  '/api/auth/passkey/generate-register-options',
  '/api/auth/passkey/verify-registration',
  '/api/auth/passkey/delete-passkey',
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
