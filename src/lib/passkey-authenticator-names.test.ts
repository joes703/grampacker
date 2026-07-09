import { describe, expect, it } from 'vitest'
import { authenticatorName } from './passkey-authenticator-names'

describe('authenticatorName', () => {
  it('resolves a known AAGUID', () => {
    expect(authenticatorName('bada5566-a7aa-401f-bd96-45619a55120d')).toBe(
      '1Password',
    )
  })

  it('normalizes casing and surrounding whitespace before lookup', () => {
    expect(authenticatorName('  BADA5566-A7AA-401F-BD96-45619A55120D  ')).toBe(
      '1Password',
    )
  })

  it('returns undefined for the all-zero AAGUID privacy-preserving platforms report', () => {
    expect(
      authenticatorName('00000000-0000-0000-0000-000000000000'),
    ).toBeUndefined()
  })

  it('returns undefined for unknown, empty, and missing values', () => {
    expect(authenticatorName('11111111-2222-3333-4444-555555555555')).toBeUndefined()
    expect(authenticatorName('')).toBeUndefined()
    expect(authenticatorName(null)).toBeUndefined()
    expect(authenticatorName(undefined)).toBeUndefined()
  })
})
