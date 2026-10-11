import { env } from '../test/node-env'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { CSRF_HEADER } from './csrf'
import { signUpVerifiedUser } from '../test/auth-helpers'

// Cross-cutting CSRF posture (docs/authz-matrix.md): unsafe methods on
// non-auth routes require the custom x-grampacker-request header AND a
// matching Origin. These tests used to ride on PUT /api/me; that route is
// gone (grampacker stores no display name), so POST /api/lists is the
// vehicle now - any session-gated unsafe route exercises the same
// middleware, mounted app-wide ahead of the routers.

const ORIGIN = 'http://localhost:5173'

function postLists(headers: Record<string, string>) {
  return app.request(
    '/api/lists',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: 'CSRF probe' }),
    },
    env,
  )
}

describe('CSRF middleware (via POST /api/lists)', () => {
  it('without the custom header is 403, even with a valid session', async () => {
    const { cookie } = await signUpVerifiedUser('csrf-nohdr@example.com', 'C')
    const res = await postLists({ Origin: ORIGIN, Cookie: cookie })
    expect(res.status).toBe(403)
  })

  it('with a forged origin is 403, even with the header and a valid session', async () => {
    const { cookie } = await signUpVerifiedUser('csrf-origin@example.com', 'C')
    const res = await postLists({
      Origin: 'https://evil.example',
      [CSRF_HEADER]: '1',
      Cookie: cookie,
    })
    expect(res.status).toBe(403)
  })

  it('anon with the header (no session) is 401, not 403 - CSRF passes, auth rejects', async () => {
    const res = await postLists({ Origin: ORIGIN, [CSRF_HEADER]: '1' })
    expect(res.status).toBe(401)
  })
})
