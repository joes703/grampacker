import { createMiddleware } from 'hono/factory'
import { createAuth } from '../auth'
import { FRESH_AGE_MS } from '../../shared/auth'

// The passkey endpoints that change WHICH CREDENTIALS CAN SIGN IN. They need a
// FRESH session, not merely a valid one.
//
// What this protects: sessions are 30-day sliding, and a passkey planted by a
// session thief OUTLIVES the session - it is permanent, silent access. Removal
// is gated on the same proof so an attacker cannot strip the owner's other
// sign-in methods. Account deletion is gated the same way, natively, by
// better-auth itself (see server/auth.ts user.deleteUser).
//
// "Fresh" = the session was CREATED within freshAge. In a passwordless app the
// only way to create a session is to run a sign-in ceremony, so re-authenticating
// means re-asserting a passkey (or redeeming a magic link) - which is exactly
// the proof we want, and a stronger one than the password prompt it replaces.
// There is no proof table and no POST /api/me/reauth any more: the session row
// IS the proof. (The old fresh_auth table could not survive this change - its
// check inner-joins the `credential` account, so with no password it would
// match nothing and lock the owner out of their own passkeys.)
//
// Deliberately NOT gated:
//   - passkey/update-passkey
//     RENAME. It is a display label. The plugin writes only the `name` column,
//     so it cannot add, remove, or alter a credential - a gate here buys nothing
//     and costs the owner a ceremony.
//   - passkey/generate-authenticate-options, passkey/verify-authentication
//     The SIGN-IN ceremony. The caller is anonymous by definition, so requiring
//     a session - let alone a fresh one - would make passkey sign-in impossible.
//   - passkey/list-user-passkeys
//     A read. Session is sufficient.
//
// Both REGISTER endpoints are listed even though the passkey plugin ALSO mounts
// its own freshSessionMiddleware on them (registration.requireSession defaults
// to true). The redundancy is deliberate: it keeps the whole gate readable in
// one place, and a future flip of a plugin option cannot silently open a hole.
// delete-passkey is the one the plugin does NOT protect, and it is the reason
// this middleware has to exist at all.
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

    // Fail closed on an unparseable timestamp rather than treating it as fresh.
    const createdAt = new Date(session.session.createdAt).getTime()
    if (Number.isNaN(createdAt) || Date.now() - createdAt >= FRESH_AGE_MS) {
      return c.json(
        {
          code: 'REAUTH_REQUIRED',
          message: 'Confirm it is you before changing your passkeys.',
        },
        403,
      )
    }
    return next()
  },
)
