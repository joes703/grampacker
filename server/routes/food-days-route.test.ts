import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { foodRoutes } from './food'
import type { SessionVars } from '../middleware/session'
import type { AppEnv } from '../env'

// PUT /:id/food/days makes two repo calls - set the count, then re-read the
// plan - and the list can vanish between them. The handler used to pass the
// re-read's null straight out as a 200, which the client's non-null DTO parse
// then rejected. The window cannot be staged over the real app (its repos
// come from the session middleware), so the handler is mounted here with a
// repo fixture that answers exactly that sequence.
describe('PUT /:id/food/days when the list vanishes between the two repo calls', () => {
  it('answers 404, not a 200 with a null body', async () => {
    const app = new Hono<{ Bindings: AppEnv; Variables: SessionVars }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'u1')
      c.set('repos', {
        food: {
          setDayCount: async () => true,
          forList: async () => null,
        },
      } as unknown as SessionVars['repos'])
      await next()
    })
    app.route('/lists', foodRoutes)

    const res = await app.request('/lists/list-1/food/days', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 3 }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })
})
