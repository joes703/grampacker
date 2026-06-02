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

// Supabase/auth-js surfaces passkey failures on `error.code` (distinct from
// the WebAuthn DOMException `name`). See the Passkeys guide "Error codes".
function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

const CODE_MESSAGES: Record<string, string> = {
  too_many_passkeys: "You've reached the maximum number of passkeys for your account.",
  webauthn_credential_exists: 'This device already has a passkey for your account.',
  webauthn_credential_not_found: "That passkey isn't registered to an account here.",
  webauthn_challenge_expired: 'The passkey request timed out. Please try again.',
  webauthn_challenge_not_found: 'Something went wrong with the passkey. Please try again.',
  webauthn_verification_failed: "We couldn't verify that passkey. Please try again.",
  passkey_disabled: "Passkey sign-in isn't available right now.",
  email_not_confirmed: 'Confirm your email address before using a passkey.',
  phone_not_confirmed: 'Confirm your phone number before using a passkey.',
  user_banned: "This account can't be used to sign in.",
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
    // Both are required: get() drives sign-in, create() drives registration.
    // auth-js's own browserSupportsWebAuthn() gate checks both, so checking
    // only get() could show "Add a passkey" where registration then fails.
    typeof navigator.credentials.get === 'function' &&
    typeof navigator.credentials.create === 'function'
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
  // Supabase server error codes take precedence over the WebAuthn name.
  const code = errorCode(err)
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
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
