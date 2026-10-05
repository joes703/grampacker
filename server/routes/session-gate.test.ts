import { describe, expect, it } from 'vitest'
import app from '../index'
import { apiRequest } from '../test/api-helpers'

// The routes an anonymous caller may reach. Everything else under /api is
// session-gated, in one of two ways (server/index.ts): /me, /categories and
// /gear-items gate themselves, and one hoisted gate covers everything under
// /lists, food included. The routes are read from the app's own router, so a
// route added later is probed without anyone listing it here.
const PUBLIC_ROUTES = [
  'GET /api/auth/*',
  'POST /api/auth/*',
  'GET /api/shares/v2/:slug',
  'GET /api/health',
]

describe('session gate', () => {
  it('answers 401 to an anonymous caller on every non-public API route', async () => {
    // Method 'ALL' entries are middleware and the 404 fallback, not routes.
    const routes = app.routes
      .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/'))
      .map((r) => `${r.method} ${r.path}`)
    expect(routes.filter((r) => PUBLIC_ROUTES.includes(r))).toEqual(PUBLIC_ROUTES)

    const gated = routes.filter((r) => !PUBLIC_ROUTES.includes(r))
    // Guards the loop against probing nothing, and pins one route from each
    // way of reaching the gate.
    expect(gated).toEqual(
      expect.arrayContaining([
        'GET /api/me',
        'DELETE /api/categories/:id',
        'POST /api/gear-items/bulk-move',
        'PUT /api/lists/:id/items/pack-order',
        'PATCH /api/lists/:id/food/items/:itemId',
      ]),
    )

    const answers: string[] = []
    for (const route of gated) {
      const [method = '', pattern = ''] = route.split(' ')
      const path = pattern.replace(/:[A-Za-z]+/g, 'some-id')
      // No body: the gate must answer before any body validation does.
      const res = await apiRequest(null, method, path)
      answers.push(`${route} -> ${res.status}`)
    }
    expect(answers).toEqual(gated.map((route) => `${route} -> 401`))
  })
})
