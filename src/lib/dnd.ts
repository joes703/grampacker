// dnd-kit's setActivatorNodeRef takes a generic HTMLElement; our drag-handle
// callsites pass <button> refs. Wrap as a thin adapter that forwards the
// argument — HTMLButtonElement extends HTMLElement so the call is safe and
// no cast is needed.
export function asButtonRef(
  setRef: (node: HTMLElement | null) => void,
): (node: HTMLButtonElement | null) => void {
  return (node) => setRef(node)
}
