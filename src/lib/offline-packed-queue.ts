import type { ListItemWithGear } from './types'

const STORAGE_KEY = 'grampacker:pending-packed:v1'

export type PendingPackedState = {
  userId: string
  listId: string
  itemId: string
  is_packed: boolean
  updated_at: number
}

type StoredPending = Record<string, PendingPackedState>

function storageKey(userId: string, listId: string, itemId: string): string {
  return `${userId}:${listId}:${itemId}`
}

function isPendingPackedState(value: unknown): value is PendingPackedState {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.userId === 'string' &&
    typeof row.listId === 'string' &&
    typeof row.itemId === 'string' &&
    typeof row.is_packed === 'boolean' &&
    typeof row.updated_at === 'number'
  )
}

function readStored(): StoredPending {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: StoredPending = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isPendingPackedState(value)) out[key] = value
    }
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

export function readPendingPackedStates(userId: string, listId: string): PendingPackedState[] {
  const entries = readStored()
  return Object.values(entries)
    .filter((entry) => entry.userId === userId && entry.listId === listId)
    .sort((a, b) => a.updated_at - b.updated_at)
}

export function queuePendingPackedState(
  userId: string,
  listId: string,
  itemId: string,
  isPacked: boolean,
): PendingPackedState {
  const entries = readStored()
  const entry: PendingPackedState = {
    userId,
    listId,
    itemId,
    is_packed: isPacked,
    updated_at: Date.now(),
  }
  entries[storageKey(userId, listId, itemId)] = entry
  writeStored(entries)
  return entry
}

export function removePendingPackedStates(userId: string, listId: string, itemIds: string[]): void {
  if (itemIds.length === 0) return
  const entries = readStored()
  for (const itemId of itemIds) {
    delete entries[storageKey(userId, listId, itemId)]
  }
  writeStored(entries)
}

export function applyPendingPackedStates<T extends ListItemWithGear>(
  items: T[],
  pending: PendingPackedState[],
): T[] {
  if (pending.length === 0) return items
  const byId = new Map(pending.map((entry) => [entry.itemId, entry.is_packed]))
  let changed = false
  const next = items.map((item) => {
    const pendingValue = byId.get(item.id)
    if (pendingValue === undefined || item.is_packed === pendingValue) return item
    changed = true
    return { ...item, is_packed: pendingValue }
  })
  return changed ? next : items
}
