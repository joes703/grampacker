import { createApp } from '../index'
import { app, env, testDb } from '../test/node-env'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuth } from '../auth'
import { createDb } from '../db'
import { chargeMagicLinkGlobalQuota, peekMagicLinkGlobalQuota } from './rate-limit'
import { lastEmailTo } from '../email/console'

const ORIGIN = 'http://localhost:5173'

// Budgets under test (mirrors server/middleware/rate-limit.ts).
const SIGN_IN_LIMIT = 10
const PASSKEY_SIGN_IN_LIMIT = 30
const AUTH_DEFAULT_LIMIT = 30
const MAGIC_SEND_IP_LIMIT = 10
const MAGIC_SEND_EMAIL_LIMIT = 5
const MAGIC_SEND_GLOBAL_LIMIT = 90
const MAGIC_VERIFY_LIMIT = 10
const DELETE_USER_LIMIT = 5
const SIGN_IN_WINDOW_MS = 10 * 60 * 1000
const PASSKEY_SIGN_IN_WINDOW_MS = 5 * 60 * 1000
const SENSITIVE_WINDOW_MS = 10 * 60 * 1000
const MAGIC_SEND_EMAIL_WINDOW_MS = 60 * 60 * 1000

// The shared mail-quota bucket. Addressed directly by these tests: exhausting it
// honestly would mean 90 sends, and seeding it is both faster and independent of
// whatever earlier tests happened to send.
const GLOBAL_KEY = 'magic-send-global:all'

// The secret the API tests run with (server/test/node-env.ts), written out
// rather than read off `env` so the HMAC assertions are self-checking: change
// the configured value and they stop matching.
const TEST_AUTH_SECRET = 'test-only-secret-at-least-32-chars-long!'

async function globalCount(): Promise<number> {
  const row = await testDb.prepare('select count as c from rate_limits where key = ?')
    .bind(GLOBAL_KEY)
    .first<{ c: number }>()
  return row?.c ?? 0
}

// None of these need a valid session to exercise the limiter: it counts every
// attempt BEFORE auth runs, so an anonymous burst (which the handler would
// 400/401) still consumes the bucket.

// Only ever sent to the DEAD /sign-in/email + /sign-up/email endpoints, which
// better-auth still mounts but which now 400 (no emailAndPassword config). The
// value is irrelevant - what is being tested is that a dead endpoint still costs
// rate-limit budget. It is NOT a credential anything in this app accepts.
const DEAD_PASSWORD = 'a-long-test-password-123'

function authPost(path: string, body: unknown, ip: string) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(body),
    },
  )
}

// The passkey ceremony is the primary sign-in surface now. It does NOT live
// under /sign-in/*, which is exactly why it needs an explicit rule - and its
// own bucket, not SIGN_IN's.
//
// A GET, because that is what the endpoint IS and what the real client sends
// (@better-auth/passkey client.mjs). Posting to it would still be metered - the
// limiter charges before dispatch - but it would 404 at the router, so the test
// would be measuring the limiter against a request the app never receives.
//
// ONE request, i.e. HALF a ceremony: the client follows this with a
// verify-authentication POST, metered against the same bucket. Tests that count
// ceremonies rather than requests use signInCeremony below.
function signIn(ip: string) {
  return app.request(
    '/api/auth/passkey/generate-authenticate-options',
    { headers: { Origin: ORIGIN, 'x-forwarded-for': ip } },
  )
}

// A full ceremony's worth of traffic: options, then verification.
//
// The verification half fails - no signed challenge cookie is forwarded, so the
// plugin refuses before it ever checks an assertion. That is the POINT: this
// helper simulates a FAILED ceremony, which is precisely the shape that locked
// the owner out. The limiter charges before dispatch, so a refused request costs
// budget exactly like a successful one, and the tests below prove that on the
// bucket row rather than inferring it from a status code.
async function signInCeremony(ip: string): Promise<[Response, Response]> {
  const options = await signIn(ip)
  const verify = await authPost(
    '/api/auth/passkey/verify-authentication',
    { response: {} },
    ip,
  )
  return [options, verify]
}

// The passkey bucket's current count for an IP, or 0 if untouched. Several
// tests below assert on this directly: "did not 429" is NOT the same claim as
// "was charged", and conflating them is how a test keeps passing after the
// thing it guards stops being metered at all.
async function passkeyBucketCount(ip: string): Promise<number> {
  const row = await testDb.prepare('select count from rate_limits where key = ?')
    .bind(`passkey-sign-in:${ip}`)
    .first<{ count: number }>()
  return row?.count ?? 0
}

function sendMagicLink(ip: string, email: string) {
  return authPost('/api/auth/sign-in/magic-link', { email }, ip)
}

describe('auth rate limiting', () => {
  // THE REGRESSION THIS BUDGET EXISTS FOR (production, 2026-09-12: the app
  // owner locked himself out of his own app).
  //
  // The ceremony costs TWO requests, and a user with several passkeys picks the
  // wrong one and retries - that is ordinary use, not an attack. On the old
  // shared SIGN_IN budget (10 per 10 minutes) this capped out at five attempts
  // and then refused the front door for ten minutes.
  //
  // Ten fumbled attempts is a realistic bad day, not abuse. It must not 429.
  it('ten fumbled passkey attempts do not lock a legitimate user out', async () => {
    const ip = '203.0.113.61'
    for (let attempt = 0; attempt < 10; attempt++) {
      const [options, verify] = await signInCeremony(ip)
      // The options GET must actually WORK, not merely dodge a 429. A 404 or a
      // 500 is not a 429 either (see the consumed-body trap in the
      // accepted-send test below).
      expect(options.status, `attempt ${attempt} options`).toBe(200)
      expect(verify.status, `attempt ${attempt} verify`).not.toBe(429)
    }
    // BOTH halves were charged. Without this the test would still pass if
    // verify-authentication stopped being metered, or moved to a bucket of its
    // own - which would silently re-open the gap this budget exists to close,
    // since the ceremony's cost is the whole reason 10 requests was 5 attempts.
    expect(await passkeyBucketCount(ip)).toBe(20)
  })

  // The budget is passkey-specific: burning it must not take the magic-link
  // recovery path down with it. A user who gives up on passkeys has to be able
  // to fall back to email in the same breath.
  it('exhausting the passkey budget leaves magic-link recovery reachable', async () => {
    const ip = '203.0.113.63'
    for (let i = 0; i <= PASSKEY_SIGN_IN_LIMIT; i++) await signIn(ip)
    expect((await signIn(ip)).status).toBe(429)

    // 200 AND the mail actually went out. `not.toBe(429)` would accept a 400 or
    // a 500 as "recovery works", which is the exact false positive documented
    // in the accepted-send test below - recovery that errors is not recovery.
    const email = 'locked-out@example.com'
    const recovery = await sendMagicLink(ip, email)
    expect(recovery.status).toBe(200)
    expect(lastEmailTo(email)).toBeDefined()
  })

  it('a forged X-Forwarded-For prefix cannot mint fresh budget', async () => {
    // Caddy's own entry is the LAST one; everything before it is whatever the
    // client sent. Exhaust one client's budget, then retry with a new forged
    // prefix each time: still the same client, still refused.
    const real = '203.0.113.31'
    for (let i = 0; i < DELETE_USER_LIMIT; i++) {
      const res = await authPost('/api/auth/delete-user', {}, `198.51.100.${i}, ${real}`)
      expect(res.status).not.toBe(429)
    }
    const forged = await authPost('/api/auth/delete-user', {}, `192.0.2.250, ${real}`)
    expect(forged.status).toBe(429)
    // And X-Real-IP, which Caddy passes through untouched, is not read at all.
    const viaRealIp = await app.request(
      '/api/auth/delete-user',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'x-forwarded-for': real,
          'x-real-ip': '192.0.2.251',
        },
        body: '{}',
      },
    )
    expect(viaRealIp.status).toBe(429)
  })

  it('delete-user gets its own tighter sensitive budget with Retry-After', async () => {
    const ip = '203.0.113.21'
    for (let i = 0; i < DELETE_USER_LIMIT; i++) {
      const res = await authPost('/api/auth/delete-user', {}, ip)
      expect(res.status).not.toBe(429)
    }
    const blocked = await authPost('/api/auth/delete-user', {}, ip)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'Too many requests' })
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(SENSITIVE_WINDOW_MS / 1000)
  })

  it('the magic-link plugin is NOT self-policing: our limiter is the only one', async () => {
    // better-auth's own limiter is disabled (authOptions), so the rate-limit
    // rule the magic-link plugin ships never fires. If this test ever goes red
    // because sends are suddenly unlimited, the cause is that someone deleted
    // our rule assuming the plugin had it covered. It does not.
    const ip = '203.0.113.30'
    for (let i = 0; i < MAGIC_SEND_IP_LIMIT; i++) {
      const res = await sendMagicLink(ip, `flood-${i}@example.com`)
      expect(res.status).not.toBe(429)
    }
    const blocked = await sendMagicLink(ip, 'flood-over@example.com')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('caps links PER ADDRESS, so rotating IPs cannot bomb one inbox', async () => {
    // The attack the per-email bucket exists for. An IP-keyed limiter alone sees
    // a first-time caller on every request and lets the flood through - the
    // victim just watches their inbox fill up. Each request below comes from a
    // DIFFERENT IP, so only the email bucket can stop it.
    const victim = 'victim@example.com'
    for (let i = 0; i < MAGIC_SEND_EMAIL_LIMIT; i++) {
      const res = await sendMagicLink(`198.51.100.${i}`, victim)
      expect(res.status, `send ${i}`).not.toBe(429)
    }

    const blocked = await sendMagicLink('198.51.100.200', victim)
    expect(blocked.status).toBe(429)
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(MAGIC_SEND_EMAIL_WINDOW_MS / 1000)

    // A different address from the same fresh IP still works: the bucket is the
    // victim's, not a global kill switch.
    expect((await sendMagicLink('198.51.100.201', 'bystander@example.com')).status).not.toBe(429)
  })

  it('normalizes the address, so case cannot walk around the victim bucket', async () => {
    // better-auth lowercases emails, so Victim@ and victim@ are ONE account.
    // Keying the raw string would hand an attacker an unlimited supply of
    // buckets for the same inbox just by shifting case.
    const lower = 'mixedcase@example.com'
    const upper = 'MixedCase@Example.com'
    for (let i = 0; i < MAGIC_SEND_EMAIL_LIMIT; i++) {
      expect((await sendMagicLink(`198.51.101.${i}`, lower)).status).not.toBe(429)
    }
    // Same mailbox, different spelling, fresh IP: must still be refused.
    expect((await sendMagicLink('198.51.101.200', upper)).status).toBe(429)
  })

  it('a whitespace variant cannot burn the victim bucket (no trim)', async () => {
    // The bucket key lowercases but deliberately does NOT trim. better-auth
    // validates with z.email() and does not trim either, so "victim@x.com " is
    // REJECTED and no mail is sent - but a trimming key would still have charged
    // the victim's real bucket for it. An attacker on rotating IPs could then
    // spend the victim's 5/hour recovery budget without sending one email, and
    // lock them out of the only way back into a passwordless account.
    //
    // So: the padded address must land in its OWN bucket, and the victim's real
    // budget must be untouched afterwards.
    const victim = 'untrimmed-victim@example.com'
    for (let i = 0; i < MAGIC_SEND_EMAIL_LIMIT + 2; i++) {
      await sendMagicLink(`198.51.103.${i}`, `${victim} `)
    }
    // Real address, fresh IP: still served. If the key trimmed, this would 429.
    const real = await sendMagicLink('198.51.103.200', victim)
    expect(real.status).not.toBe(429)
  })

  it('an INVALID address does not spend global mail budget', async () => {
    // REGRESSION (code review, 2026-07-12). The global bucket used to be charged
    // in the middleware, which runs BEFORE better-auth parses the body - so it
    // could not tell a deliverable address from junk. better-auth validates with
    // z.email() and 400s a bad one, but the slot was already gone. ~90 requests
    // carrying garbage addresses, from rotating IPs, drained a full day of the
    // ONLY recovery path in a passwordless app while sending zero mail.
    //
    // The fix moves the charge into sendMagicLink, which better-auth only calls
    // once the address is real. So: rejected input must move the counter by zero.
    const before = await globalCount()
    const attempts = 12
    for (let i = 0; i < attempts; i++) {
      // Fresh IP each time: the IP bucket must not be what refuses these.
      const res = await sendMagicLink(`198.51.160.${i}`, `not-an-email-${i}`)
      expect(res.status, `attempt ${i}`).toBe(400)
    }
    expect(await globalCount()).toBe(before)
  })

  it('a malformed body does not spend global mail budget', async () => {
    // The other half of the same hole: a body the limiter cannot parse used to
    // land in the 'malformed' email bucket AND still charge the global quota.
    const before = await globalCount()
    for (let i = 0; i < 5; i++) {
      await app.request(
        '/api/auth/sign-in/magic-link',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            'x-forwarded-for': `198.51.161.${i}`,
          },
          body: 'this is not json',
        },
      )
    }
    expect(await globalCount()).toBe(before)
  })

  it('an ACCEPTED send spends exactly one global slot', async () => {
    // The other direction: the counter must still track real sends, or the quota
    // guard is decorative. One accepted send, one slot.
    //
    // The 200 and the email also prove that reading the address for its bucket
    // did NOT consume the body better-auth needs. The route handler passes the
    // RAW request to better-auth (`handler(c.req.raw)`), which bypasses Hono's
    // body cache, and `c.req.json()` fills that cache BY CONSUMING raw's stream.
    // better-auth then gets a used body, throws "Body has already been used",
    // and every magic-link send 500s: nobody can sign in. A `not.toBe(429)`
    // check stays green through that, so this asserts the send SUCCEEDS and
    // better-auth parsed the right recipient out of the body.
    const before = await globalCount()
    const res = await sendMagicLink('198.51.162.1', 'accepted-send@example.com')
    expect(res.status).toBe(200)
    expect(lastEmailTo('accepted-send@example.com')).toBeDefined()
    expect(await globalCount()).toBe(before + 1)
  })

  it('an exhausted quota is refused UP FRONT by the peek, writing no verification row', async () => {
    // The middleware peek, specifically - not the charge in sendMagicLink (see
    // the next test for that one). Seeding the bucket to its limit means the peek
    // refuses before better-auth runs at all, which is the whole point of keeping
    // it: better-auth creates the `verification` row BEFORE it calls
    // sendMagicLink, so without an early refusal a drained quota would turn every
    // further request into a free DB write.
    const rowsBefore = await testDb.prepare('select count(*) as n from verification')
      .first<{ n: number }>()

    await testDb.prepare(
      'insert or replace into rate_limits (key, count, window_start) values (?, ?, ?)',
    )
      .bind(GLOBAL_KEY, MAGIC_SEND_GLOBAL_LIMIT, Date.now())
      .run()

    const blocked = await sendMagicLink('198.51.163.1', 'quota-429@example.com')
    expect(blocked.status).toBe(429)
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(24 * 60 * 60)
    // No mail...
    expect(lastEmailTo('quota-429@example.com')).toBeUndefined()
    // ...and, the actual point: better-auth never ran, so no token row was written.
    const rowsAfter = await testDb.prepare('select count(*) as n from verification')
      .first<{ n: number }>()
    expect(rowsAfter?.n).toBe(rowsBefore?.n)

    await testDb.prepare('delete from rate_limits where key = ?').bind(GLOBAL_KEY).run()
  })

  it('the CHARGE in sendMagicLink refuses with a real 429, not a 500', async () => {
    // The charge inside better-auth's sendMagicLink callback is the authoritative
    // gate, and it refuses by THROWING an APIError('TOO_MANY_REQUESTS') from
    // inside the library. That is a different code path from the middleware peek
    // above, and a fragile one: the status is resolved through better-call's
    // status table, so a renamed key or a bad import would produce a 500 - the
    // request would look like a server bug rather than a quota refusal, and the
    // Retry-After would vanish. Nothing else pins it.
    //
    // Reaching it needs the peek to be bypassed, because any request that comes
    // through Hono with a spent bucket is refused by the peek before better-auth
    // runs. Calling the endpoint directly does exactly that - and it is also the
    // path a concurrent burst takes at the quota boundary (peek sees a free slot,
    // charge finds none).
    await testDb.prepare(
      'insert or replace into rate_limits (key, count, window_start) values (?, ?, ?)',
    )
      .bind(GLOBAL_KEY, MAGIC_SEND_GLOBAL_LIMIT, Date.now())
      .run()

    const email = 'callback-429@example.com'
    const res = await createAuth(env, createDb(env.DB)).api.signInMagicLink({
      body: { email },
      headers: new Headers({ Origin: ORIGIN }),
      asResponse: true,
    })

    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(lastEmailTo(email)).toBeUndefined()

    await testDb.prepare('delete from rate_limits where key = ?').bind(GLOBAL_KEY).run()
  })

  it('the global quota holds exactly under a concurrent burst', { timeout: 30000 }, async () => {
    // The charge moved into sendMagicLink and the middleware only PEEKS at the
    // bucket beforehand. That peek is racy on purpose, so the question this test
    // settles is whether the authoritative charge still holds the line: with N
    // slots left and 2N simultaneous sends, EXACTLY N may send. Over-admission
    // here would mean the peek had become the gate.
    await testDb.prepare('delete from rate_limits where key = ?').bind(GLOBAL_KEY).run()
    const slack = 6
    await testDb.prepare(
      'insert or replace into rate_limits (key, count, window_start) values (?, ?, ?)',
    )
      .bind(GLOBAL_KEY, MAGIC_SEND_GLOBAL_LIMIT - slack, Date.now())
      .run()

    // Distinct IPs and addresses so neither of the other two buckets interferes.
    const results = await Promise.all(
      Array.from({ length: slack * 2 }, (_, i) =>
        sendMagicLink(`198.51.164.${i}`, `burst-${i}@example.com`),
      ),
    )
    expect(results.filter((r) => r.status === 200).length).toBe(slack)
    expect(results.filter((r) => r.status === 429).length).toBe(slack)

    await testDb.prepare('delete from rate_limits where key = ?').bind(GLOBAL_KEY).run()
  })

  it('a refused send does NOT spend global mail budget (charge order)', async () => {
    // The property that keeps one attacker from denying recovery to everyone. The
    // buckets are charged IP -> ADDRESS -> GLOBAL, so a request the IP cap already
    // refused never reaches the shared quota. Reverse that order and a single host
    // could burn the whole app's daily mail budget with requests that were never
    // going to send anything.
    //
    // So: flood past the IP cap, and the global bucket must have moved by exactly
    // the number of sends that were ALLOWED - not by the number attempted.
    const before = await globalCount()
    const ip = '198.51.151.1'
    const attempts = MAGIC_SEND_IP_LIMIT + 5
    for (let i = 0; i < attempts; i++) {
      await sendMagicLink(ip, `order-${i}@example.com`)
    }
    const after = await globalCount()

    expect(after - before).toBe(MAGIC_SEND_IP_LIMIT)
    expect(after - before).toBeLessThan(attempts)
  })

  it('keys the address bucket with a DOMAIN-SEPARATED HMAC, not a bare digest', async () => {
    // BETTER_AUTH_SECRET is also better-auth's own signing key. One key used for
    // two protocols is the shape cross-protocol confusion needs, so the HMAC
    // message carries a domain prefix. This pins that the stored key is neither
    // the raw address, nor a plain digest of it, nor an HMAC of the bare address.
    const email = 'domainsep@example.com'
    await sendMagicLink('198.51.104.1', email)

    // See TEST_AUTH_SECRET at the top of this file for why the secret is
    // hard-coded rather than read off `env`.
    const secret = TEST_AUTH_SECRET
    const hmacHex = async (message: string) => {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
      return [...new Uint8Array(mac)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32)
    }

    const keyExists = async (suffix: string) => {
      const row = await testDb.prepare(
        'select count(*) as n from rate_limits where key = ?',
      )
        .bind(`magic-send-email:${suffix}`)
        .first<{ n: number }>()
      return (row?.n ?? 0) > 0
    }

    // The domain-separated key is the one that exists...
    expect(await keyExists(await hmacHex(`grampacker:magic-send-email:v1:${email}`))).toBe(true)
    // ...and an HMAC of the bare address is NOT. If someone drops the prefix,
    // this flips and the test says so.
    expect(await keyExists(await hmacHex(email))).toBe(false)
  })

  it('does not store the address in the clear', async () => {
    // rate_limits would otherwise become a list of every address that ever asked
    // for a link. The key is an HMAC of the normalized address (auth secret as
    // the pepper), so a DB read leaks nothing.
    const email = 'private@example.com'
    await sendMagicLink('198.51.102.1', email)
    const hit = await testDb.prepare(
      "select count(*) as n from rate_limits where key like '%' || ? || '%'",
    )
      .bind(email)
      .first<{ n: number }>()
    expect(hit?.n).toBe(0)
  })

  it('meters magic-link VERIFY: a side-effecting GET is not a free read', async () => {
    // It creates a user and mints a session, so it must never be treated as a
    // pure-read GET (the allowlist that exempts get-session and list-passkeys).
    const ip = '203.0.113.31'
    for (let i = 0; i < MAGIC_VERIFY_LIMIT; i++) {
      const res = await app.request(
        `/api/auth/magic-link/verify?token=bogus-${i}`,
        { method: 'GET', headers: { Origin: ORIGIN, 'x-forwarded-for': ip } },
      )
      expect(res.status).not.toBe(429)
    }
    const blocked = await app.request(
      '/api/auth/magic-link/verify?token=bogus-over',
      { method: 'GET', headers: { Origin: ORIGIN, 'x-forwarded-for': ip } },
    )
    expect(blocked.status).toBe(429)
  })

  it('sensitive endpoints keep independent buckets from each other', async () => {
    // Exhaust the LARGER budget first. The other order proves nothing: after
    // 6 delete-user requests, one passkey request would stay under its budget
    // of 30 even if the two shared one bucket.
    const ip = '203.0.113.22'
    for (let i = 0; i < PASSKEY_SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await signIn(ip)).status).toBe(429)
    // delete-user on the SAME IP still has its whole budget, and is still
    // metered: distinct scope, distinct bucket.
    for (let i = 0; i < DELETE_USER_LIMIT; i++) {
      expect((await authPost('/api/auth/delete-user', {}, ip)).status).not.toBe(429)
    }
    expect((await authPost('/api/auth/delete-user', {}, ip)).status).toBe(429)
  })

  it('buckets are per IP: another client is unaffected', async () => {
    const ip = '203.0.113.2'
    for (let i = 0; i <= PASSKEY_SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await signIn(ip)).status).toBe(429)
    expect((await signIn('203.0.113.99')).status).not.toBe(429)
  })

  it('still meters the dead password endpoints', async () => {
    // /sign-up/email and /sign-in/email are still MOUNTED by better-auth; they
    // just 400 now, because there is no emailAndPassword config for them to run
    // against. A 400 is cheap, but it is not free - an unmetered dead endpoint is
    // still an unmetered request, so they keep costing budget.
    const ip = '203.0.113.3'
    const dead = await authPost(
      '/api/auth/sign-up/email',
      { email: 'nope@example.com', password: DEAD_PASSWORD },
      ip,
    )
    expect(dead.status).toBe(400)

    for (let i = 0; i < SIGN_IN_LIMIT; i++) {
      await authPost(
        '/api/auth/sign-up/email',
        { email: `burst-${i}@example.com`, password: DEAD_PASSWORD },
        ip,
      )
    }
    const blocked = await authPost(
      '/api/auth/sign-up/email',
      { email: 'burst-over@example.com', password: DEAD_PASSWORD },
      ip,
    )
    expect(blocked.status).toBe(429)
    // Still on SIGN_IN's own 10-minute window, not the passkey bucket's 5.
    // The two budgets diverged on 2026-09-12 and this is what pins the split.
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(PASSKEY_SIGN_IN_WINDOW_MS / 1000)
    expect(retryAfter).toBeLessThanOrEqual(SIGN_IN_WINDOW_MS / 1000)
  })

  it('the window expires: requests are allowed again afterwards', async () => {
    const ip = '203.0.113.5'
    for (let i = 0; i <= PASSKEY_SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await signIn(ip)).status).toBe(429)

    // Rewind the stored window past expiry instead of waiting five minutes.
    await testDb.prepare(
      'update rate_limits set window_start = window_start - ? where key = ?',
    )
      .bind(PASSKEY_SIGN_IN_WINDOW_MS + 1000, `passkey-sign-in:${ip}`)
      .run()

    const afterExpiry = await signIn(ip)
    expect(afterExpiry.status).not.toBe(429)
  })

  it('the limit holds under a concurrent burst: no lost updates', { timeout: 30000 }, async () => {
    const ip = '203.0.113.7'
    const results = await Promise.all(
      Array.from({ length: PASSKEY_SIGN_IN_LIMIT * 2 }, () => signIn(ip)),
    )
    // The atomic upsert assigns each request a distinct count, so the
    // split is exact - a lost update would show up as an extra allow.
    expect(results.filter((r) => r.status !== 429).length).toBe(PASSKEY_SIGN_IN_LIMIT)
    expect(results.filter((r) => r.status === 429).length).toBe(PASSKEY_SIGN_IN_LIMIT)
    const row = await testDb.prepare(
      'select count from rate_limits where key = ?',
    )
      .bind(`passkey-sign-in:${ip}`)
      .first<{ count: number }>()
    expect(row?.count).toBe(PASSKEY_SIGN_IN_LIMIT * 2)
  })

  it('requests without a client IP share the local fallback bucket', async () => {
    const post = () =>
      app.request(
        '/api/auth/sign-in/email',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
          body: JSON.stringify({ email: 'nobody@example.com', password: DEAD_PASSWORD }),
        },
      )
    for (let i = 0; i < SIGN_IN_LIMIT; i++) {
      expect((await post()).status).not.toBe(429)
    }
    expect((await post()).status).toBe(429)
    const row = await testDb.prepare(
      "select count from rate_limits where key = 'sign-in:local'",
    ).first<{ count: number }>()
    expect(row?.count).toBe(SIGN_IN_LIMIT + 1)
  })

  it('path tricks cannot reach better-auth without passing the limiter', async () => {
    // The limiter and the auth handler are mounted on the same '/auth/*'
    // pattern, so a path that evades one evades both. A case-mismatched
    // path also stops matching the CSRF middleware's /api/auth/* skip,
    // so it is refused as an ordinary unsafe request (403, missing CSRF
    // header) - and with the header it would 404. Never unlimited auth.
    const cased = await authPost(
      '/api/AUTH/sign-in/email',
      { email: 'nobody@example.com', password: DEAD_PASSWORD },
      '203.0.113.8',
    )
    expect(cased.status).toBe(403)

    // Query strings do not split the bucket: exhaust with a query
    // string, then the plain path is already over budget. Asserted on the
    // SAME path, because the passkey ceremony now has its own bucket - a
    // cross-path assertion here would be testing bucket sharing, not the
    // query-string question this test is about.
    const ip = '203.0.113.9'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await authPost(
        `/api/auth/sign-in/email?attempt=${i}`,
        { email: 'nobody@example.com', password: DEAD_PASSWORD },
        ip,
      )
    }
    const plain = await authPost(
      '/api/auth/sign-in/email',
      { email: 'nobody@example.com', password: DEAD_PASSWORD },
      ip,
    )
    expect(plain.status).toBe(429)
  })

  it('the limiter is method-agnostic: OPTIONS shares the bucket', async () => {
    // Fail-closed posture: every method is limited unless it is an
    // allowlisted read-only GET. An OPTIONS never reaches a handler
    // (the auth mount only registers GET and POST) but still counts.
    const ip = '203.0.113.10'
    const options = () =>
      app.request(
        '/api/auth/sign-in/email',
        { method: 'OPTIONS', headers: { 'x-forwarded-for': ip } },
      )
    expect((await options()).status).toBe(404)

    // It really COUNTS, not merely "is subject to" - proven on the row, since a
    // 404 looks the same whether or not the limiter ran.
    const charged = await testDb.prepare(
      'select count from rate_limits where key = ?',
    )
      .bind(`sign-in:${ip}`)
      .first<{ count: number }>()
    expect(charged?.count).toBe(1)

    // Exhausted on the same bucket the OPTIONS lands in. The passkey ceremony
    // has its own budget now, so filling THAT one would prove nothing here.
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await authPost(
        '/api/auth/sign-in/email',
        { email: 'nobody@example.com', password: DEAD_PASSWORD },
        ip,
      )
    }
    expect((await options()).status).toBe(429)
  })

  it('a new window sweeps buckets expired for every scope, keeps active ones', async () => {
    const now = Date.now()
    await testDb.prepare(
      'insert into rate_limits (key, count, window_start) values (?, 5, ?), (?, 3, ?)',
    )
      .bind(
        'sign-in:stale-ip',
        now - 25 * 60 * 60 * 1000, // > MAX_WINDOW_MS ago: expired for any scope
        'sign-up:fresh-ip',
        now - 60 * 1000, // active
      )
      .run()

    // First request for an unseen key starts a new window -> sweep runs.
    await signIn('203.0.113.11')

    const stale = await testDb.prepare(
      "select 1 as one from rate_limits where key = 'sign-in:stale-ip'",
    ).first()
    const fresh = await testDb.prepare(
      "select 1 as one from rate_limits where key = 'sign-up:fresh-ip'",
    ).first()
    expect(stale).toBeNull()
    expect(fresh).not.toBeNull()
  })

  it('challenge-generating GETs are limited and stop writing challenges', async () => {
    // The passkey plugin's /passkey/generate-authenticate-options is an
    // UNAUTHENTICATED GET that writes a verification row per call, so a rule
    // that exempts all GETs leaves an unguarded write path. Prove the GET
    // itself consumes budget, gets cut off, and that a blocked request writes
    // no verification row.
    //
    // It is metered on the PASSKEY_SIGN_IN budget, matched by exact path rather
    // than by prefix (it does not live under /sign-in/*). That budget is
    // deliberately LOOSER than SIGN_IN's: this is the front door of a
    // passwordless app, one ceremony costs two requests, and there is no
    // credential here to guess. The write-amplification this test guards is
    // what the limit is sized against - see the rule's comment.
    const ip = '203.0.113.12'
    const challenge = () =>
      app.request(
        '/api/auth/passkey/generate-authenticate-options',
        { headers: { 'x-forwarded-for': ip } },
      )
    const start = await testDb.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    for (let i = 0; i < PASSKEY_SIGN_IN_LIMIT; i++) {
      expect((await challenge()).status).toBe(200)
    }
    const before = await testDb.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    // The allowed calls really DID write challenge rows. Without this the
    // before/after comparison below could hold at zero-equals-zero and prove
    // nothing at all - it would pass just as happily if the endpoint had
    // stopped writing rows, or stopped working.
    expect(before!.n).toBeGreaterThan(start!.n)

    const blocked = await challenge()
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'Too many requests' })
    // Retry-After is bounded by the passkey window, so a locked-out user is
    // told to wait minutes, not the longer windows of the other buckets.
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(PASSKEY_SIGN_IN_WINDOW_MS / 1000)
    const after = await testDb.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    expect(after?.n).toBe(before?.n)
  })

  // The sweep is garbage collection, so it must never cost a user their
  // sign-in. Proven by breaking it: a connection whose `verification` deletes
  // throw, with every other statement real. The request must still succeed.
  //
  // The asymmetry with the CHARGE is deliberate and worth a test of its own -
  // a charge that threw and was swallowed would be a limiter bypass, while a
  // sweep that throws has merely skipped rows that were already expired and
  // inert. auth-error-logging.test.ts caught the first version of this sweep
  // taking a whole request down with it.
  it('a failing sweep does not fail the request it rode in on', async () => {
    const ip = '203.0.113.65'
    const bindTo = (t: object, p: string | symbol, r: unknown) => {
      const v = Reflect.get(t, p, r)
      return typeof v === 'function' ? v.bind(t) : v
    }
    let sweepFailures = 0
    const brokenSweep = new Proxy(env.DB, {
      get(db, prop) {
        if (prop !== 'prepare') return bindTo(db, prop, db)
        return (query: string) => {
          const stmt = db.prepare(query)
          if (!/^\s*delete\s+from\s+"?verification"?/i.test(query)) return stmt
          // Drizzle executes a better-sqlite3 statement with run/all/get
          // (parameters passed directly), so those are what must fail.
          return new Proxy(stmt, {
            get(st, sProp) {
              if (sProp !== 'run' && sProp !== 'all' && sProp !== 'get') {
                return bindTo(st, sProp, st)
              }
              return () => {
                sweepFailures += 1
                throw new Error('sweep is down')
              }
            },
          })
        }
      },
    })

    // Roll the window so the sweep actually fires on the next request.
    await signIn(ip)
    await testDb.prepare(
      'update rate_limits set window_start = window_start - ? where key = ?',
    )
      .bind(24 * 60 * 60 * 1000 + 1000, `passkey-sign-in:${ip}`)
      .run()

    const res = await createApp({ ...env, DB: brokenSweep }).request(
      '/api/auth/passkey/generate-authenticate-options',
      { headers: { Origin: ORIGIN, 'x-forwarded-for': ip } },
    )
    // The sweep really ran and really failed...
    expect(sweepFailures).toBe(1)
    // ...and the request still succeeded.
    expect(res.status).toBe(200)
    // And it was still METERED: failing open on the sweep must not fail open
    // on the charge.
    expect(await passkeyBucketCount(ip)).toBe(1)
  })

  // The other end of the same table. better-auth sweeps expired rows only as
  // a side effect of findVerificationValue, which several unrelated routes
  // call (magic-link verify, the reset-password and OAuth callbacks, among
  // others); passkey flows consume through consumeVerificationValue, which
  // deletes only rows with the consumed challenge's identifier. An ABANDONED
  // passkey challenge therefore expires in five minutes and then lives until
  // some unrelated request arrives - a leak the raised passkey budget would
  // otherwise accelerate sixfold. charge() sweeps it on the same new-window
  // trigger it already uses for rate_limits.
  it('a new window also sweeps verification rows that have expired', async () => {
    const ip = '203.0.113.64'
    // An abandoned challenge: options written, never consumed.
    expect((await signIn(ip)).status).toBe(200)
    const stranded = await testDb.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    expect(stranded!.n).toBeGreaterThan(0)

    // Age every row past its expiry rather than waiting five minutes.
    await testDb.prepare('update verification set expires_at = ?')
      .bind(Date.now() - 60_000)
      .run()

    // Force a NEW window on some bucket, which is what triggers the sweep.
    await testDb.prepare(
      'update rate_limits set window_start = window_start - ? where key = ?',
    )
      .bind(24 * 60 * 60 * 1000 + 1000, `passkey-sign-in:${ip}`)
      .run()
    expect((await signIn(ip)).status).toBe(200)

    // The expired rows are gone - but the challenge that request just wrote is
    // NOT, so the sweep is bounded by expiry rather than clearing the table.
    const live = await testDb.prepare(
      'select count(*) as n from verification where expires_at < ?',
    )
      .bind(Date.now())
      .first<{ n: number }>()
    expect(live!.n).toBe(0)
    const remaining = await testDb.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    expect(remaining!.n).toBeGreaterThan(0)
  })

  it('allowlisted read-only GETs are never limited', async () => {
    // Exhaust the shared default 'auth' bucket for this IP with cheap
    // sign-out POSTs, then confirm the session poll still passes while
    // a non-allowlisted request on the same bucket is refused. The budget is
    // asserted on the way up too: the generic bucket must stay much looser than
    // the sensitive ones (delete-user stops at 5).
    const ip = '203.0.113.6'
    for (let i = 0; i <= AUTH_DEFAULT_LIMIT; i++) {
      const res = await authPost('/api/auth/sign-out', {}, ip)
      if (i < AUTH_DEFAULT_LIMIT) expect(res.status, `sign-out ${i}`).not.toBe(429)
    }
    expect((await authPost('/api/auth/sign-out', {}, ip)).status).toBe(429)

    const session = await app.request(
      '/api/auth/get-session',
      { headers: { 'x-forwarded-for': ip } },
    )
    expect(session.status).toBe(200)
  })
})

// The window arithmetic, pinned to the millisecond. The tests above rewind a
// stored window by a whole window plus a margin, which proves expiry happens
// but not WHEN: an off-by-one at the boundary (`<` for `<=`), a Retry-After
// that rounds down to 0, or a late request resetting a window that a newer
// request already started would all pass them.
//
// The global mail bucket is driven directly, because its charge and peek take
// `now` as an argument. The per-IP bucket is driven over HTTP with a fake
// clock, so the 429 response and its header are checked too.
describe('rate-limit windows', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  // A fixed instant, so every boundary below is exact. Recent enough that the
  // new-window sweep (rows older than a day) never removes a row under test.
  const T = Math.floor(Date.now() / 1000) * 1000
  const db = createDb(env.DB)

  async function bucket(key: string) {
    return testDb.prepare('select count, window_start from rate_limits where key = ?')
      .bind(key)
      .first<{ count: number; window_start: number }>()
  }

  async function seed(key: string, count: number, windowStart: number) {
    await testDb.prepare(
      'insert or replace into rate_limits (key, count, window_start) values (?, ?, ?)',
    )
      .bind(key, count, windowStart)
      .run()
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    await testDb.prepare('delete from rate_limits where key = ?').bind(GLOBAL_KEY).run()
  })

  it('a full bucket stays full until exactly windowStart + window, then starts a new window', async () => {
    await seed(GLOBAL_KEY, MAGIC_SEND_GLOBAL_LIMIT, T)

    // One millisecond before the end: still spent, and the wait rounds UP to
    // one second rather than down to an invalid Retry-After of 0.
    expect(peekMagicLinkGlobalQuota(db, T + DAY_MS - 1)).toEqual({ ok: false, retryAfterSeconds: 1 })
    expect(chargeMagicLinkGlobalQuota(db, T + DAY_MS - 1)).toEqual({ ok: false, retryAfterSeconds: 1 })
    // A refused charge still counts, in the SAME window.
    expect(await bucket(GLOBAL_KEY)).toEqual({ count: MAGIC_SEND_GLOBAL_LIMIT + 1, window_start: T })

    // Exactly at the end: a new window, for the peek and the charge alike.
    expect(peekMagicLinkGlobalQuota(db, T + DAY_MS)).toEqual({ ok: true })
    expect(chargeMagicLinkGlobalQuota(db, T + DAY_MS)).toEqual({ ok: true })
    expect(await bucket(GLOBAL_KEY)).toEqual({ count: 1, window_start: T + DAY_MS })
  })

  it('the limit-th charge is allowed and the next one refused', async () => {
    await seed(GLOBAL_KEY, MAGIC_SEND_GLOBAL_LIMIT - 1, T)
    expect(peekMagicLinkGlobalQuota(db, T + 1)).toEqual({ ok: true })
    expect(chargeMagicLinkGlobalQuota(db, T + 1)).toEqual({ ok: true })
    // Full now: the peek refuses before the charge would.
    expect(peekMagicLinkGlobalQuota(db, T + 1).ok).toBe(false)
    expect(chargeMagicLinkGlobalQuota(db, T + 1).ok).toBe(false)
  })

  it('Retry-After counts down to the end of the window, rounded up', async () => {
    await seed(GLOBAL_KEY, MAGIC_SEND_GLOBAL_LIMIT, T)
    expect(chargeMagicLinkGlobalQuota(db, T)).toEqual({ ok: false, retryAfterSeconds: DAY_MS / 1000 })
    expect(chargeMagicLinkGlobalQuota(db, T + 1500)).toEqual({
      ok: false,
      retryAfterSeconds: DAY_MS / 1000 - 1,
    })
  })

  it('a late request with an older clock reading cannot reset a newer window', async () => {
    // Two requests' clock readings can reach the charge out of order, so a
    // charge can carry an OLDER `now` than the one a faster request already
    // used to start a new window. It must count in that window, not start
    // another one.
    const newer = T + DAY_MS
    await seed(GLOBAL_KEY, 1, newer)

    expect(chargeMagicLinkGlobalQuota(db, newer - 1).ok).toBe(true)
    expect(chargeMagicLinkGlobalQuota(db, T).ok).toBe(true)
    expect(await bucket(GLOBAL_KEY)).toEqual({ count: 3, window_start: newer })
  })

  it('over HTTP: 429 with Retry-After up to the last millisecond, then a fresh window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    const ip = '203.0.113.90'
    const key = `passkey-sign-in:${ip}`

    for (let i = 0; i < PASSKEY_SIGN_IN_LIMIT; i++) {
      expect((await signIn(ip)).status, `request ${i}`).toBe(200)
    }
    const refused = await signIn(ip)
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe(String(PASSKEY_SIGN_IN_WINDOW_MS / 1000))
    expect(await refused.json()).toEqual({ error: 'Too many requests' })

    vi.setSystemTime(T + PASSKEY_SIGN_IN_WINDOW_MS - 1)
    const last = await signIn(ip)
    expect(last.status).toBe(429)
    expect(last.headers.get('Retry-After')).toBe('1')

    vi.setSystemTime(T + PASSKEY_SIGN_IN_WINDOW_MS)
    expect((await signIn(ip)).status).toBe(200)
    expect(await bucket(key)).toEqual({ count: 1, window_start: T + PASSKEY_SIGN_IN_WINDOW_MS })
  })

  it('Retry-After counts from when the address bucket is charged, not when the request arrived', async () => {
    // The address bucket is charged after an await (the HMAC). If the charge
    // used the time the request arrived, a newer window started meanwhile
    // would make Retry-After longer than the window itself.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    const email = 'slow-hmac@example.com'
    const hmac = async (message: string) => {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(TEST_AUTH_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
      return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
    }
    const key = `magic-send-email:${await hmac(`grampacker:magic-send-email:v1:${email}`)}`
    // Faster requests have filled a window that started 2 s after this
    // request arrived.
    await seed(key, MAGIC_SEND_EMAIL_LIMIT, T + 2000)
    const sign = crypto.subtle.sign.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'sign').mockImplementation(async (...args) => {
      vi.setSystemTime(T + 2000)
      return sign(...args)
    })

    const res = await sendMagicLink('198.51.166.1', email)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe(String(MAGIC_SEND_EMAIL_WINDOW_MS / 1000))
  })

  it('overlapping requests at a window roll start ONE new window and admit exactly the limit', { timeout: 30000 }, async () => {
    // The bucket is spent and its window ends exactly now. Every overlapping
    // request sees that expired window. Exactly one may reset it; the rest
    // must count in the window it started. If two requests could each reset
    // it, each reset would hand out a fresh budget.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    const ip = '203.0.113.91'
    const key = `passkey-sign-in:${ip}`
    await seed(key, PASSKEY_SIGN_IN_LIMIT + 5, T - PASSKEY_SIGN_IN_WINDOW_MS)

    const results = await Promise.all(
      Array.from({ length: PASSKEY_SIGN_IN_LIMIT * 2 }, () => signIn(ip)),
    )
    expect(results.filter((r) => r.status === 200).length).toBe(PASSKEY_SIGN_IN_LIMIT)
    expect(results.filter((r) => r.status === 429).length).toBe(PASSKEY_SIGN_IN_LIMIT)
    expect(await bucket(key)).toEqual({ count: PASSKEY_SIGN_IN_LIMIT * 2, window_start: T })
  })

  it('overlapping magic-link sends to one address admit exactly the per-address limit', { timeout: 30000 }, async () => {
    // The address bucket is charged AFTER an await (the HMAC), so these
    // requests interleave before they charge. Distinct IPs keep the per-IP
    // bucket out of it.
    const email = 'overlap-victim@example.com'
    const results = await Promise.all(
      Array.from({ length: MAGIC_SEND_EMAIL_LIMIT * 3 }, (_, i) =>
        sendMagicLink(`198.51.165.${i}`, email),
      ),
    )
    expect(results.filter((r) => r.status === 200).length).toBe(MAGIC_SEND_EMAIL_LIMIT)
    expect(results.filter((r) => r.status === 429).length).toBe(MAGIC_SEND_EMAIL_LIMIT * 2)
  })
})
