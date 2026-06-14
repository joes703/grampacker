// Stores the path of the last-visited list (including pack-mode query)
// so RootRedirect can land the user back where they were when the app
// reloads from the manifest start_url. Pack mode itself is URL state
// (?mode=pack); this helper just makes the redirect honor the full
// path rather than only the list id.
//
// Validation is intentionally strict: only `/lists/<uuid>` with an
// optional exact `?mode=pack`. The helper refuses to store anything
// else, so a malformed value can never make it past write-time and
// any tampered localStorage entry that doesn't match the regex is
// treated as a miss on read. If a future list-detail URL state needs
// to survive RootRedirect (e.g. `?filter=…`), broaden LIST_PATH_RE
// explicitly; do not relax to "any string starting with /lists/".

const KEY = 'lastListPath'
const LEGACY_KEY = 'lastListId'
const LIST_PATH_RE =
  /^\/lists\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\?mode=pack)?$/i
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Read the stored last-visited list path. Returns null on first visit,
 * after a clear, or if the stored value doesn't match LIST_PATH_RE.
 *
 * One-shot migration: if the new key is absent and the legacy
 * `lastListId` key still holds a bare UUID, promote it to
 * `/lists/<uuid>` (without pack mode), write the new key, and remove
 * the old. Subsequent reads return immediately from the new-key path.
 */
export function readLastListPath(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw && LIST_PATH_RE.test(raw)) return raw

    const legacyId = localStorage.getItem(LEGACY_KEY)
    if (legacyId && UUID_RE.test(legacyId)) {
      const path = `/lists/${legacyId}`
      try {
        localStorage.setItem(KEY, path)
        localStorage.removeItem(LEGACY_KEY)
      } catch {
        // best-effort migration; old key may linger on quota errors.
      }
      return path
    }
    return null
  } catch {
    // localStorage can throw in private mode or on quota errors. Miss.
    return null
  }
}

/**
 * Store a list path. Refuses to write anything that doesn't pass
 * LIST_PATH_RE so callers can't smuggle arbitrary URLs through the
 * RootRedirect path. Silently no-ops on invalid input and on
 * storage failure.
 */
export function writeLastListPath(path: string): void {
  if (!LIST_PATH_RE.test(path)) return
  try {
    localStorage.setItem(KEY, path)
  } catch {
    // Best-effort write; ignore quota/private-mode failures. The next
    // root visit just falls through to the fetchLists slow path.
  }
}

export function clearLastListPath(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

/**
 * Extract the list UUID from a stored path, or null if the path
 * doesn't match LIST_PATH_RE. Used by the self-heal effect on
 * ListDetailPage to compare the cached path against the current
 * route's listId without re-implementing the path regex.
 */
export function getListIdFromListPath(path: string): string | null {
  if (!LIST_PATH_RE.test(path)) return null
  const idStart = '/lists/'.length
  const queryIdx = path.indexOf('?')
  return queryIdx === -1 ? path.slice(idStart) : path.slice(idStart, queryIdx)
}
