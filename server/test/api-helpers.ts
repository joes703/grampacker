import { env } from 'cloudflare:test'
import app from '../index'
import { CSRF_HEADER } from '../middleware/csrf'

const ORIGIN = 'http://localhost:5173'

// Authenticated (or anon, cookie=null) JSON request through the real app,
// with the CSRF header the SPA's fetch wrapper always sends.
export async function apiRequest(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    [CSRF_HEADER]: '1',
    ...extraHeaders,
  }
  if (cookie) headers.Cookie = cookie
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return app.request(
    path,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    env,
  )
}
