import { describe, expect, it } from 'vitest'
import { env } from './test/node-env'
import { sessionAuth } from './auth'

// The cache contract behind requireSession's auth instance (server/auth.ts).
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
})
