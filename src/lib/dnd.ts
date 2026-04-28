// dnd-kit's setActivatorNodeRef has a generic Element ref shape that doesn't
// narrow to HTMLButtonElement automatically. Wrap the cast here so the
// awkward `as unknown as ...` doesn't have to live at every drag-handle
// callsite.
export function asButtonRef(
  setRef: (node: HTMLElement | null) => void,
): (node: HTMLButtonElement | null) => void {
  return setRef as unknown as (node: HTMLButtonElement | null) => void
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
