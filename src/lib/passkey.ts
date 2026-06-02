// Client-side helpers for the Supabase passkey (WebAuthn) flows.
//
// The ceremonies themselves live in supabase.auth.signInWithPasskey() /
// registerPasskey() / auth.passkey.* (enabled via the experimental flag in
// supabase.ts). This module adds only the two things those calls don't:
//   1. Feature detection, so we hide passkey UI on browsers/devices that
//      can't do WebAuthn instead of showing a button that always fails.
//   2. Friendly error mapping, treating user-cancellation as a no-op rather
//      than surfacing a scary message.
//
// auth-js's WebAuthnError copies the underlying DOMException's `name`
// (e.g. 'NotAllowedError') onto itself, so checking `.name` works both for
// the error returned inside a { data, error } result AND for a raw
// DOMException that escapes as a throw.

function errorName(err: unknown): string | undefined {
  return err instanceof Error ? err.name : undefined
}

// True when WebAuthn / passkeys are usable in this browser. Gate the passkey
// UI on this so unsupported environments only ever see email + password. We
// check PublicKeyCredential (WebAuthn) plus the credentials container; we
// deliberately do NOT require a platform authenticator, because roaming
// authenticators (security keys, phones via cross-device) are valid passkey
// providers too and we don't want to hide the option from them.
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    navigator.credentials != null &&
    typeof navigator.credentials.get === 'function'
  )
}

// User dismissed the OS/browser prompt, or it timed out. Not a real failure:
// callers should return to idle without showing an error.
export function isPasskeyCancellation(err: unknown): boolean {
  const name = errorName(err)
  return name === 'NotAllowedError' || name === 'AbortError'
}

// Maps a passkey error to user-facing copy, or returns null when it was a
// cancellation (caller shows nothing). Accepts either a thrown error or the
// `error` from a { data, error } result.
export function passkeyErrorMessage(err: unknown): string | null {
  if (isPasskeyCancellation(err)) return null
  switch (errorName(err)) {
    case 'InvalidStateError':
      // create(): this authenticator already holds a credential for the account.
      return 'This device already has a passkey for your account.'
    case 'SecurityError':
      // rpId / origin mismatch — a configuration problem, not user error.
      return 'Passkeys are not available on this site.'
    case 'NotSupportedError':
      return 'This device does not support passkeys.'
    default:
      return err instanceof Error && err.message
        ? err.message
        : 'Something went wrong with the passkey. Please try again.'
  }
}
