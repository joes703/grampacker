import type { ListItemWithGear } from './types'

// Generalized offline check queue. Originally held only pending is_packed
// values from Pack Mode; widened in 20260516010000 (Ready Checks) to also
// carry pending is_ready. Both fields share one storage object so each
// list_item ever has at most one entry — a row toggled to ready then
// packed offline syncs in one PATCH on reconnect.
//
// Storage layout (v2):
//   key:   `${userId}:${listId}:${itemId}`
//   value: { userId, listId, itemId, patch: { is_packed?, is_ready? }, updated_at }
//
// v1 (is_packed-only, key 'grampacker:pending-packed:v1') is migrated on
// first read of v2; the old key is then removed so we never read it again.

const STORAGE_KEY = 'grampacker:pending-checks:v2'
const STORAGE_KEY_V1 = 'grampacker:pending-packed:v1'

// Entries older than this are dropped at next read. Bounded growth on
// shared devices where a logged-out user's pending entries would
// otherwise accumulate forever. 30 days is generous enough that a user
// returning from a long trip without internet still has their queued
// checkmarks; users offline for over a month are well past the "this
// will sync soon" mental model the feature targets.
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type CheckField = 'is_packed' | 'is_ready'

export type PendingPatch = {
  is_packed?: boolean
  is_ready?: boolean
}

export type PendingCheckState = {
  userId: string
  listId: string
  itemId: string
  patch: PendingPatch
  updated_at: number
  // Count of consecutive sync attempts that have thrown for THIS entry,
  // since the last fresh user toggle. The sync loop bumps this on
  // failure and drops the entry from the queue once it crosses
  // MAX_FAILED_ATTEMPTS (defined alongside the loop). A fresh user
  // toggle resets to 0 — that's a new intent and the doom counter
  // shouldn't carry over from a stale prior attempt. Optional in the
  // stored shape so pre-existing localStorage entries read with a
  // default of 0.
  failedAttempts: number
}

type StoredPending = Record<string, PendingCheckState>

function storageKey(userId: string, listId: string, itemId: string): string {
  return `${userId}:${listId}:${itemId}`
}

function isPendingPatch(value: unknown): value is PendingPatch {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.is_packed !== undefined && typeof v.is_packed !== 'boolean') return false
  if (v.is_ready !== undefined && typeof v.is_ready !== 'boolean') return false
  // Reject entries whose patch carries no fields at all — those would be
  // a dead row that the sync loop has nothing to do with.
  return v.is_packed !== undefined || v.is_ready !== undefined
}

function isPendingCheckState(value: unknown): value is PendingCheckState {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (
    typeof row.userId !== 'string' ||
    typeof row.listId !== 'string' ||
    typeof row.itemId !== 'string' ||
    typeof row.updated_at !== 'number' ||
    !isPendingPatch(row.patch)
  ) return false
  // failedAttempts is optional in stored entries written before the
  // retry-cap mechanism shipped; non-numeric values are also tolerated
  // (a malformed write would otherwise drop the whole entry). Caller
  // normalizes via coerceFailedAttempts.
  return true
}

function coerceFailedAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function migrateV1IfPresent(): StoredPending | null {
  if (typeof localStorage === 'undefined') return null
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY_V1)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed v1 — drop it on the floor; v2 will start fresh.
    try { localStorage.removeItem(STORAGE_KEY_V1) } catch { /* ignore */ }
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    try { localStorage.removeItem(STORAGE_KEY_V1) } catch { /* ignore */ }
    return null
  }
  const out: StoredPending = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    if (
      typeof row.userId === 'string' &&
      typeof row.listId === 'string' &&
      typeof row.itemId === 'string' &&
      typeof row.is_packed === 'boolean' &&
      typeof row.updated_at === 'number'
    ) {
      out[key] = {
        userId: row.userId,
        listId: row.listId,
        itemId: row.itemId,
        patch: { is_packed: row.is_packed },
        updated_at: row.updated_at,
        failedAttempts: 0,
      }
    }
  }
  try { localStorage.removeItem(STORAGE_KEY_V1) } catch { /* ignore */ }
  return out
}

function readStored(): StoredPending {
  if (typeof localStorage === 'undefined') return {}
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return {}
  }
  // No v2 yet — try to migrate v1.
  if (!raw) {
    const migrated = migrateV1IfPresent()
    if (!migrated || Object.keys(migrated).length === 0) return {}
    writeStored(migrated)
    return migrated
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const cutoff = Date.now() - PENDING_TTL_MS
    const out: StoredPending = {}
    let pruned = false
    for (const [key, value] of Object.entries(parsed)) {
      if (!isPendingCheckState(value)) {
        pruned = true
        continue
      }
      if (value.updated_at < cutoff) {
        pruned = true
        continue
      }
      // Normalize so the rest of the codebase never sees a missing or
      // bad failedAttempts. Pre-existing v2 entries written before the
      // retry-cap shipped land here.
      out[key] = { ...value, failedAttempts: coerceFailedAttempts((value as Record<string, unknown>).failedAttempts) }
    }
    if (pruned) writeStored(out)
    return out
  } catch {
    return {}
  }
}

function writeStored(entries: StoredPending): void {
  if (typeof localStorage === 'undefined') return
  try {
    const keys = Object.keys(entries)
    if (keys.length === 0) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // If storage is unavailable or full, keep the in-memory optimistic UI
    // path working. The pending write simply won't survive a reload.
  }
}

export function readPendingCheckStates(userId: string, listId: string): PendingCheckState[] {
  const entries = readStored()
  return Object.values(entries)
    .filter((entry) => entry.userId === userId && entry.listId === listId)
    .sort((a, b) => a.updated_at - b.updated_at)
}

export function queuePendingCheck(
  userId: string,
  listId: string,
  itemId: string,
  patch: PendingPatch,
): PendingCheckState {
  const entries = readStored()
  const key = storageKey(userId, listId, itemId)
  const existing = entries[key]
  // Merge with any existing entry so a Ready toggle followed by a Packed
  // toggle (offline) ends up as one entry with both fields. The newer
  // updated_at wins so cross-tab sort order stays monotonic.
  // A fresh user toggle is a NEW intent — reset failedAttempts to 0 so
  // a previously-doomed entry gets the full retry budget on the new try.
  const merged: PendingCheckState = {
    userId,
    listId,
    itemId,
    patch: { ...existing?.patch, ...patch },
    updated_at: Date.now(),
    failedAttempts: 0,
  }
  entries[key] = merged
  writeStored(entries)
  return merged
}

// Convenience wrappers — these are the names the hook + ListDetailPage use.
export function queuePendingPackedState(
  userId: string,
  listId: string,
  itemId: string,
  isPacked: boolean,
): PendingCheckState {
  return queuePendingCheck(userId, listId, itemId, { is_packed: isPacked })
}

export function queuePendingReadyState(
  userId: string,
  listId: string,
  itemId: string,
  isReady: boolean,
): PendingCheckState {
  return queuePendingCheck(userId, listId, itemId, { is_ready: isReady })
}

export function removePendingChecks(userId: string, listId: string, itemIds: string[]): void {
  if (itemIds.length === 0) return
  const entries = readStored()
  for (const itemId of itemIds) {
    delete entries[storageKey(userId, listId, itemId)]
  }
  writeStored(entries)
}

// Bump the failed-attempt counter for a single pending entry and return
// the new count. Returning the count (rather than re-reading from
// storage in the caller) avoids a read+write race when multiple sync
// runs interleave. updated_at is intentionally NOT bumped — the entry
// stays at its original position so the queue doesn't drift into
// round-robin behavior when one entry keeps failing.
export function incrementFailedAttempts(
  userId: string,
  listId: string,
  itemId: string,
): number {
  const entries = readStored()
  const key = storageKey(userId, listId, itemId)
  const existing = entries[key]
  if (!existing) return 0
  const next = existing.failedAttempts + 1
  entries[key] = { ...existing, failedAttempts: next }
  writeStored(entries)
  return next
}

// Drop a single field from every pending entry for this user/list. Used by
// Reset Packed / Reset Ready so a reset of one field doesn't clobber the
// other. If an entry has only the field we're dropping, the whole entry is
// removed. Otherwise the field is deleted from its patch and the entry's
// updated_at is bumped to keep cross-tab sort order honest.
export function dropFieldFromPendingChecks(
  userId: string,
  listId: string,
  field: CheckField,
): void {
  const entries = readStored()
  let changed = false
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.userId !== userId || entry.listId !== listId) continue
    if (entry.patch[field] === undefined) continue
    const nextPatch: PendingPatch = { ...entry.patch }
    delete nextPatch[field]
    if (nextPatch.is_packed === undefined && nextPatch.is_ready === undefined) {
      delete entries[key]
    } else {
      entries[key] = { ...entry, patch: nextPatch, updated_at: Date.now() }
    }
    changed = true
  }
  if (changed) writeStored(entries)
}

// Project pending fields onto a server-fetched item list. Each item gets
// the pending field applied if it differs from the server value; otherwise
// the input reference is preserved so React.memo barriers don't bust.
function applyPendingField<T extends ListItemWithGear>(
  items: T[],
  pending: PendingCheckState[],
  field: CheckField,
): T[] {
  if (pending.length === 0) return items
  const byId = new Map<string, boolean>()
  for (const entry of pending) {
    const value = entry.patch[field]
    if (value !== undefined) byId.set(entry.itemId, value)
  }
  if (byId.size === 0) return items
  let changed = false
  const next = items.map((item) => {
    const pendingValue = byId.get(item.id)
    if (pendingValue === undefined || item[field] === pendingValue) return item
    changed = true
    return { ...item, [field]: pendingValue }
  })
  return changed ? next : items
}

export function applyPendingPackedStates<T extends ListItemWithGear>(
  items: T[],
  pending: PendingCheckState[],
): T[] {
  return applyPendingField(items, pending, 'is_packed')
}

export function applyPendingReadyStates<T extends ListItemWithGear>(
  items: T[],
  pending: PendingCheckState[],
): T[] {
  return applyPendingField(items, pending, 'is_ready')
}

// Cross-tab consistency. The `storage` event fires in OTHER tabs (not the
// originating tab), so a tab that queues a tick offline will trigger a
// callback in every other tab on the same origin. The callback receives
// the post-change pending list filtered for the caller's userId/listId,
// so subscribers don't have to re-read storage themselves.
//
// e.key === null indicates `localStorage.clear()` was called from another
// tab; we treat that the same as a relevant key change so we don't show
// stale pending state. Cross-tab sync attempts are deduplicated by
// idempotent server writes, so concurrent flushes are safe if rare.
export function subscribeToPendingCheckStates(
  userId: string,
  listId: string,
  callback: (states: PendingCheckState[]) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  function onStorage(e: StorageEvent) {
    if (e.key !== STORAGE_KEY && e.key !== null) return
    callback(readPendingCheckStates(userId, listId))
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
