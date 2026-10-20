import type { Context } from 'hono'
import type { z } from 'zod'

// The one way a route reads a JSON body. Malformed JSON and a failed schema
// are the same answer on purpose: the client sent something the API cannot
// act on, and distinguishing the two tells it nothing useful. Every route
// returns `parsed.response` unchanged so the copy cannot drift per file
// again (food said 'Invalid request' for a while; the API tests pin the
// shared wording).
export async function parseBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const raw: unknown = await c.req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: c.json({ error: 'Invalid request body' }, 400) }
  }
  return { ok: true, data: parsed.data }
}
