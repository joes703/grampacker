import { env, testDb } from './node-env'
import app from '../index'
import { lastEmailTo } from '../email/console'
import { MAGIC_LINK_PATH } from '../../shared/auth'

const ORIGIN = 'http://localhost:5173'

// Each helper-created user signs in from its own synthetic IP. Without this
// every sign-in in a test file shares the limiter's 'local' fallback bucket and
// the Nth user in a file trips the magic-link budget. (More realistic anyway:
// distinct users arrive from distinct clients. Tests that assert limiter
// behavior build their own raw requests and are unaffected.)
let nextClient = 0

// The emailed link points at the SPA (/auth/magic#token=...), not at
// better-auth's verify endpoint - see shared/auth.ts for why. So the token has
// to come back out of the URL the same way the browser would read it.
//
// The token is in the FRAGMENT, and this helper is the closest thing we have to a
// real inbox: if the server ever stops putting it there in a shape the client can
// read, every test in the repo that needs a session goes red. Pinned to '#' rather
// than accepting either separator - a permissive regex here would keep the suite
// green through exactly the regression that would break sign-in for everyone.
function tokenFromEmail(email: string): string {
  const msg = lastEmailTo(email)
  if (!msg) throw new Error(`no magic-link email was sent to ${email}`)
  const match = msg.text.match(
    new RegExp(`${MAGIC_LINK_PATH}#token=([^\\s]+)`),
  )
  const token = match?.[1]
  if (!token) {
    throw new Error(`magic-link email to ${email} carried no token`)
  }
  return decodeURIComponent(token)
}

// Create a signed-in user and return their session cookie.
//
// This drives the REAL passwordless flow - request a magic link, read the token
// out of the email we actually sent, redeem it - rather than seeding a session
// row behind better-auth's back. It is the only way to get a session now that
// passwords are gone, and it means the auth tests keep testing auth: if magic
// link breaks, this helper breaks, and every server test in the repo goes red
// loudly instead of passing against a fake session.
//
// The user is created by the redemption itself, with emailVerified: true - the
// magic link IS the proof of the mailbox, so there is no separate verify step
// to fake (the old helper had to UPDATE email_verified directly in D1).
//
// `name` is POSTED, deliberately. grampacker collects no display name, but the
// magic-link plugin's body schema still ACCEPTS one and writes it straight onto
// the new user row - so a client that sends a name anyway is a live surface, and
// the only thing that stops it landing is the databaseHook that blanks the
// column (server/auth.ts). Passing it here keeps every helper call exercising
// that guard rather than testing a path no request takes.
export async function signUpVerifiedUser(
  email: string,
  name: string,
): Promise<{ cookie: string }> {
  nextClient += 1
  const clientIp = `10.99.${Math.floor(nextClient / 256)}.${nextClient % 256}`

  const send = await app.request(
    '/api/auth/sign-in/magic-link',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'x-forwarded-for': clientIp,
      },
      body: JSON.stringify({ email, name }),
    },
    env,
  )
  if (!send.ok) {
    throw new Error(`magic-link request failed: HTTP ${send.status}`)
  }

  // No callbackURL, so verify answers with JSON + Set-Cookie rather than a 302.
  const verify = await app.request(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(tokenFromEmail(email))}`,
    {
      method: 'GET',
      headers: { Origin: ORIGIN, 'x-forwarded-for': clientIp },
    },
    env,
  )
  if (!verify.ok) {
    throw new Error(`magic-link verify failed: HTTP ${verify.status}`)
  }

  const setCookie = verify.headers.get('set-cookie')
  const [cookie] = setCookie?.split(';') ?? []
  if (!cookie) {
    throw new Error('magic-link verify returned no session cookie')
  }
  return { cookie }
}

// A SECOND session for a user who already exists, from a fresh ceremony.
// Sessions are fresh only for a window after they are CREATED, so a test that
// needs to act on a stale session cannot get one by waiting - it has to be
// aged directly in D1 (see makeSessionStale below).
export async function signInAgain(email: string): Promise<{ cookie: string }> {
  return signUpVerifiedUser(email, '')
}

// Age a session past freshAge so the sudo-mode gates reject it. better-auth
// measures freshness from session.created_at and never refreshes it, so this is
// the only honest way to exercise the stale path without sleeping for a day.
export async function makeSessionStale(cookie: string): Promise<void> {
  // `<name>=<token>.<hmac>`, percent-encoded. The cookie NAME itself contains a
  // dot (better-auth.session_token), so split on '=' first, then take the token
  // ahead of the signature. The session row is keyed by that token.
  const value = cookie.slice(cookie.indexOf('=') + 1)
  const [sessionToken] = decodeURIComponent(value).split('.')
  if (!sessionToken) throw new Error('cannot age a cookie with no token')

  const staleMs = Date.now() - 1000 * 60 * 60 * 48 // 48h: twice freshAge
  const { meta } = await testDb.prepare(
    'update session set created_at = ? where token = ?',
  )
    .bind(staleMs, sessionToken)
    .run()
  // Fail loudly. A silent no-op here would make a freshness test pass against a
  // session that was never actually stale - the worst kind of green.
  if (meta.changes !== 1) {
    throw new Error(`expected to age exactly 1 session, aged ${meta.changes}`)
  }
}
