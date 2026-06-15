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
})
