import { useCallback, useState } from 'react'

function storageKey(listId: string): string {
  return `packingCollapsed:${listId}`
}

export function readPackingCollapsed(listId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(listId))
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
      return new Set()
    }
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

export function writePackingCollapsed(listId: string, collapsed: Set<string>): void {
  try {
    localStorage.setItem(storageKey(listId), JSON.stringify([...collapsed]))
  } catch {
    // Persistence is polish. A blocked/full localStorage must not break packing.
  }
}

export function usePackingCollapsed(listId: string): {
  collapsed: Set<string>
  toggle: (locationId: string) => void
} {
  const [collapsed, setCollapsed] = useState(() => readPackingCollapsed(listId))
  const toggle = useCallback((locationId: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(locationId)) next.delete(locationId)
      else next.add(locationId)
      writePackingCollapsed(listId, next)
      return next
    })
  }, [listId])
  return { collapsed, toggle }
}
