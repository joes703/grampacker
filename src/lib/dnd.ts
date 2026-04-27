// dnd-kit's setActivatorNodeRef has a generic Element ref shape that doesn't
// narrow to HTMLButtonElement automatically. Wrap the cast here so the
// awkward `as unknown as ...` doesn't have to live at every drag-handle
// callsite.
export function asButtonRef(
  setRef: (node: HTMLElement | null) => void,
): (node: HTMLButtonElement | null) => void {
  return setRef as unknown as (node: HTMLButtonElement | null) => void
}
