import { describe, expect, it } from 'vitest'
import { listItemFailure } from '../routes/lists'

// The route half of the retryable 409s. The repositories now run each
// operation in one SQLite transaction, so the races these 409s once reported
// cannot be staged; the repositories keep the pack-rank 409 only as a
// backstop, and their own transaction tests stage it with test-only triggers
// (server/repos/pack-transactions.test.ts, food-transactions.test.ts,
// list-transactions.test.ts). What stays here is the mapping from a
// repository's `conflict` result to each route's status and wording.

describe('listItemFailure', () => {
  it('maps conflict to a 409 in the pack-order dialect', () => {
    expect(listItemFailure({ ok: false, reason: 'conflict' })).toEqual({
      status: 409,
      error: 'This bag changed while you were moving that item',
    })
  })

  it('keeps the existing mappings stable', () => {
    expect(listItemFailure({ ok: false, reason: 'not_found' }).status).toBe(404)
    expect(listItemFailure({ ok: false, reason: 'invalid_gear' }).status).toBe(400)
    expect(listItemFailure({ ok: false, reason: 'cap_exceeded' }).status).toBe(422)
  })
})

// The routes' side of the pack-order and location-delete 409s, with only the
// repos context stubbed to return the conflict result.
describe('pack-order and location-delete routes keep their 409 dialect', () => {
  it('the location-delete route answers a fallback conflict with 409', async () => {
    const { Hono } = await import('hono')
    const { packingLocationRoutes } = await import('../routes/packing-locations')
    const testApp = new Hono<{ Variables: { repos: unknown } }>()
    testApp.use('*', async (c, next) => {
      c.set('repos', {
        packingLocations: { remove: async () => 'conflict' as const },
      })
      await next()
    })
    testApp.route('/lists', packingLocationRoutes)

    const res = await testApp.request('/lists/some-list/packing-locations/some-loc', {
      method: 'DELETE',
    })
    expect(res.status).toBe(409)
  })

  it('the route answers the conflict with the 409 dialect', async () => {
    // The real listRoutes module, with only the repos context stubbed to
    // return the conflict result - so the route-side mapping (the branch the
    // matrix's 409 row points at) is exercised end to end.
    const { Hono } = await import('hono')
    const { listRoutes } = await import('../routes/lists')
    const testApp = new Hono<{ Variables: { repos: unknown } }>()
    testApp.use('*', async (c, next) => {
      c.set('repos', {
        packReorder: {
          reorder: async () => ({ ok: false, reason: 'conflict' }),
        },
      })
      await next()
    })
    testApp.route('/lists', listRoutes)

    const res = await testApp.request('/lists/some-list/items/pack-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: 'a', packSortOrder: 0 }]),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'This bag changed while you were reordering',
    })
  })
})
