const KEY = 'lastListId'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Read the last-visited list_id from localStorage. Returns null on first
 * visit, after a clear, or if the stored value isn't a plausible UUID.
 *
 * Validation is intentionally loose — any 36-char string of hex+dashes
 * passes. The destination page's existing not-found branch handles
 * server-side misses (deleted list, different user). We don't try to
 * verify the id belongs to the current user here — that's the server's
 * job via RLS.
 */
export function readLastListId(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw || !UUID_RE.test(raw)) return null
    return raw
  } catch {
    // localStorage can throw in private mode or on quota errors. Treat as miss.
    return null
  }
}

export function writeLastListId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Best-effort write; ignore quota/private-mode failures. The next
    // visit just falls through to the fetchLists path.
  }
}

export function clearLastListId(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
