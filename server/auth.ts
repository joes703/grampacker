import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins/magic-link'
import { passkey } from '@better-auth/passkey'
import { createDb } from './db'
import { createEmailSender } from './email'
import { createUsersRepo } from './repos/users'
import { FRESH_AGE_SECONDS, MAGIC_LINK_PATH } from '../shared/auth'

// WebAuthn relying-party id. Must be the serving origin's registrable
// domain (or a suffix of it): grampacker.app for the apex and any
// grampacker.app subdomain, so credentials keep working if the serving
// host ever changes within the zone. Dev stays on localhost.
// Exact-or-dot-boundary match: a bare endsWith would also match
// lookalikes such as evilgrampacker.app. Exported for tests.
export function passkeyRpId(baseUrl: string): string {
  const { hostname } = new URL(baseUrl)
  return hostname === 'grampacker.app' || hostname.endsWith('.grampacker.app')
    ? 'grampacker.app'
    : hostname
}

// Shared between the runtime factory below and the CLI schema config
// (auth-schema.config.ts). Schema-affecting options (adapter provider,
// plugins) MUST live here so the generated tables cannot drift from runtime.
export function authOptions(env: Env) {
  const db = createDb(env.DB)
  const email = createEmailSender(env)

  return {
    database: drizzleAdapter(db, { provider: 'sqlite' as const }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    // NO emailAndPassword. Its absence is load-bearing, not an oversight:
    // better-auth mounts /sign-in/email and /sign-up/email unconditionally and
    // gates them on this option, so leaving it out is what makes them 400
    // (EMAIL_PASSWORD_DISABLED / EMAIL_PASSWORD_SIGN_UP_DISABLED).
    //
    // Dropping sendResetPassword is what disables /request-password-reset
    // (RESET_PASSWORD_DISABLED). This matters more than it looks:
    // /reset-password is NOT gated on `enabled`, and given a still-valid token
    // it will RE-CREATE a credential account for a user who has none. Config
    // alone does not kill the password - the migration that purges reset tokens
    // and credential rows does (docs/passwordless-auth-design.md section 5).

    // Data minimization: grampacker never collects or stores a display
    // name (2026-07-09). better-auth's user model requires the column, and the
    // magic-link plugin - now the only route by which a user is created -
    // accepts an optional `name` in its request body and writes it straight
    // onto the new row. Our client never sends one, but the endpoint is public,
    // so blank it at this single choke point rather than trusting the caller.
    databaseHooks: {
      user: {
        create: {
          before: async (user: Record<string, unknown>) => ({
            data: { ...user, name: '' },
          }),
        },
        update: {
          before: async (user: Record<string, unknown>) =>
            'name' in user ? { data: { ...user, name: '' } } : undefined,
        },
      },
    },
    user: {
      // Settings > Danger zone. FRESHNESS-gated account deletion: the client
      // sends NO password (there is none). better-auth's delete-user route
      // takes either a password or a fresh session, and with the password
      // omitted it enforces session.freshAge below, throwing 400
      // SESSION_EXPIRED when the session is stale. So "re-authenticate to
      // delete your account" means "do a passkey ceremony", which mints a new
      // (fresh) session. No sendDeleteAccountVerification, so the delete is
      // immediate rather than an emailed-token round-trip.
      // internalAdapter.deleteUser only removes session/account/user rows
      // directly; the user's actual data (passkey, categories, gear_items,
      // lists, list_items) is wiped by the ON DELETE CASCADE from user.id (see
      // server/db/app-schema.ts). That total-erasure cascade is covered by
      // server/auth-delete-user.test.ts.
      deleteUser: {
        enabled: true,
        // The cascade cannot reach better-auth's `verification` table (keyed by
        // identifier/value, not user_id), so auth artifacts that embed the user
        // id (password-reset tokens, passkey challenges) would survive the
        // delete. Purge them in BEFORE-delete, not after: better-auth runs this
        // hook after it verifies the password but BEFORE the irreversible
        // internalAdapter.deleteUser (see update-user.mjs delete-user route).
        // So a purge failure aborts the whole delete and the user simply
        // retries - rather than committing the account deletion and THEN failing
        // the response with artifacts still present (the afterDelete hazard).
        // Deleting these rows ahead of the user row is safe: verification has no
        // FK to user, so there is no ordering constraint.
        beforeDelete: async (deleted: { id: string; email: string }) => {
          await createUsersRepo(db, deleted.id).purgeVerificationArtifacts(
            deleted.email,
          )
        },
      },
    },
    session: {
      // Generous on purpose: no sensitive data (decision 13.2).
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // sliding: refresh the expiry at most daily
      // "Sudo mode". A session is FRESH for this long after it was CREATED
      // (better-auth measures from session.createdAt, never updatedAt - so a
      // sliding refresh does NOT re-freshen it). Sensitive actions - enrolling
      // a passkey, deleting one, deleting the account - require a fresh
      // session, and the only way to get one is to run a sign-in ceremony
      // again. In a passwordless app that IS the re-authentication: a passkey
      // assertion (or a magic link) mints a brand-new session.
      //
      // This replaces the bespoke fresh_auth table + POST /api/me/reauth from
      // PR #43, which proved freshness by re-typing a PASSWORD. With no
      // password to type, that mechanism could not work - its query inner-joins
      // the `credential` account, so it would fail CLOSED and lock the owner
      // out of managing their own passkeys.
      //
      // 24h is better-auth's default, chosen deliberately and set explicitly so
      // an upstream default change cannot move it silently. Sessions are 30-day
      // sliding, so the common theft case (an old, long-lived cookie) is STALE
      // on arrival and cannot perform any of the above. Tightening to 1h would
      // only shrink the window for a cookie stolen within a day of sign-in, at
      // the cost of a re-tap during ordinary use.
      //
      // Shared with our own delete-passkey gate (server/middleware/fresh-auth),
      // which better-auth does not protect - one constant, one definition of
      // "fresh".
      freshAge: FRESH_AGE_SECONDS,
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: 'strict' as const,
      },
    },
    rateLimit: {
      // Rate limiting is owned by our middleware
      // (server/middleware/rate-limit.ts) so there is exactly one
      // mechanism, shared with future non-auth routes. Left unset this
      // would silently self-enable in production with per-isolate MEMORY
      // storage - useless on Workers and confusing to debug.
      enabled: false,
    },
    plugins: [
      magicLink({
        // The recovery path, and the way every account is born. Passkeys are
        // the day-to-day credential; this is how you get one in the first place
        // (prove the mailbox, get a session, enroll a passkey into it) and how
        // you get back in on a device that has none.
        //
        // It is therefore the root of trust: whoever controls the mailbox
        // controls the account. That was ALREADY true when a password could be
        // reset by email - this makes it explicit instead of a side door, so it
        // has to be hardened rather than assumed.
        expiresIn: 60 * 5, // 5 minutes (the default, pinned so it is auditable)
        // The plugin default is 'plain': it writes the emailed token into the
        // `verification` table in CLEARTEXT. That token mints a session for any
        // account, so a single leaked DB read (or backup) would be a total
        // compromise. Hashed, the stored copy is useless to an attacker.
        storeToken: 'hashed',
        sendMagicLink: async ({ email: to, token }) => {
          // Deliberately NOT the plugin's `url`. That points straight at
          // GET /api/auth/magic-link/verify, which is SIDE-EFFECTING: it
          // consumes the single-use token, creates the user, and sets a session
          // cookie. Corporate mail scanners and link previewers follow links in
          // email, so one of them would burn the token before the human ever
          // clicked - and the human is, by definition, already locked out.
          //
          // Instead we send them to an SPA page that does nothing on load and
          // verifies only on a real click. A scanner fetching it consumes
          // nothing.
          const url = `${env.BETTER_AUTH_URL}${MAGIC_LINK_PATH}?token=${encodeURIComponent(token)}`
          await email.send({
            to,
            subject: 'Sign in to grampacker',
            html: `<p>Sign in to grampacker: <a href="${url}">${url}</a></p><p>This link works once and expires in 5 minutes. If you did not request it, ignore this email.</p>`,
            text: `Sign in to grampacker: ${url}\n\nThis link works once and expires in 5 minutes. If you did not request it, ignore this email.`,
          })
        },
      }),
      passkey({
        rpID: passkeyRpId(env.BETTER_AUTH_URL),
        rpName: 'grampacker',
        origin: env.BETTER_AUTH_URL,
        // Ask the authenticator to verify the human (screen lock, PIN,
        // biometric) rather than merely prove possession of the credential.
        // WebAuthn's default is 'preferred', which silently degrades to no
        // verification - so the Settings copy ("your device's screen lock or
        // security key") would be a promise the server never checked.
        authenticatorSelection: { userVerification: 'required' },
        // ...and 'required' above is only a REQUEST hint. The plugin
        // hardcodes requireUserVerification: false at both of its
        // verification sites and exposes no option to change it, so a
        // response with the UV flag clear is accepted no matter what we
        // asked for. These hooks are the actual enforcement: they run
        // BEFORE the passkey row is created (registration) and before the
        // counter update and session creation (authentication), so throwing
        // here leaves no partial state behind.
        registration: {
          afterVerification: ({ verification }) => {
            if (!verification.registrationInfo?.userVerified) {
              throw new APIError('BAD_REQUEST', {
                code: 'USER_VERIFICATION_REQUIRED',
                message:
                  'This device did not verify it was you. Enable a screen lock, PIN, or biometric and try again.',
              })
            }
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw new APIError('UNAUTHORIZED', {
                code: 'USER_VERIFICATION_REQUIRED',
                message:
                  'This device did not verify it was you. Use your screen lock, PIN, or biometric, or sign in with an email link instead.',
              })
            }
          },
        },
      }),
    ],
  }
}

// Workers get fresh bindings per request, so the auth instance is built per
// request. This is config wiring only - no I/O happens until a handler runs.
export function createAuth(env: Env) {
  return betterAuth(authOptions(env))
}

export type Auth = ReturnType<typeof createAuth>
