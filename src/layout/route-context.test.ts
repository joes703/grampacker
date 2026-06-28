import { describe, expect, it } from 'vitest'
import { resolveRoute } from './route-context'

describe('resolveRoute', () => {
  it('treats list workspace subroutes as list detail routes', () => {
    expect(resolveRoute('/lists/list-1')).toEqual({ kind: 'list-detail', listId: 'list-1' })
    expect(resolveRoute('/lists/list-1/pack')).toEqual({ kind: 'list-detail', listId: 'list-1' })
    expect(resolveRoute('/lists/list-1/food')).toEqual({ kind: 'list-detail', listId: 'list-1' })
  })

  it('does not treat unknown list subroutes as list detail routes', () => {
    expect(resolveRoute('/lists/list-1/unknown')).toEqual({ kind: 'other' })
  })

  it('maps each top-level path to its own route kind', () => {
    // Exact-match branches. A typo in any of these path strings, or a new
    // top-level route added to NavBar but missed here, would otherwise fall
    // through to `other` unnoticed.
    expect(resolveRoute('/lists')).toEqual({ kind: 'all-lists' })
    expect(resolveRoute('/gear')).toEqual({ kind: 'gear' })
    expect(resolveRoute('/food')).toEqual({ kind: 'food' })
    expect(resolveRoute('/settings')).toEqual({ kind: 'settings' })
    expect(resolveRoute('/help')).toEqual({ kind: 'help' })
  })

  it('falls back to other for the root and unknown paths', () => {
    expect(resolveRoute('/')).toEqual({ kind: 'other' })
    expect(resolveRoute('/nope')).toEqual({ kind: 'other' })
  })
})
