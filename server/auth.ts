import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from '@better-auth/passkey'
import { createDb } from './db'
import { createEmailSender } from './email'
import { createUsersRepo } from './repos/users'
import { MIN_PASSWORD_LENGTH } from '../shared/auth'

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
    emailAndPassword: {
      enabled: true,
      // The real password-length gate. Client forms mirror this constant so
      // their validation can't drift from what the server accepts.
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // Public signup: unverified accounts must be inert (decision 13.2).
      requireEmailVerification: true,
      // A password reset is a recovery from a possibly-compromised credential,
      // so every existing session for that user must die with the old password.
      // Sessions are 30-day sliding (see below), so without this an attacker
      // holding a stolen session cookie would keep access straight through the
      // legitimate owner's reset. better-auth only revokes on reset when this
      // is set (see reset-password route); default is to leave sessions live.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        await email.send({
          to: user.email,
          subject: 'Reset your grampacker password',
          html: `<p>Reset your grampacker password: <a href="${url}">${url}</a></p><p>If you did not request this, ignore this email.</p>`,
          text: `Reset your grampacker password: ${url}\n\nIf you did not request this, ignore this email.`,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await email.send({
          to: user.email,
          subject: 'Verify your grampacker email',
          html: `<p>Confirm your grampacker account: <a href="${url}">${url}</a></p>`,
          text: `Confirm your grampacker account: ${url}`,
        })
      },
    },
    // Data minimization: grampacker never collects or stores a display
    // name (2026-07-09). better-auth's user model requires the column and
    // its sign-up/update endpoints accept a `name` field from any client,
    // so blank it at this single choke point instead of trusting every
    // client surface to omit it. The SPA's sign-up form has no name field
    // and sends '' already; these hooks make that a server guarantee.
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
      // Settings > Danger zone. Password-gated account deletion: the client
      // always sends the current password, which better-auth verifies
      // (INVALID_PASSWORD on mismatch) before deleting. No
      // sendDeleteAccountVerification, so the delete is immediate rather than
      // an emailed-token round-trip. internalAdapter.deleteUser only removes
      // session/account/user rows directly; the user's actual data (passkey,
      // categories, gear_items, lists, list_items) is wiped by the ON DELETE
      // CASCADE from user.id (see server/db/app-schema.ts). That total-erasure
      // cascade is covered by server/auth-delete-user.test.ts.
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
        beforeDelete: async (deleted: { id: string }) => {
          await createUsersRepo(db, deleted.id).purgeVerificationArtifacts()
        },
      },
    },
    session: {
      // Generous on purpose: no sensitive data (decision 13.2).
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // sliding: refresh the expiry at most daily
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
                  'This device did not verify it was you. Use your screen lock, PIN, or biometric, or sign in with your password.',
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
