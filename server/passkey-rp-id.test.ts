import { describe, expect, it } from 'vitest'
import { passkeyRpId } from './auth'

describe('passkeyRpId', () => {
  it('maps the apex and real subdomains to the registrable domain', () => {
    expect(passkeyRpId('https://grampacker.app')).toBe('grampacker.app')
    expect(passkeyRpId('https://next.grampacker.app')).toBe('grampacker.app')
  })

  it('does not treat lookalike domains as grampacker.app', () => {
    // A bare endsWith('grampacker.app') would match this host and issue
    // credentials scoped to a domain we do not serve.
    expect(passkeyRpId('https://evilgrampacker.app')).toBe(
      'evilgrampacker.app',
    )
  })

  it('uses the hostname verbatim in dev (port stripped)', () => {
    expect(passkeyRpId('http://localhost:5173')).toBe('localhost')
  })
})
