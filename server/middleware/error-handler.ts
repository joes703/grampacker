import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ApiErrorBody } from '../../shared/api'

// The server's single incident handler. Before this existed the whole server
// held one `console.` call (the dev email sender) and no `onError`, so every
// unhandled throw became Hono's bare `Internal Server Error`: no correlation id,
// no route, no way to tell a database failure from a programmer mistake.
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
// Messages and SQL text are bounded for the same reason - and because a
// message can be user-controlled (a repo throw that quotes a client id).
const TEXT_LIMIT_BYTES = 2048
// How far down `.cause` an entry follows. Drizzle -> SQLite is two links,
// and a wrapper adds one; anything deeper is noise, and a cycle must not spin.
const CAUSE_DEPTH_LIMIT = 5

// What an entry may say about an error. THIS IS THE ONLY SHAPE THAT REACHES
// A LOG LINE. The rule it enforces: bound query parameters never appear.
//
// Drizzle wraps every failed statement in DrizzleQueryError, whose message is
// `Failed query: <sql>\nparams: <every bound value>` (drizzle-orm/errors.js)
// and whose V8 stack repeats that message as its header. The values are
// whatever the request carried - gear names, costs, and on a session lookup
// during a database failure, the session token itself. The raw SQLite text on the
// cause chain (`UNIQUE constraint failed: lists.slug`, `no such table`) never
// embeds values, and is the diagnostic that actually matters - yet before this
// existed only the outermost wrapper was logged, so entries leaked the values
// and omitted the diagnosis. db-errors.ts learned the same lesson for
// classification (match the root cause, never a wrapper); this is the logging
// half.
//
// Recognition is by shape, not `instanceof`: an error carrying a `params`
// property is treated as parameter-bearing whether or not it is Drizzle's
// class, and its message is replaced outright rather than filtered. A message
// STRING in Drizzle's format is cut at the first `\nparams: ` too, because
// better-auth sometimes re-logs `err.message` on its own (api/index.mjs). Cut
// at the FIRST marker: a bound value could itself contain the marker, and
// cutting early drops more, never less.
//
// Stacks: the header is removed by exact match against `${name}: ${message}`
// and the frames kept only if that match succeeds. Searching for the first
// `    at ` line instead would be fooled by a parameter containing a fake
// frame (Codex finding); an unrecognized layout logs no stack at all.
export type LoggedError = {
  name: string
  message: string
  stack?: string
  cause?: { name: string; message: string }[]
}

const PARAMS_MARKER = '\nparams: '

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function hasParams(err: object): boolean {
  return 'params' in err
}

// A string that may be a Drizzle message rendered somewhere else.
function scrubMessageText(text: string): string {
  const cut = text.indexOf(PARAMS_MARKER)
  const kept = cut === -1 ? text : `${text.slice(0, cut)} (bound params redacted)`
  return truncate(kept, TEXT_LIMIT_BYTES)
}

function scrubbedMessage(err: object): string {
  if (hasParams(err)) {
    const query = (err as { query?: unknown }).query
    return typeof query === 'string'
      ? `Failed query (bound params redacted): ${truncate(query, TEXT_LIMIT_BYTES)}`
      : 'Failed query (bound params redacted)'
  }
  const message = (err as { message?: unknown }).message
  // Only a string message is logged as text. Coercing an object would run
  // its own toString / toStringTag, which is a way for arbitrary content to
  // reach the log; describe its type instead.
  if (typeof message === 'string') return scrubMessageText(message)
  return message === undefined ? '' : `[non-string message: ${typeof message}]`
}

function nameOf(err: object): string {
  const name = (err as { name?: unknown }).name
  return typeof name === 'string' && name !== ''
    ? truncate(name, 128)
    : 'Error'
}

function scrubbedStack(err: Error): string | undefined {
  if (hasParams(err)) return undefined
  const { stack } = err
  if (typeof stack !== 'string') return undefined
  // V8 renders `${name}: ${message}` (or just the name for an empty message)
  // and then the frames. Anything else is not a layout this code understands.
  const header = err.message === '' ? err.name : `${err.name}: ${err.message}`
  // The header must end exactly where the frames begin. A prefix match alone
  // would keep whatever a hand-built stack appended to its first line.
  if (stack !== header && !stack.startsWith(`${header}\n`)) return undefined
  const frames = stack.slice(header.length).replace(/^\n/, '')
  return frames === '' ? undefined : frames.slice(0, STACK_LIMIT_BYTES)
}

export function describeError(err: unknown): LoggedError {
  if (typeof err !== 'object' || err === null) {
    return { name: typeof err, message: scrubMessageText(String(err)) }
  }
  const entry: LoggedError = {
    name: nameOf(err),
    message: scrubbedMessage(err),
  }
  if (err instanceof Error) {
    const stack = scrubbedStack(err)
    if (stack !== undefined) entry.stack = stack
  }

  const seen = new Set<object>([err])
  const cause: { name: string; message: string }[] = []
  let link: unknown = (err as { cause?: unknown }).cause
  while (
    typeof link === 'object' &&
    link !== null &&
    !seen.has(link) &&
    cause.length < CAUSE_DEPTH_LIMIT
  ) {
    seen.add(link)
    cause.push({ name: nameOf(link), message: scrubbedMessage(link) })
    link = (link as { cause?: unknown }).cause
  }
  if (cause.length > 0) entry.cause = cause
  return entry
}

// Anonymous routes exist (/api/health, /api/shares/v2/:slug), reachable
// without a session, so without a ceiling anyone can drive unbounded log
// writes - and a database failure makes every one of those requests fail at
// once, which is exactly when the logs need to be readable.
//
// Two shapes were tried and rejected before this one, recorded so they are not
// re-proposed: leaning on the rate limits (database-backed, so they fail in
// the same outage they were invoked for), and shrinking each over-budget
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
// Per process. Restarting the process resets the counter; that costs log
// fidelity, never correctness.
const WINDOW_MS = 60_000
const DETAILED_BUDGET = 20

let windowStartedAt = 0
let detailedThisWindow = 0
let suppressionAnnounced = false

type LogSlot = 'detailed' | 'announce-suppression' | 'silent'

// SYNCHRONOUS BY CONSTRUCTION. The ceiling holds because the window check, the
// reset, the increment, and the decision happen with nothing suspending between
// them. Do not make this async, and do not await anything inside it.
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

// Exported for tests only: module state survives across cases in one process, so
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
// The one-line announcement written when the log budget trips, built in one
// place so the two writers below cannot drift apart.
function suppressionAnnouncement(path?: string): string {
  return JSON.stringify({
    event: 'server-error-suppressed',
    detail: `more than ${DETAILED_BUDGET} errors in ${WINDOW_MS}ms; further errors in this window are not logged`,
    ...(path === undefined ? {} : { path }),
  })
}

function recordIncident({ source, method, path, status, err }: Incident): string | undefined {
  const slot = claimLogSlot(Date.now())
  if (slot === 'silent') return undefined

  if (slot === 'announce-suppression') {
    console.error(suppressionAnnouncement(path))
    return undefined
  }

  const correlationId = crypto.randomUUID()
  const error = err === undefined ? undefined : describeError(err)
  // One JSON string keeps one entry rather than splitting a multi-argument call
  // across lines.
  console.error(
    JSON.stringify({
      event: 'server-error',
      source,
      correlationId,
      method,
      path,
      status,
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      cause: error?.cause,
    }),
  )
  return correlationId
}

// better-auth's own log calls, routed through the same budget and the same
// error shape. Without this better-auth builds its default console logger,
// which hands the RAW error object to console.error - the Drizzle wrapper
// with the session token in its params on a failed session lookup - and it
// does so outside the ceiling above, once per request, which is exactly the
// unbounded outage write the ceiling exists to prevent. The default level is
// `warn`, so better-auth only calls this for warnings and errors.
//
// Both positions are sanitized: the declared signature says the first
// argument is a string, but better-auth passes an Error there in places
// (api/routes/session.mjs list-sessions) and createLogger forwards it
// unchanged.
export function recordAuthLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: unknown,
  ...args: unknown[]
): void {
  const slot = claimLogSlot(Date.now())
  if (slot === 'silent') return
  const sink = level === 'warn' ? console.warn : console.error
  if (slot === 'announce-suppression') {
    sink(suppressionAnnouncement())
    return
  }
  const describe = (value: unknown) =>
    typeof value === 'object' && value !== null
      ? describeError(value)
      : scrubMessageText(String(value))
  sink(
    JSON.stringify({
      event: 'auth-log',
      level,
      message: describe(message),
      details: args.length === 0 ? undefined : args.map(describe),
    }),
  )
}

// The `logger` option handed to better-auth (server/auth.ts).
export const authLogger = {
  log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    ...args: unknown[]
  ) => recordAuthLog(level, message, ...args),
}

// /api/auth/* failures never reach the handler below: better-call answers an
// APIError with a Response, and the /api/auth/* route in server/index.ts
// catches any other error. This brings both into the same scheme.
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
  // The error behind the response, when one escaped better-auth's handler
  // (the /api/auth/* route in server/index.ts). Absent for a 5xx better-auth
  // answered itself, such as an APIError.
  err?: unknown,
): Promise<Response> {
  if (res.status < 500) return res

  const correlationId = recordIncident({
    source: 'auth-response',
    method: req.method,
    path: req.path,
    status: res.status,
    err,
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

export const errorHandler: ErrorHandler = (err, c) => {
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

  // Security headers are added by the root app's securityHeaders middleware,
  // which sets them after `await next()` on this response too.
  const headers = new Headers()
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
