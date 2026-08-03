import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { isDevEnvironment, securityHeaderMap } from './security-headers'
import type { ApiErrorBody } from '../../shared/api'

// The server's single incident handler. Before this existed the whole server
// held one `console.` call (the dev email sender) and no `onError`, so every
// unhandled throw became Hono's bare `Internal Server Error`: no correlation id,
// no route, no way to tell a D1 failure from a programmer mistake.
//
// What it covers, stated narrowly because the boundary is not obvious: errors
// thrown in the Hono dispatch pipeline before the response is finalized. It does
// NOT cover /api/auth/*, because better-call catches every throw inside its own
// router and returns a Response (see the wrapper in server/index.ts). It does
// not cover detached async work either - the app has no streaming responses and
// no waitUntil call sites, and if either is ever added it owns its own error
// reporting, because a response-level handler cannot reach into a task that
// outlives the response.

// Operational headers worth carrying over from a deliberate 5xx. Retry-After is
// the only one today: a maintenance or overload middleware that answers 503 is
// telling the client WHEN to come back, and replacing the body must not throw
// that away.
const PRESERVED_HEADERS = ['Retry-After']

// Stacks are the bulk of an entry's bytes; the identity of the incident is not.
const STACK_LIMIT_BYTES = 2048

// Anonymous, unmetered routes exist (/api/health, /api/shares/:slug), so without
// a ceiling anyone can drive unbounded log writes - and a D1 outage makes every
// one of those requests fail at once, which is exactly when the logs need to be
// readable.
//
// Two shapes were tried and rejected before this one, recorded so they are not
// re-proposed: leaning on PR 7.8's rate limits (unlanded, and D1-backed, so it
// fails in the same outage it was invoked for), and shrinking each over-budget
// entry (bounds bytes, not entries - the count still tracks request count).
//
// The ceiling is 21 entries per window per isolate: 20 detailed, plus one line
// announcing that suppression started. There is deliberately NO end-of-window
// summary. Nothing could fire it - this state is request-driven, so if traffic
// stops after suppression begins no request performs the rollover, an evicted
// isolate loses the count outright, and waitUntil caps at 30s so it cannot carry
// a 60s deferral. A count that arrives only when convenient reads as
// authoritative and is not.
//
// Per ISOLATE: with many isolates the effective cap is a multiple of 21. This
// bounds what one isolate writes, not what the platform writes in aggregate.
// Losing the counter on isolate recycle costs log fidelity, never correctness.
const WINDOW_MS = 60_000
const DETAILED_BUDGET = 20

let windowStartedAt = 0
let detailedThisWindow = 0
let suppressionAnnounced = false

type LogSlot = 'detailed' | 'announce-suppression' | 'silent'

// SYNCHRONOUS BY CONSTRUCTION. Workers interleave requests at every await point,
// so the ceiling holds only because the window check, the reset, the increment,
// and the decision happen with nothing suspending between them. Do not make this
// async, and do not await anything inside it.
function claimLogSlot(now: number): LogSlot {
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now
    detailedThisWindow = 0
    suppressionAnnounced = false
  }
  if (detailedThisWindow < DETAILED_BUDGET) {
    detailedThisWindow += 1
    return 'detailed'
  }
  if (!suppressionAnnounced) {
    suppressionAnnounced = true
    return 'announce-suppression'
  }
  return 'silent'
}

// Exported for tests only: module state survives across cases in one isolate, so
// a test that does not reset it would inherit the previous test's budget.
export function resetLogBudget(): void {
  windowStartedAt = 0
  detailedThisWindow = 0
  suppressionAnnounced = false
}

type Incident = {
  source: 'http-exception' | 'throw' | 'auth-response'
  method: string
  path: string
  status: number
  err?: unknown
}

// Claims a log slot and writes the entry. Returns a correlation id if and only
// if the incident was actually logged in full - the caller must not hand one to
// a client otherwise. No user id, deliberately: it is not resolved at throw time
// on every route, the app has one user, and an identifier in logs for no signal
// is not free.
function recordIncident({ source, method, path, status, err }: Incident): string | undefined {
  const slot = claimLogSlot(Date.now())
  if (slot === 'silent') return undefined

  if (slot === 'announce-suppression') {
    console.error(
      JSON.stringify({
        event: 'server-error-suppressed',
        detail: `more than ${DETAILED_BUDGET} errors in ${WINDOW_MS}ms; further errors in this window are not logged`,
        path,
      }),
    )
    return undefined
  }

  const correlationId = crypto.randomUUID()
  const error = err instanceof Error ? err : undefined
  // One JSON string, so Workers Logs keeps one entry rather than splitting a
  // multi-argument call across lines.
  console.error(
    JSON.stringify({
      event: 'server-error',
      source,
      correlationId,
      method,
      path,
      status,
      name: error?.name ?? (err === undefined ? undefined : typeof err),
      message: error?.message ?? (err === undefined ? undefined : String(err)),
      stack: error?.stack?.slice(0, STACK_LIMIT_BYTES),
    }),
  )
  return correlationId
}

// better-call catches every throw inside its own router and returns a Response,
// so /api/auth/* failures never reach the handler below. This brings them into
// the same scheme from the outside.
//
// The id has to ride in the BODY: @better-fetch/fetch returns
// {...parsedJsonBody, status, statusText} to callers and drops response headers
// entirely, so a header would be invisible to every auth caller in the SPA.
//
// Rewriting that body is only safe with care, and NOT because the body is always
// empty - an earlier draft assumed that and was wrong. better-auth throws
// APIError-derived 500s with real bodies (api/routes/session.mjs:257 ->
// {message, code}), and the same route calls deleteSessionCookie, so these
// responses can carry Set-Cookie. Losing that header would leave a dead session
// cookie in the browser - the bug PR 4.3 just fixed, reintroduced from the
// server side.
export async function withAuthErrorCorrelation(
  res: Response,
  req: { method: string; path: string },
): Promise<Response> {
  if (res.status < 500) return res

  const correlationId = recordIncident({
    source: 'auth-response',
    method: req.method,
    path: req.path,
    status: res.status,
  })
  if (correlationId === undefined) return res

  // Read the CLONE, never the original. Deciding whether a body is JSON means
  // reading it, and reading the original locks its stream - so every "return it
  // untouched" path below would hand back an unusable response. The original is
  // returnable precisely because it was never read.
  const raw = await res
    .clone()
    .text()
    .catch(() => null)
  if (raw === null) return res

  let body: unknown
  if (raw === '') {
    // better-call's generic 500 is `new Response(null, {status: 500})`. Nothing
    // is overwritten because there is nothing there.
    body = {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal Server Error',
      correlationId,
    }
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Malformed or non-JSON: hand back the original byte-for-byte rather than
      // guessing at a shape.
      return res
    }
    // Only a non-null, non-array OBJECT can gain a field without changing shape.
    // An array, string, number or null cannot, so they take the untouched path.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return res
    }
    body = { ...parsed, correlationId }
  }

  // The original Headers OBJECT is passed through, not a copied plain map:
  // multiple Set-Cookie values do not survive a round trip through an object.
  // better-call strips content-length from its responses, so the new body length
  // cannot contradict a stale header.
  return new Response(JSON.stringify(body), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

export const errorHandler: ErrorHandler<{ Bindings: Env }> = (err, c) => {
  const httpException = err instanceof HTTPException ? err : null

  // A sub-500 HTTPException is a deliberate answer from a middleware, not an
  // incident. Hand back its own response untouched and log nothing.
  if (httpException && httpException.status < 500) {
    return httpException.getResponse()
  }

  // A >=500 HTTPException is an incident that happens to arrive in exception
  // form, and its message cannot be trusted to the client: installed Hono throws
  // HTTPException(500) itself when cloning an already-consumed request, carrying
  // an implementation-detail message about req.json() and bodyCache.
  const status = httpException?.status ?? 500
  const source = httpException ? 'http-exception' : 'throw'

  const path = new URL(c.req.raw.url).pathname
  const correlationId = recordIncident({
    source,
    method: c.req.method,
    path,
    status,
    err,
  })

  const headers = new Headers()
  // The handler applies the header map ITSELF rather than relying on
  // securityHeaders above it. That middleware sets headers after `await next()`,
  // which does run when onError produces a response - but if securityHeaders is
  // the thing that threw, it never gets there. Failing closed here costs one
  // redundant assignment on the normal path.
  for (const [key, value] of Object.entries(
    securityHeaderMap({ dev: isDevEnvironment(c.env) }),
  )) {
    headers.set(key, value)
  }
  if (httpException) {
    const original = httpException.getResponse()
    for (const name of PRESERVED_HEADERS) {
      const value = original.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
  }

  // The thrown message never reaches the client. Repo throws carry internal
  // detail: `unknown category tempId: ...`, `list item lost its gear row`,
  // `slug generation exhausted retries`.
  if (path.startsWith('/api/')) {
    const body: ApiErrorBody = { error: 'Internal Server Error' }
    if (correlationId !== undefined) body.correlationId = correlationId
    headers.set('Content-Type', 'application/json')
    return new Response(JSON.stringify(body), { status, headers })
  }

  // SPA shell and assets. A JSON body on a document navigation is noise nothing
  // parses.
  headers.set('Content-Type', 'text/plain; charset=UTF-8')
  return new Response('Internal Server Error', { status, headers })
}
