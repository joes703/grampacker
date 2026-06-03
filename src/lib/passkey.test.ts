// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { isPasskeySupported, isPasskeyCancellation, passkeyErrorMessage } from './passkey'

// Build an Error carrying a specific DOMException-style name, mirroring what
// auth-js's WebAuthnError exposes (it copies the cause's `name`).
const named = (name: string, message = 'x') => Object.assign(new Error(message), { name })

describe('isPasskeyCancellation', () => {
  it('treats NotAllowedError (user dismissed/timed out) as cancellation', () => {
    expect(isPasskeyCancellation(named('NotAllowedError'))).toBe(true)
  })
  it('treats AbortError as cancellation', () => {
    expect(isPasskeyCancellation(named('AbortError'))).toBe(true)
  })
  it('does not treat real failures as cancellation', () => {
    expect(isPasskeyCancellation(named('SecurityError'))).toBe(false)
    expect(isPasskeyCancellation(named('InvalidStateError'))).toBe(false)
    expect(isPasskeyCancellation(null)).toBe(false)
  })
})

describe('passkeyErrorMessage', () => {
  it('returns null for cancellation so the caller shows nothing', () => {
    expect(passkeyErrorMessage(named('NotAllowedError'))).toBeNull()
    expect(passkeyErrorMessage(named('AbortError'))).toBeNull()
  })
  it('maps InvalidStateError to an already-registered message', () => {
    expect(passkeyErrorMessage(named('InvalidStateError'))).toMatch(/already has a passkey/i)
  })
  it('maps SecurityError to a domain/config message', () => {
    expect(passkeyErrorMessage(named('SecurityError'))).toMatch(/not available on this site/i)
  })
  it('maps NotSupportedError to an unsupported-device message', () => {
    expect(passkeyErrorMessage(named('NotSupportedError'))).toMatch(/does not support passkeys/i)
  })
  it('falls back to the error message for unmapped errors', () => {
    expect(passkeyErrorMessage(named('SomethingElse', 'server said no'))).toBe('server said no')
  })
  it('falls back to a generic message for non-Error values', () => {
    expect(passkeyErrorMessage('weird')).toMatch(/something went wrong/i)
  })

  // Supabase surfaces these on error.code (distinct from the WebAuthn name).
  it('maps Supabase passkey error codes to friendly copy', () => {
    const coded = (code: string) => Object.assign(new Error('raw'), { code })
    expect(passkeyErrorMessage(coded('too_many_passkeys'))).toMatch(/maximum number of passkeys/i)
    expect(passkeyErrorMessage(coded('webauthn_credential_exists'))).toMatch(/already has a passkey/i)
    expect(passkeyErrorMessage(coded('webauthn_challenge_expired'))).toMatch(/timed out/i)
    expect(passkeyErrorMessage(coded('email_not_confirmed'))).toMatch(/confirm your email/i)
  })
  it('prefers the code mapping over the raw message', () => {
    expect(passkeyErrorMessage(Object.assign(new Error('raw'), { code: 'passkey_disabled' }))).not.toBe('raw')
  })
})

describe('isPasskeySupported', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'PublicKeyCredential')
  afterEach(() => {
    if (original) Object.defineProperty(window, 'PublicKeyCredential', original)
    else delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
  })

  it('is false when PublicKeyCredential is absent', () => {
    delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
    expect(isPasskeySupported()).toBe(false)
  })

  it('is true only when PublicKeyCredential and both credential methods exist', () => {
    // Registration uses navigator.credentials.create(), sign-in uses get();
    // both must be present (matches auth-js's own support gate).
    Object.defineProperty(navigator, 'credentials', {
      value: { get: () => Promise.resolve(null), create: () => Promise.resolve(null) },
      configurable: true,
    })
    ;(window as { PublicKeyCredential?: unknown }).PublicKeyCredential = function () {}
    expect(isPasskeySupported()).toBe(true)
  })

  it('is false when create() is missing even if get() exists', () => {
    Object.defineProperty(navigator, 'credentials', {
      value: { get: () => Promise.resolve(null) },
      configurable: true,
    })
    ;(window as { PublicKeyCredential?: unknown }).PublicKeyCredential = function () {}
    expect(isPasskeySupported()).toBe(false)
  })
})
