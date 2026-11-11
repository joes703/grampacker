// Shape of better-auth client errors ({ data, error } results).
export type AuthClientError = {
  status: number
  code?: string
  message?: string
}

// Maps a better-auth client error to user-facing copy. Rate limiting is
// mapped globally (any auth endpoint can 429); everything else prefers the
// server's message and falls back to the caller's context-specific copy.
export function authErrorMessage(
  error: AuthClientError | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback
  if (error.status === 429) {
    return 'Too many attempts. Please wait a bit and try again.'
  }
  return error.message || fallback
}

// Adding or removing a passkey needs a FRESH session - one created by a recent
// sign-in ceremony (the deny-by-default hooks.before gate in server/auth.ts).
// Renaming does not; it is a display label.
//
// The refusal is 403 SESSION_NOT_FRESH: the auth.ts gate and better-auth's own
// freshSessionMiddleware (which the passkey plugin mounts on the two REGISTER
// endpoints) both answer with it. Missing it would strand "Add a passkey" on a
// raw error message with no way forward. The status alone is not enough to key
// on: better-auth answers 403 for other reasons (a failed origin check), and
// those must not masquerade as "just re-authenticate".
//
// better-auth's client error type does not declare `code` even though it passes
// the field through, so it is narrowed here rather than trusted.
export function isReauthRequired(error: { status: number }): boolean {
  const code = (error as { code?: unknown }).code
  return (
    error.status === 403 &&
    code === 'SESSION_NOT_FRESH'
  )
}
