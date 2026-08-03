// Stores the path of the last-visited list (including pack mode) so the nav's
// Lists shortcut and RootRedirect can return the user to their workspace. Pack
// is URL state; this helper just makes the shortcut honor the full path rather
// than only the list id.
//
// OWNER-TAGGED. The stored value carries the id of the account that wrote it,
// and a read only returns the path when the CURRENT session owns it. That makes
// the pointer self-validating in one place, which is the whole point: a session
// can be (re)established in a BRAND-NEW document that no in-tab guard ever
// observes - magic-link redemption 302s to a fresh page, and a browser that was
// signed in as A but whose cookie has since lapsed lands the next person on
// /sign-in with A's pointer still in localStorage. Without the owner check,
// RootRedirect would send account B to A's list URL. Clearing at every account
// boundary cannot cover the boundaries that happen across a navigation; gating
// the READ covers all of them, and it never wipes a returning owner's own
// shortcut the way a blanket clear-on-sign-in would.
//
// Validation stays strict: only `/lists/<uuid>` with an optional exact `/pack`.
// The helper refuses to store anything else, and any stored value that doesn't
// match on read is a miss. If a future list-detail URL state needs to survive
// the shortcut, broaden LIST_PATH_RE explicitly; do not relax to "any string
// starting with /lists/".

const KEY = 'lastListPath'
// A pre-owner-tag key from the old same-domain app. Never READ any more (an
// untagged value has no owner, so following it is exactly the cross-account bug
// this module now prevents), but still cleared: a stale value left behind would
// only sit there wasting space, and clearLastListPath is also the
// account-deletion teardown for last-list state.
const LEGACY_KEY = 'lastListId'
const LIST_PATH_RE =
  /^\/lists\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/pack)?$/i

// The stored shape: `p` the validated path, `o` the owning account id. Kept
// terse because it lives in localStorage; parsed defensively on read (anything
// that isn't this exact shape, including a pre-owner-tag bare string, is a
// miss).
interface StoredLastList {
  p: string
  o: string
}

/**
 * Read the stored last-visited list path for `ownerId`. Returns null when
 * storage is empty, when the stored value fails validation, or when it belongs
 * to a different account (the cross-account guard) - and always null when
 * `ownerId` is absent, so an unauthenticated read can never surface a path.
 *
 * Pre-owner-tag values (the old bare string, or the legacy `lastListId` key)
 * carry no owner, so they can't be attributed and are treated as a miss. The
 * caller falls through to its slow path once and the next list visit rewrites a
 * tagged value, so this self-heals on the following navigation.
 */
export function readLastListPath(ownerId: string | null | undefined): string | null {
  if (!ownerId) return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    // A pre-owner-tag bare string ('/lists/...') is not valid JSON, so it throws
    // here and is caught below as a miss - exactly the self-healing behavior we
    // want for values written before this shipped.
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredLastList).p === 'string' &&
      typeof (parsed as StoredLastList).o === 'string'
    ) {
      const { p, o } = parsed as StoredLastList
      if (o === ownerId && LIST_PATH_RE.test(p)) return p
    }
    return null
  } catch {
    // localStorage can throw in private mode or on quota errors, and JSON.parse
    // throws on a legacy bare-string value. Either way: miss.
    return null
  }
}

/**
 * Store a list path owned by `ownerId`. Refuses to write anything that doesn't
 * pass LIST_PATH_RE (so callers can't smuggle arbitrary URLs through the
 * RootRedirect fast path) and refuses to write without an owner (an untagged
 * pointer could never be read back safely). Silently no-ops on invalid input
 * and on storage failure.
 */
export function writeLastListPath(path: string, ownerId: string | null | undefined): void {
  if (!ownerId) return
  if (!LIST_PATH_RE.test(path)) return
  try {
    // Scrub the pre-owner-tag legacy key on every write. It is permanently
    // unattributable, and an OLD or rolled-back bundle still reads it with NO
    // owner check (its reader rejects our JSON, then falls back to `lastListId`
    // and follows it) - so leaving it lets a mixed-version tab resurrect a stale
    // cross-account pointer. Removed before the write, so it goes even if the
    // setItem below throws on quota.
    localStorage.removeItem(LEGACY_KEY)
    const value: StoredLastList = { p: path, o: ownerId }
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Best-effort write; ignore quota/private-mode failures. The next root
    // visit just falls through to the fetchLists slow path.
  }
}

/**
 * Forget the stored last-visited list. Removes BOTH the current key and the
 * legacy `lastListId` key so a clear leaves nothing behind. This is also the
 * account-deletion teardown for last-list state - the hard reload on delete
 * clears in-memory caches but not localStorage. With the owner tag a surviving
 * value would be rejected on read by a different account anyway, but clearing at
 * the deliberate exits (sign-out, delete, teardown) keeps localStorage honest.
 */
export function clearLastListPath(): void {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // ignore
  }
}

/**
 * Extract the list UUID from a stored path, or null if the path doesn't match
 * LIST_PATH_RE. Used by the self-heal effect on ListDetailPage to compare the
 * cached path against the current route's listId without re-implementing the
 * path regex.
 */
export function getListIdFromListPath(path: string): string | null {
  if (!LIST_PATH_RE.test(path)) return null
  const idStart = '/lists/'.length
  const rest = path.slice(idStart)
  const slashIdx = rest.indexOf('/')
  return slashIdx === -1 ? rest : rest.slice(0, slashIdx)
}
