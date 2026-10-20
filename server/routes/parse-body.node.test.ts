import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { parseBody } from './parse-body'

// The helper's own contract, tested without a database: the uniform 400
// response, the malformed-JSON path, and that schema output (defaults,
// transforms) reaches the caller typed.
const schema = z.object({
  name: z.string().min(1),
  count: z.number().int().default(1),
})

const app = new Hono()
app.post('/echo', async (c) => {
  const parsed = await parseBody(c, schema)
  if (!parsed.ok) return parsed.response
  // The annotation proves the output type (with the default applied)
  // survives the helper; a type error here fails the build.
  const data: { name: string; count: number } = parsed.data
  return c.json(data)
})

const post = (body: string) =>
  app.request('/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })

describe('parseBody', () => {
  it('returns the schema output, defaults applied', async () => {
    const res = await post(JSON.stringify({ name: 'tent' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'tent', count: 1 })
  })

  it('answers 400 with the shared copy for malformed JSON', async () => {
    const res = await post('{not json')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request body' })
  })

  it('rejects malformed JSON even when the schema would accept an empty object', async () => {
    // Guards the null sentinel: if the catch produced {} instead, an
    // all-defaults schema would silently accept a body that never parsed.
    const lax = z.object({ count: z.number().default(1) })
    const laxApp = new Hono()
    laxApp.post('/lax', async (c) => {
      const parsed = await parseBody(c, lax)
      if (!parsed.ok) return parsed.response
      return c.json(parsed.data)
    })
    const res = await laxApp.request('/lax', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })

  it('answers 400 with the shared copy for a body the schema rejects', async () => {
    const res = await post(JSON.stringify({ name: '' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request body' })
  })

  it('treats a missing body as malformed, not as an empty object', async () => {
    const res = await app.request('/echo', { method: 'POST' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request body' })
  })
})
