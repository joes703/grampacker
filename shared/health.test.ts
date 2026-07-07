import { describe, expect, it } from 'vitest'
import { healthResponseSchema } from './health'

describe('health DTO', () => {
  it('accepts a well-formed response', () => {
    expect(healthResponseSchema.parse({ ok: true })).toEqual({ ok: true })
  })

  it('rejects a malformed response', () => {
    expect(healthResponseSchema.safeParse({ ok: 'yes' }).success).toBe(false)
  })
})
