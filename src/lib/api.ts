import type { z } from 'zod'
import { CSRF_HEADER, type ApiErrorBody } from '../../shared/api'

// The SPA's single door to /api/*. Owns the three cross-cutting concerns
// so no call site can forget one: the anti-CSRF header on unsafe methods,
// JSON encoding, and error normalization. Responses are validated against
// the shared zod DTOs - shape drift surfaces as a loud client error (and
// in tests), never as undefined leaking into the UI.

export class ApiError extends Error {
  readonly status: number
  // Present only on unhandled 5xx, and only when the server actually logged the
  // incident - it stops minting ids once its per-window budget is spent, rather
  // than handing out one that cannot be found. Developer-only: it joins a
  // DevTools console line to a Workers Logs entry. There is deliberately no
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

// For endpoints that return a JSON body, validated against its DTO schema.
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
