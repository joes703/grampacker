import { describe, expect, it } from 'vitest'
import { requestDeps } from './index'
import { env } from './test/node-env'

// `c.env` is what every request handler can reach. It carries only what a
// request reads: no raw SQLite handle (route handlers get user-scoped
// repositories, AGENTS.md "Invariants"), no mail API key, no static
// directory. BETTER_AUTH_SECRET stays because the rate limiter keys its
// email-bucket HMAC with it. Asserted at runtime because a spread of the
// whole configuration would still type-check.
describe('requestDeps', () => {
  it('hands requests exactly the dependencies they read', () => {
    expect(Object.keys(requestDeps(env)).sort()).toEqual([
      'BETTER_AUTH_SECRET',
      'auth',
      'db',
      'origin',
    ])
  })
})
