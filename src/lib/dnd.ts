// dnd-kit's setActivatorNodeRef takes a generic HTMLElement; our drag-handle
// callsites pass <button> refs. Wrap as a thin adapter that forwards the
// argument — HTMLButtonElement extends HTMLElement so the call is safe and
// no cast is needed.
export function asButtonRef(
  setRef: (node: HTMLElement | null) => void,
): (node: HTMLButtonElement | null) => void {
  return (node) => setRef(node)
}

// ── Category drop-zone droppable ids ─────────────────────────────────────────
//
// Both the list view and the gear library page register a category section's
// items wrapper as a useDroppable target. The id namespace must not collide
// with item ids (which are UUIDs), so we prefix. The `null` category id maps
// to a sentinel string for the Uncategorised section.
//
// Each view passes its own prefix so categories on the two pages don't clash
// in the DndContext registry (a list-view category drop zone and a gear-page
// category drop zone never co-exist in the same DndContext, but distinct
// prefixes also help debug logs / aria labels stay readable).

export const UNCATEGORISED_KEY = '__uncategorised__'

export function makeCategoryDroppableId(prefix: string, categoryId: string | null): string {
  return `${prefix}${categoryId ?? UNCATEGORISED_KEY}`
}

export function makeCategoryDroppableParser(prefix: string) {
  return (id: string): string | null | undefined => {
    if (!id.startsWith(prefix)) return undefined
    const v = id.slice(prefix.length)
    return v === UNCATEGORISED_KEY ? null : v
  }
}
