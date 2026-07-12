import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { lastEmailTo } from '../email/console'

const ORIGIN = 'http://localhost:5173'

// Budgets under test (mirrors server/middleware/rate-limit.ts).
const SIGN_IN_LIMIT = 10
const AUTH_DEFAULT_LIMIT = 30
const MAGIC_SEND_IP_LIMIT = 10
const MAGIC_SEND_EMAIL_LIMIT = 5
const MAGIC_SEND_GLOBAL_LIMIT = 90
const MAGIC_VERIFY_LIMIT = 10
const DELETE_USER_LIMIT = 5
const SIGN_IN_WINDOW_MS = 10 * 60 * 1000
const SENSITIVE_WINDOW_MS = 10 * 60 * 1000
const MAGIC_SEND_EMAIL_WINDOW_MS = 60 * 60 * 1000

// The shared mail-quota bucket. Addressed directly by these tests: exhausting it
// honestly would mean 90 sends, and seeding it is both faster and independent of
// whatever earlier tests happened to send.
const GLOBAL_KEY = 'magic-send-global:all'

async function globalCount(): Promise<number> {
  const row = await env.DB.prepare('select count as c from rate_limits where key = ?')
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
        'cf-connecting-ip': ip,
      },
      body: JSON.stringify(body),
    },
    env,
  )
}

// The passkey ceremony is the primary sign-in surface now. It does NOT live
// under /sign-in/*, which is exactly why it needs an explicit rule.
function signIn(ip: string) {
  return authPost('/api/auth/passkey/generate-authenticate-options', {}, ip)
}

function sendMagicLink(ip: string, email: string) {
  return authPost('/api/auth/sign-in/magic-link', { email }, ip)
}

describe('auth rate limiting', () => {
  it('sign-in cuts off after the budget with Retry-After', async () => {
    const ip = '203.0.113.1'
    for (let i = 0; i < SIGN_IN_LIMIT; i++) {
      const res = await signIn(ip)
      expect(res.status).not.toBe(429)
    }
    const blocked = await signIn(ip)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'Too many requests' })
    const retryAfter = Number(blocked.headers.get('Retry-After'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(SIGN_IN_WINDOW_MS / 1000)
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

  it('reading the email for its bucket does NOT consume the body better-auth needs', async () => {
    // REGRESSION (caught by CI, not by me). The route handler passes the RAW
    // request to better-auth (`handler(c.req.raw)`), which bypasses Hono's body
    // cache. The first cut of the per-email bucket called `c.req.json()`, which
    // populates that cache BY CONSUMING raw's stream - so better-auth got a used
    // body and threw "Body has already been used". Every magic-link send 500'd:
    // nobody could sign in at all.
    //
    // The limiter tests all asserted `not.toBe(429)`, and a 500 is not a 429, so
    // they stayed green through it. Hence this test asserts the send SUCCEEDS and
    // that better-auth actually parsed the address out of the body - if the body
    // were consumed, no email could name the right recipient.
    const email = 'body-intact@example.com'
    const res = await sendMagicLink('203.0.113.40', email)
    expect(res.status).toBe(200)
    expect(lastEmailTo(email)).toBeDefined()
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

  it('caps TOTAL mail sent, not just mail per IP (the quota guard)', async () => {
    // The provider's quota is global (Resend free tier: 100/day), so only a global
    // bucket can guard it. A per-IP cap cannot: at N/day per IP, a handful of IPs
    // still drains the provider, and then nobody can recover an account.
    //
    // Seeded rather than exhausted honestly - 90 real sends would be slow, and
    // seeding makes the test independent of whatever earlier tests already sent.
    await env.DB.prepare(
      'insert or replace into rate_limits (key, count, window_start) values (?, ?, ?)',
    )
      .bind(GLOBAL_KEY, MAGIC_SEND_GLOBAL_LIMIT, Date.now())
      .run()

    // Fresh IP, fresh address: neither of the other two buckets can explain this.
    const blocked = await sendMagicLink('198.51.150.1', 'quota-victim@example.com')
    expect(blocked.status).toBe(429)

    // And it really was the global bucket: clear it, and the same request is served.
    await env.DB.prepare('delete from rate_limits where key = ?').bind(GLOBAL_KEY).run()
    const served = await sendMagicLink('198.51.150.2', 'quota-victim2@example.com')
    expect(served.status).toBe(200)
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

    // The secret the test worker runs with, from vitest.workers.config.ts. It is
    // NOT read off `env` here: worker-configuration.d.ts is generated by
    // `wrangler types`, which learns BETTER_AUTH_SECRET from a local .dev.vars -
    // a file CI does not have - so `env.BETTER_AUTH_SECRET` typechecks on a dev
    // box and fails to compile in CI. Hard-coding it also makes the test
    // self-checking: change the config value and the HMAC below stops matching.
    const secret = 'test-only-secret-at-least-32-chars-long!'
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
      const row = await env.DB.prepare(
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
    const hit = await env.DB.prepare(
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
        { method: 'GET', headers: { Origin: ORIGIN, 'cf-connecting-ip': ip } },
        env,
      )
      expect(res.status).not.toBe(429)
    }
    const blocked = await app.request(
      '/api/auth/magic-link/verify?token=bogus-over',
      { method: 'GET', headers: { Origin: ORIGIN, 'cf-connecting-ip': ip } },
      env,
    )
    expect(blocked.status).toBe(429)
  })

  it('sensitive endpoints keep independent buckets from each other', async () => {
    const ip = '203.0.113.22'
    // Exhaust delete-user for this IP.
    for (let i = 0; i <= DELETE_USER_LIMIT; i++) {
      await authPost('/api/auth/delete-user', {}, ip)
    }
    expect((await authPost('/api/auth/delete-user', {}, ip)).status).toBe(429)
    // Sign-in on the SAME IP is untouched: distinct scope, distinct bucket.
    expect((await signIn(ip)).status).not.toBe(429)
  })

  it('sensitive endpoints cut off well before the generic auth bucket would', async () => {
    // delete-user stops at 5...
    const sensitiveIp = '203.0.113.23'
    for (let i = 0; i < DELETE_USER_LIMIT; i++) {
      expect((await authPost('/api/auth/delete-user', {}, sensitiveIp)).status).not.toBe(429)
    }
    expect((await authPost('/api/auth/delete-user', {}, sensitiveIp)).status).toBe(429)
    // ...while a generic auth endpoint on a fresh IP sails past 5 (budget 30).
    const genericIp = '203.0.113.24'
    for (let i = 0; i < DELETE_USER_LIMIT + 2; i++) {
      expect((await authPost('/api/auth/sign-out', {}, genericIp)).status).not.toBe(429)
    }
  })

  it('buckets are per IP: another client is unaffected', async () => {
    const ip = '203.0.113.2'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
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
  })

  it('the window expires: requests are allowed again afterwards', async () => {
    const ip = '203.0.113.5'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await signIn(ip)).status).toBe(429)

    // Rewind the stored window past expiry instead of waiting 10 minutes.
    await env.DB.prepare(
      'update rate_limits set window_start = window_start - ? where key = ?',
    )
      .bind(SIGN_IN_WINDOW_MS + 1000, `sign-in:${ip}`)
      .run()

    const afterExpiry = await signIn(ip)
    expect(afterExpiry.status).not.toBe(429)
  })

  it('the limit holds under a concurrent burst: no lost updates', { timeout: 30000 }, async () => {
    const ip = '203.0.113.7'
    const results = await Promise.all(
      Array.from({ length: SIGN_IN_LIMIT * 2 }, () => signIn(ip)),
    )
    // The atomic upsert assigns each request a distinct count, so the
    // split is exact - a lost update would show up as an extra allow.
    expect(results.filter((r) => r.status !== 429).length).toBe(SIGN_IN_LIMIT)
    expect(results.filter((r) => r.status === 429).length).toBe(SIGN_IN_LIMIT)
    const row = await env.DB.prepare(
      'select count from rate_limits where key = ?',
    )
      .bind(`sign-in:${ip}`)
      .first<{ count: number }>()
    expect(row?.count).toBe(SIGN_IN_LIMIT * 2)
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
        env,
      )
    for (let i = 0; i < SIGN_IN_LIMIT; i++) {
      expect((await post()).status).not.toBe(429)
    }
    expect((await post()).status).toBe(429)
    const row = await env.DB.prepare(
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
    // string, then the plain path is already over budget.
    const ip = '203.0.113.9'
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await authPost(
        `/api/auth/sign-in/email?attempt=${i}`,
        { email: 'nobody@example.com', password: DEAD_PASSWORD },
        ip,
      )
    }
    expect((await signIn(ip)).status).toBe(429)
  })

  it('the limiter is method-agnostic: OPTIONS shares the bucket', async () => {
    // Fail-closed posture: every method is limited unless it is an
    // allowlisted read-only GET. An OPTIONS never reaches a handler
    // (the auth mount only registers GET and POST) but still counts.
    const ip = '203.0.113.10'
    const options = () =>
      app.request(
        '/api/auth/sign-in/email',
        { method: 'OPTIONS', headers: { 'cf-connecting-ip': ip } },
        env,
      )
    expect((await options()).status).toBe(404)

    for (let i = 0; i <= SIGN_IN_LIMIT; i++) {
      await signIn(ip)
    }
    expect((await options()).status).toBe(429)
  })

  it('a new window sweeps buckets expired for every scope, keeps active ones', async () => {
    const now = Date.now()
    await env.DB.prepare(
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

    const stale = await env.DB.prepare(
      "select 1 as one from rate_limits where key = 'sign-in:stale-ip'",
    ).first()
    const fresh = await env.DB.prepare(
      "select 1 as one from rate_limits where key = 'sign-up:fresh-ip'",
    ).first()
    expect(stale).toBeNull()
    expect(fresh).not.toBeNull()
  })

  it('challenge-generating GETs are limited and stop writing challenges', async () => {
    // Regression for the PR #10 blocker: the passkey plugin's
    // /passkey/generate-authenticate-options is an UNAUTHENTICATED GET
    // that writes a verification row per call. The old exempt-all-GETs
    // rule left it as an unguarded write path. Prove the GET itself
    // consumes budget, gets cut off, and that a blocked request writes
    // no verification row.
    //
    // It is metered on the SIGN_IN budget (10), not the default (30): passwordless
    // makes this the primary front door, and it does not live under /sign-in/*, so
    // it is matched by path rather than by prefix. Tighter than it was.
    const ip = '203.0.113.12'
    const challenge = () =>
      app.request(
        '/api/auth/passkey/generate-authenticate-options',
        { headers: { 'cf-connecting-ip': ip } },
        env,
      )
    for (let i = 0; i < SIGN_IN_LIMIT; i++) {
      expect((await challenge()).status).not.toBe(429)
    }
    const before = await env.DB.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    const blocked = await challenge()
    expect(blocked.status).toBe(429)
    const after = await env.DB.prepare(
      'select count(*) as n from verification',
    ).first<{ n: number }>()
    expect(after?.n).toBe(before?.n)
  })

  it('allowlisted read-only GETs are never limited', async () => {
    // Exhaust the shared default 'auth' bucket for this IP with cheap
    // sign-out POSTs, then confirm the session poll still passes while
    // a non-allowlisted request on the same bucket is refused.
    const ip = '203.0.113.6'
    for (let i = 0; i <= AUTH_DEFAULT_LIMIT; i++) {
      await authPost('/api/auth/sign-out', {}, ip)
    }
    expect((await authPost('/api/auth/sign-out', {}, ip)).status).toBe(429)

    const session = await app.request(
      '/api/auth/get-session',
      { headers: { 'cf-connecting-ip': ip } },
      env,
    )
    expect(session.status).toBe(200)
  })
})
