import { describe, expect, it } from 'vitest'
import { env } from './test/node-env'
import { createAuth, sessionAuth } from './auth'

// The cache contract behind requireSession's auth instance (server/auth.ts).
// The split is load-bearing: sessionAuth is holderless and MAY be cached;
// createAuth carries a per-request incident holder and must NEVER be, or
// concurrent /api/auth/* requests would overwrite each other's incident.
// Identity is compared with Object.is so a failure does not try to diff two
// whole better-auth instances.
describe('auth instance caching', () => {
  it('sessionAuth returns the same instance for the same env object', () => {
    expect(Object.is(sessionAuth(env), sessionAuth(env))).toBe(true)
  })

  it('sessionAuth keys on env object identity: a distinct env gets a distinct instance', () => {
    // Same contents, different object - the tests that swap DB per request
    // (auth-error-logging.test.ts) rely on a copied env never sharing the
    // cached instance built over the original connection.
    const copy = { ...env }
    expect(Object.is(sessionAuth(copy), sessionAuth(env))).toBe(false)
    expect(Object.is(sessionAuth(copy), sessionAuth(copy))).toBe(true)
  })

  it('createAuth constructs per call: a request-bound instance is never cached', () => {
    expect(Object.is(createAuth(env, {}), createAuth(env, {}))).toBe(false)
  })
})
