import { describe, expect, it } from 'vitest'
import { listItemFailure } from './lists'

describe('listItemFailure', () => {
  it('keeps the existing mappings stable', () => {
    expect(listItemFailure({ ok: false, reason: 'not_found' }).status).toBe(404)
    expect(listItemFailure({ ok: false, reason: 'invalid_gear' }).status).toBe(400)
    expect(listItemFailure({ ok: false, reason: 'cap_exceeded' }).status).toBe(422)
  })
})
