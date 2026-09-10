import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from './index'
import { resetLogBudget } from './middleware/error-handler'
import { signUpVerifiedUser } from './test/auth-helpers'

// What better-auth's failures write to the log, end to end through the real
// app. Two leaks are closed here and both are proven against the installed
// libraries rather than a mock of them:
//
//   - a failed SESSION LOOKUP used to log the session token, because
//     better-auth's default logger handed the raw Drizzle error (bound params
//     included) to console.error, outside our budget;
//   - a plain Error escaping an endpoint used to be logged raw by better-call
//     itself (`# SERVER_ERROR: `), outside our budget, and a missing mail key
//     used to be no error at all - the console sender printed the redeemable
//     link and reported success.

const ORIGIN = 'http://localhost:5173'
const PROD_ORIGIN = 'https://grampacker.app'
const MARKER = 'SABOTAGE_MARKER_d1_is_down'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The real D1 binding with statement EXECUTION replaced: prepare and bind
// succeed (so drizzle-orm builds its wrapper with the real query and params)
// and every execute method rejects. `batch` is left real - the session
// lookup does not use it. The rate limiter's own statements are spared, so a
// request gets PAST the limiter (which would otherwise fail first, through
// the Hono handler, and prove nothing about better-auth). Every sabotaged
// statement's bound params are recorded so a test can prove the failing
// statement actually carried the value it asserts is absent.
function sabotagedD1(
  seen: unknown[],
  // Which statements explode. Default: everything but the limiter's.
  doomed: (query: string) => boolean = () => true,
): D1Database {
  const bindTo = (target: object, prop: string | symbol, receiver: unknown) => {
    const value = Reflect.get(target, prop, receiver)
    return typeof value === 'function' ? value.bind(target) : value
  }
  const explode = async () => {
    throw new Error(`D1_ERROR: ${MARKER}`)
  }
  return new Proxy(env.DB, {
    get(db, prop) {
      if (prop !== 'prepare') return bindTo(db, prop, db)
      return (query: string) => {
        const stmt = db.prepare(query)
        if (query.includes('rate_limits') || !doomed(query)) return stmt
        return new Proxy(stmt, {
          get(s, sProp) {
            if (sProp !== 'bind') return bindTo(s, sProp, s)
            return (...params: unknown[]) => {
              seen.push(...params)
              const bound = s.bind(...params)
              return new Proxy(bound, {
                get(b, bProp) {
                  if (bProp === 'all' || bProp === 'run' || bProp === 'raw' || bProp === 'first') {
                    return explode
                  }
                  return bindTo(b, bProp, b)
                },
              })
            }
          },
        })
      }
    },
  })
}

let nextIp = 0
function clientIp() {
  nextIp += 1
  return `10.77.0.${nextIp}`
}

describe('auth failures in the log', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  let consoleWarn: ReturnType<typeof vi.spyOn>
  let consoleLog: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
    consoleWarn.mockRestore()
    consoleLog.mockRestore()
  })

  const everything = () =>
    [...consoleError.mock.calls, ...consoleWarn.mock.calls, ...consoleLog.mock.calls]
      .flat()
      .map(String)
      .join('\n')

  // Every line the server writes is one JSON entry from the incident
  // handler. A line that does not parse is a sink outside the budget - the
  // better-call fallback this suite exists to keep closed.
  const assertOnlyBudgetedLines = () => {
    for (const [line] of [...consoleError.mock.calls, ...consoleWarn.mock.calls]) {
      expect(() => JSON.parse(String(line))).not.toThrow()
    }
  }

  it('never logs the session token when the session lookup fails', async () => {
    const email = `log-${crypto.randomUUID()}@example.com`
    const { cookie } = await signUpVerifiedUser(email, '')
    // `<name>=<token>.<hmac>`, percent-encoded; the session row is keyed by
    // the token ahead of the signature (see makeSessionStale).
    const [token] = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).split('.')
    expect(token).toBeTruthy()
    // Sign-up wrote the console email on purpose; start the capture clean.
    consoleError.mockClear()
    consoleWarn.mockClear()
    consoleLog.mockClear()

    const seen: unknown[] = []
    const res = await app.request(
      '/api/auth/get-session',
      { headers: { Cookie: cookie, Origin: ORIGIN, 'cf-connecting-ip': clientIp() } },
      { ...env, DB: sabotagedD1(seen) },
    )
    expect(res.status).toBe(500)
    // The failing statement really was the token lookup.
    expect(seen).toContain(token)

    const out = everything()
    expect(out).not.toContain(token!)
    expect(out).toContain(MARKER)
    assertOnlyBudgetedLines()

    const body = (await res.json()) as { correlationId?: string }
    expect(body.correlationId).toMatch(UUID_RE)
  })

  it('never logs the session token when the user read after the session read fails', async () => {
    // The lookup is two statements: the session row by token, then the user
    // row by id (better-auth joins in JS - the installed Drizzle adapter has
    // no native join). A failure on the SECOND read goes through the adapter
    // factory's fallback-join catch, which writes `console.error(error)` on
    // its own before rethrowing (@better-auth/core db/adapter/factory.mjs) -
    // a sink nothing in this repo can route through the sanitizer or the
    // budget. What that raw line can carry is the failed statement's bound
    // value, the user id; the token was bound to the statement that
    // succeeded. This pins that boundary: the token stays out of the log even
    // on this path. The raw line's existence is recorded in SECURITY.md.
    const email = `log2-${crypto.randomUUID()}@example.com`
    const { cookie } = await signUpVerifiedUser(email, '')
    const [token] = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).split('.')
    consoleError.mockClear()
    consoleWarn.mockClear()
    consoleLog.mockClear()

    const seen: unknown[] = []
    const res = await app.request(
      '/api/auth/get-session',
      { headers: { Cookie: cookie, Origin: ORIGIN, 'cf-connecting-ip': clientIp() } },
      { ...env, DB: sabotagedD1(seen, (query) => query.includes('"user"')) },
    )
    expect(res.status).toBe(500)
    // The session read succeeded (its token was never bound to a doomed
    // statement); the user read is what failed.
    expect(seen).not.toContain(token)
    expect(seen.length).toBeGreaterThan(0)

    const out = everything()
    expect(out).not.toContain(token!)
    expect(out).toContain(MARKER)
    expect(consoleLog).not.toHaveBeenCalled()
  })

  it('logs a non-APIError through the budget, never through better-call', async () => {
    // magic-link/verify consumes the verification row with no try/catch of
    // its own (plugins/magic-link/index.mjs), so the Drizzle error escapes
    // the endpoint - the path on which better-call used to console.error the
    // raw object (params included) and better-auth used to log err.message
    // alone whenever it mentioned a table.
    const seen: unknown[] = []
    const res = await app.request(
      '/api/auth/magic-link/verify?token=not-a-real-token',
      { headers: { Origin: ORIGIN, 'cf-connecting-ip': clientIp() } },
      { ...env, DB: sabotagedD1(seen) },
    )
    expect(res.status).toBe(500)
    expect(seen.length).toBeGreaterThan(0)

    const out = everything()
    for (const param of seen) {
      if (typeof param === 'string' && param.length >= 8) expect(out).not.toContain(param)
    }
    expect(out).toContain(MARKER)
    expect(out).not.toContain('SERVER_ERROR: ')
    assertOnlyBudgetedLines()

    const body = (await res.json()) as { correlationId?: string; code?: string }
    expect(body.code).toBe('INTERNAL_SERVER_ERROR')
    expect(body.correlationId).toMatch(UUID_RE)
  })

  it('fails a magic-link send closed when no mail key is set outside local dev', async () => {
    // The test bindings carry no RESEND_API_KEY; only the origin changes.
    const prodEnv = { ...env, BETTER_AUTH_URL: PROD_ORIGIN }
    const res = await app.request(
      '/api/auth/sign-in/magic-link',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: PROD_ORIGIN,
          'cf-connecting-ip': clientIp(),
        },
        body: JSON.stringify({ email: `nokey-${crypto.randomUUID()}@example.com` }),
      },
      prodEnv,
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { correlationId?: string; code?: string }
    expect(body.code).toBe('INTERNAL_SERVER_ERROR')
    expect(body.correlationId).toMatch(UUID_RE)

    const out = everything()
    // No link was printed anywhere - not by the console sender, not by a
    // fallback logger.
    expect(consoleLog).not.toHaveBeenCalled()
    expect(out).not.toContain('token=')
    expect(out).not.toContain('[email:dev]')
    // The operator can see WHY from the correlated entry.
    expect(out).toContain('not configured')
    assertOnlyBudgetedLines()

    // The rest of auth keeps working without a mail key: the failure is at
    // send time, not at construction.
    const session = await app.request(
      '/api/auth/get-session',
      { headers: { Origin: PROD_ORIGIN, 'cf-connecting-ip': clientIp() } },
      prodEnv,
    )
    expect(session.status).toBe(200)
  })
})
