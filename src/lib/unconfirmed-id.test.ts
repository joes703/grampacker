import { describe, expect, it } from 'vitest'
import { isUnconfirmed, unconfirmedId } from './unconfirmed-id'

describe('unconfirmed ids', () => {
  it('recognizes the ids it mints, and they are unique', () => {
    const a = unconfirmedId()
    expect(isUnconfirmed(a)).toBe(true)
    expect(unconfirmedId()).not.toBe(a)
  })

  it('does not mistake a server id for an unconfirmed one', () => {
    expect(isUnconfirmed('2f1c7a52-6c1e-4d55-9a53-0e0f3c0b9f11')).toBe(false)
  })
})
