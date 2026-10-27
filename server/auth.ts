import { BASE_ERROR_CODES, betterAuth } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins/magic-link'
import { passkey } from '@better-auth/passkey'
import { createDb, type Db } from './db'
import { createEmailSender } from './email'
import { authLogger } from './middleware/error-handler'
import { chargeMagicLinkGlobalQuota } from './middleware/rate-limit'

import { createUsersRepo } from './repos/users'
import {
  DELETE_ACCOUNT_USER_HEADER,
  FRESH_AGE_SECONDS,
  MAGIC_LINK_PATH,
} from '../shared/auth'
import type { AppEnv } from './env'

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

// The passkey endpoints that may run WITHOUT a fresh session. Everything
// else under /passkey/* - including any endpoint a future plugin version
// adds - gets the freshness gate below, so a new credential-mutating
// endpoint fails CLOSED instead of shipping ungated. The gate lives inside
// better-auth because ctx.path is the RESOLVED endpoint's registered path, so
// no second URL parser can disagree with the router.
//
// Why each entry is open:
//   - generate-authenticate-options, verify-authentication
//     The SIGN-IN ceremony. The caller is anonymous by definition, so
//     requiring a session - let alone a fresh one - would make passkey
//     sign-in impossible.
//   - list-user-passkeys
//     A read. Its own sessionMiddleware is sufficient.
//   - update-passkey
//     RENAME. The plugin writes only the `name` column, so it cannot add,
//     remove, or alter a credential - a gate here buys nothing and costs
//     the owner a ceremony (SECURITY.md "Fresh auth").
const PASSKEY_UNGATED = new Set([
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/passkey/list-user-passkeys',
  '/passkey/update-passkey',
])

// Shared between the runtime factory below and the CLI schema config
// (auth-schema.config.ts). Schema-affecting options (adapter provider,
// plugins) MUST live here so the generated tables cannot drift from runtime.
export function authOptions(env: AppEnv, db: Db = createDb(env.DB)) {
  const email = createEmailSender(env)

  return {
    database: drizzleAdapter(db, { provider: 'sqlite' as const }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    // Every log line better-auth writes goes through the incident handler's
    // budget and error shape (server/middleware/error-handler.ts). Its
    // default logger hands raw Error objects to console.error, and a failed
    // session lookup's error carries the session token as a bound param.
    logger: authLogger,
    // What happens to an error that escapes an endpoint. By default
    // better-auth logs it itself - `err.message` alone when the text looks
    // like SQL, the raw object otherwise - and then better-call ALSO writes
    // `console.error('# SERVER_ERROR: ', error)` for any non-APIError before
    // answering a bare 500 (better-call/dist/router.mjs). Both sinks bypass
    // the budget and the redaction. An `onError` hook cannot prevent the
    // second one: better-auth catches and logs anything the hook throws
    // (better-auth/dist/api/index.mjs).
    //
    // `throw` skips better-auth's logging and rethrows to better-call, which
    // still turns an APIError into its normal response and rethrows any other
    // error out of `handler()` without logging it. The /api/auth/* route in
    // server/index.ts catches that error and logs it in the one correlated
    // entry. This affects only the HTTP handler, not `auth.api.*` calls.
    onAPIError: { throw: true },
    // NO emailAndPassword. Its absence is load-bearing, not an oversight:
    // better-auth mounts /sign-in/email and /sign-up/email unconditionally and
    // gates them on this option, so leaving it out is what makes them 400
    // (EMAIL_PASSWORD_DISABLED / EMAIL_PASSWORD_SIGN_UP_DISABLED).
    //
    // Dropping sendResetPassword is what disables /request-password-reset
    // (RESET_PASSWORD_DISABLED). This matters more than it looks:
    // /reset-password is NOT gated on `enabled`, and given a still-valid token
    // it will RE-CREATE a credential account for a user who has none. Config
    // alone does not kill the password. The database must also contain no
    // reset tokens or credential rows; SECURITY.md records that invariant.

    // Data minimization: grampacker never collects or stores a display
    // name. better-auth's user model requires the column, and the
    // magic-link plugin - the only route by which a user is created -
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
        //
        // First, refuse unless the client named this exact account. The route
        // deletes the session's user, and the session can change after the user
        // confirms (a passkey for another account picked during
        // re-authentication, or a sign-in in another tab). A missing header is
        // refused too, so a request that does not say whom it means deletes
        // nothing. Runs after the freshness check and before the purge and
        // the account delete.
        beforeDelete: async (
          deleted: { id: string; email: string },
          request?: Request,
        ) => {
          if (request?.headers.get(DELETE_ACCOUNT_USER_HEADER) !== deleted.id) {
            throw new APIError('BAD_REQUEST', {
              code: 'DELETE_ACCOUNT_MISMATCH',
              message:
                'You are signed in to a different account than the one you chose to delete. Nothing was deleted.',
            })
          }
          await createUsersRepo(db, deleted.id).purgeVerificationArtifacts(
            deleted.email,
          )
        },
        // The same purge again, once the user row is gone. better-auth awaits
        // beforeDelete and then deletes the user in further awaited steps, so
        // another request can write a verification row in between - a magic
        // link requested for this address would then survive and recreate
        // the account.
        //
        // Known gap: a magic-link request that is still in flight when this
        // purge runs stores its row afterwards, and redeeming that link
        // creates a new, empty account - exactly as a link requested just
        // after the delete would. Closing it needs a record of deleted
        // addresses; SECURITY.md has the details.
        //
        // FAILS OPEN, unlike the purge above. The account is already deleted,
        // so throwing here would report a failed delete that succeeded. Rows
        // it misses expire within minutes. The failure is logged.
        afterDelete: async (deleted: { id: string; email: string }) => {
          try {
            await createUsersRepo(db, deleted.id).purgeVerificationArtifacts(
              deleted.email,
            )
          } catch (err) {
            authLogger.log('error', 'post-delete verification purge failed', err)
          }
        },
      },
    },
    session: {
      // Generous on purpose: no sensitive data.
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
      // 24h is better-auth's default, chosen deliberately and set explicitly so
      // an upstream default change cannot move it silently. Sessions are 30-day
      // sliding, so the common theft case (an old, long-lived cookie) is STALE
      // on arrival and cannot perform any of the above. Tightening to 1h would
      // only shrink the window for a cookie stolen within a day of sign-in, at
      // the cost of a re-tap during ordinary use.
      //
      // The deny-by-default passkey gate (hooks.before below) reads this SAME
      // value back out of sessionConfig at request time - one constant, one
      // definition of "fresh".
      freshAge: FRESH_AGE_SECONDS,
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: 'strict' as const,
      },
      // Explicit, never left to the default. Unset, better-auth SKIPS its
      // origin validation whenever NODE_ENV is 'test' or TEST is truthy
      // (create-context's isTest()). On Node that means a stray TEST=1 in
      // production would silently drop the forged-Origin 403 and the
      // cookieless magic-link-send refusal, and under Vitest (which sets
      // NODE_ENV=test) the check would not run at all.
      // server/auth-origin-validation.test.ts pins the check.
      disableOriginCheck: false,
    },
    rateLimit: {
      // Rate limiting is owned by our middleware
      // (server/middleware/rate-limit.ts) so there is exactly one
      // mechanism, shared with future non-auth routes. Left unset this
      // would silently self-enable in production with in-memory storage,
      // creating a second limiter with different semantics.
      enabled: false,
    },
    hooks: {
      // Changing WHICH CREDENTIALS CAN SIGN IN requires a FRESH session,
      // not merely a valid one: sessions are 30-day sliding, and a passkey
      // planted by a session thief OUTLIVES the session - permanent, silent
      // access. Removal is gated on the same proof so an attacker cannot
      // strip the owner's other sign-in methods. In a passwordless app the
      // sign-in ceremony IS the re-authentication: a fresh session can only
      // come from a new ceremony.
      //
      // This hook runs on every dispatched endpoint and self-filters:
      // deny-by-default across /passkey/*, with PASSKEY_UNGATED (above) as
      // the explicit exceptions. Both register endpoints are ALSO gated
      // natively by the plugin's freshSessionMiddleware; the redundancy is
      // deliberate - a future flip of registration.requireSession cannot
      // silently open a hole. delete-passkey is the endpoint the plugin
      // does NOT protect, and the reason this hook exists.
      //
      // Position note: before-hooks run BEFORE the endpoint's zod body
      // validation (MAGIC_LINK_SEND_GLOBAL in rate-limit.ts says where that
      // matters). This check reads only the session, never the body, so the
      // trap does not apply. Unknown /passkey/* paths never reach here -
      // dispatch only runs hooks for RESOLVED endpoints - so a 404 stays a
      // 404 (pinned by a test).
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith('/passkey/')) return
        if (PASSKEY_UNGATED.has(ctx.path)) return

        const session = await getSessionFromCtx(ctx)
        // better-auth's dialect ({code, message}): these answers ride
        // /api/auth/*, which the SPA reads through better-auth's client -
        // PasskeySection keys its re-auth prompt off `code`.
        if (!session?.session) {
          throw new APIError('UNAUTHORIZED', {
            code: 'UNAUTHORIZED',
            message: 'Sign in to manage your passkeys.',
          })
        }
        // Same clock and config as better-auth's own freshSessionMiddleware,
        // with one deliberate divergence: the native check treats
        // freshAge: 0 as "disabled" and lets everything through. This gate
        // fails CLOSED on that (and on an unparseable createdAt) - a config
        // mistake must not silently un-gate credential changes.
        const freshAgeMs = ctx.context.sessionConfig.freshAge * 1000
        const createdAt = new Date(session.session.createdAt).getTime()
        if (
          !(freshAgeMs > 0) ||
          Number.isNaN(createdAt) ||
          Date.now() - createdAt >= freshAgeMs
        ) {
          throw new APIError('FORBIDDEN', BASE_ERROR_CODES.SESSION_NOT_FRESH)
        }
      }),
    },
    plugins: [
      magicLink({
        // The recovery path, and the way every account is born. Passkeys are
        // the day-to-day credential; this is how you get one in the first place
        // (prove the mailbox, get a session, enroll a passkey into it) and how
        // you get back in on a device that has none.
        //
        // It is therefore the root of trust: whoever controls the mailbox
        // controls the account, so it has to be hardened rather than assumed.
        expiresIn: 60 * 5, // 5 minutes (the default, pinned so it is auditable)
        // The plugin default is 'plain': it writes the emailed token into the
        // `verification` table in CLEARTEXT. That token mints a session for any
        // account, so a single leaked DB read (or backup) would be a total
        // compromise. Hashed, the stored copy is useless to an attacker.
        storeToken: 'hashed',
        sendMagicLink: async ({ email: to, token }) => {
          // THE GLOBAL MAIL QUOTA IS CHARGED HERE, before email.send, and only
          // here: this is the first point where better-auth has validated the
          // address. The IP and per-address buckets are charged in the
          // middleware. Why, and what the counter means: the comment on
          // MAGIC_LINK_SEND_GLOBAL in server/middleware/rate-limit.ts.
          const quota = chargeMagicLinkGlobalQuota(db, Date.now())
          if (!quota.ok) {
            // Must be an APIError, not a Response: we are inside better-auth's
            // handler, and better-call converts a thrown APIError into the HTTP
            // response (status + body + headers), so this surfaces as a real 429
            // with Retry-After rather than a 500.
            throw new APIError('TOO_MANY_REQUESTS', {
              code: 'MAGIC_LINK_QUOTA_EXHAUSTED',
              message:
                'Too many sign-in emails have been sent recently. Please try again later.',
            }, { 'Retry-After': String(quota.retryAfterSeconds) })
          }

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
          //
          // The token rides in the FRAGMENT, not the query string, because a
          // browser puts the fragment in neither the request line nor the
          // `Referer` header. So clicking the link does not write a live,
          // unconsumed, session-minting token into our logs or any proxy's access
          // log en route. The Referer half matters as
          // much as the log half: Referrer-Policy is strict-origin-when-cross-
          // origin, which sends the FULL url on same-origin requests - so under
          // `?token=` the landing page handed the token to every request it then
          // made. Same click, same page, same scanner safety; the token just stops
          // being something a server can accidentally write down.
          //
          // This bounds the HTTP path, NOT the mail path: the token is still in the
          // message below, so Resend and any receiving mail gateway see it. Nothing
          // here changes that, and nothing can while email is the recovery root of
          // trust - that is what single-use and the 5-minute expiry are for.
          const url = `${env.BETTER_AUTH_URL}${MAGIC_LINK_PATH}#token=${encodeURIComponent(token)}`
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

// Built once per app by createApp (server/index.ts), which serves
// /api/auth/* and the session gate from the same instance. It holds no
// per-request state.
export function createAuth(env: AppEnv, db: Db) {
  return betterAuth(authOptions(env, db))
}

export type Auth = ReturnType<typeof createAuth>
