import type { z } from 'zod'
import { CSRF_HEADER, type ApiErrorBody } from '../../shared/api'
import { revalidateSessionAfterUnauthorized } from './session-revalidation'

// The SPA's single door to /api/*. Owns the three cross-cutting concerns
// so no call site can forget one: the anti-CSRF header on unsafe methods,
// JSON encoding, and error normalization. Responses are validated against
// the shared zod DTOs - a missing or wrong-typed field surfaces as a loud
// client error, never as undefined leaking into the UI; unexpected fields
// strip at runtime and fail in CI (see apiFetch below for the full
// contract).

export class ApiError extends Error {
  readonly status: number
  // Present only on unhandled 5xx, and only when the server actually logged the
  // incident - it stops minting ids once its per-window budget is spent, rather
  // than handing out one that cannot be found. Developer-only: it joins a
  // DevTools console line to a server log entry. There is deliberately no
  // "quote this to support" UI, because there is no support process to quote it
  // to.
  readonly correlationId?: string

  constructor(status: number, message: string, correlationId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.correlationId = correlationId
  }
}

type FetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

async function rawFetch(path: string, opts: FetchOptions): Promise<Response> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers[CSRF_HEADER] = '1'
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    // Before the body, not after. A 401 is reason enough to re-check the session
    // whether or not the body ever arrives, and `await res.json()` below can stall on
    // a truncated or hanging response - which would swallow the one signal that gets
    // the user out of a dead session. Status decides; the body is only ever the
    // message. (Re-check, not conclude: an edge or proxy can produce a 401 that says
    // nothing about the app session. The server's answer settles it, not this line.)
    if (res.status === 401) revalidateSessionAfterUnauthorized()
    const body = await res
      .json()
      .then((parsed) => parsed as ApiErrorBody | null)
      .catch(() => null)
    throw new ApiError(
      res.status,
      body?.error ?? `Request failed (${res.status})`,
      body?.correlationId,
    )
  }
  return res
}

// The QueryClient's retry rule (wired in App.tsx). Lives here because it is a
// statement about ApiError, which this module owns.
//
// A 401 is not a blip: `requireSession` said there is no session, and retrying the
// same request with the same absent cookie asks the same question and gets the same
// answer. Worse, the retry is a second 401, which is a second reason to re-check a
// session that is already being re-checked. Everything else keeps the single retry
// that smooths a transient failure without hammering a down server.
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return false
  return failureCount < 1
}

// For endpoints that return a JSON body, validated against its DTO schema.
//
// The exact contract, stated precisely because an earlier comment claimed
// more than the code did: a MISSING or WRONG-TYPED field fails here at
// runtime; an UNEXPECTED field is silently STRIPPED here and fails in CI
// instead (the response-contract tests parse ONE REPRESENTATIVE endpoint
// per response schema as raw JSON against a deep-strict variant, and the
// share route re-validates its own output server-side on every request).
// Runtime tolerance is deliberate: during a deploy
// window an open tab's old bundle can receive one additive field from the
// newer server, and rejecting it would report a COMMITTED write - a gear
// import, say - as a retryable failure, inviting duplicates.
//
// Tolerance covers only fields the server ADDS. REMOVING a field an older
// bundle still requires throws here, and nothing in this function can prevent
// it - the schema doing the throwing shipped inside that old bundle. So a
// stale tab may report a failure for a write that landed.
//
// Owner's decision: that case is fixed by a refresh, which is cheaper than
// keeping dead fields on the wire forever or staging a two-release removal
// for every field this app stops using. So: keep
// tolerating additive change, do not keep dead fields to protect tabs nobody
// has open, and treat reload as the remedy.
export async function apiFetch<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  opts: FetchOptions = {},
): Promise<z.infer<Schema>> {
  const res = await rawFetch(path, opts)
  return schema.parse(await res.json()) as z.infer<Schema>
}

// For 204-No-Content endpoints (deletes, reorders, bulk ops).
export async function apiFetchVoid(
  path: string,
  opts: FetchOptions = {},
): Promise<void> {
  await rawFetch(path, opts)
}
