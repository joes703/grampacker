import { app } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import { apiRequest } from '../test/api-helpers'

// The routes an anonymous caller may reach. Every other route is
// session-gated, today in one of two ways (server/index.ts): /me, /categories and
// /gear-items gate themselves, and one hoisted gate covers everything under
// /lists, food included. The routes are read from the app's own router, so a
// route added later is probed without anyone listing it here.
const PUBLIC_ROUTES = [
  'GET /api/auth/*',
  'POST /api/auth/*',
  'GET /api/shares/v2/:slug',
  'GET /api/health',
]

// Middleware and the catch-all fallbacks register with method 'ALL' on a
// wildcard path, and this test cannot probe a wildcard. So every such
// registration is listed, once per registration (server/index.ts and the
// route files). A new one, even on a path already listed, fails here until
// someone has checked whether it is middleware or an endpoint that needs the
// session gate.
const WILDCARD_REGISTRATIONS = [
  '/*', // securityHeaders
  '/*', // the static-asset fallback
  '/api/*', // apiBodyLimit
  '/api/*', // csrfProtection
  '/api/*', // the JSON 404 fallback
  '/api/auth/*', // authRateLimit
  '/api/lists/*', // requireSession, hoisted
  '/api/me/*', // requireSession
  '/api/categories/*', // requireSession
  '/api/gear-items/*', // requireSession
  '/api/shares/*', // attachPublicShares
]

describe('session gate', () => {
  it('answers 401 to an anonymous caller on every non-public API route', async () => {
    const wildcards = app.routes
      .filter((r) => r.method === 'ALL' && r.path.endsWith('*'))
      .map((r) => r.path)
    expect(wildcards.sort()).toEqual([...WILDCARD_REGISTRATIONS].sort())

    // Every other registration is probed, whatever its path: /api itself
    // and any route outside /api need the gate as much as /api/... does. An
    // .all() endpoint on a plain path is a route like any other; GET reaches
    // it.
    const routes = app.routes
      .filter((r) => !(r.method === 'ALL' && r.path.endsWith('*')))
      .map((r) => `${r.method === 'ALL' ? 'GET' : r.method} ${r.path}`)
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

    // The probe fills each :param with a fresh random value, so no literal
    // route can match a probe URL ahead of the route under test. Any other
    // pattern (a regex constraint such as :id{[0-9]+}, an optional param, a
    // wildcard) would be probed at a URL its handler may never match, and the
    // 401 would come from somewhere else. Such a pattern fails here until
    // this test can build a URL for it.
    expect(gated.filter((route) => !/^[A-Z]+ (\/[A-Za-z0-9_-]*|\/:[A-Za-z]+)+$/.test(route))).toEqual([])

    const answers: string[] = []
    for (const route of gated) {
      const [method = '', pattern = ''] = route.split(' ')
      const path = pattern.replace(/:[A-Za-z]+/g, () => `p${crypto.randomUUID()}`)
      // No body: the gate must answer before any body validation does.
      const res = await apiRequest(null, method, path)
      answers.push(`${route} -> ${res.status}`)
    }
    expect(answers).toEqual(gated.map((route) => `${route} -> 401`))
  })
})
