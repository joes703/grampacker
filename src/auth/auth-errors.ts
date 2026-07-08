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
