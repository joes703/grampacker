// Where ToastViewport renders: inside the topmost open Modal, or (null) in the
// app root as an ordinary fixed element.
//
// Why. Modal opens a native <dialog> with showModal(), which puts it in the
// browser's TOP LAYER, above all ordinary stacking, and makes everything
// outside it inert. A toast region in the app root is therefore painted behind
// the backdrop, cannot be dismissed, and is out of the accessibility tree for as
// long as a modal is open. Rendering the region INSIDE the open dialog puts it
// in the dialog's top-layer stacking context and outside the inert part of the
// page. (A popover="manual" region would also reach the top layer, but a node
// outside the modal dialog stays inert, so its Dismiss would not work and it
// would not be announced.)
//
// Each open Modal registers an always-rendered, empty slot element here. The
// stack is kept in showModal() order, which is the top layer's order, so the
// last entry is the dialog on top. Modal.tsx owns keeping it in step with the
// native dialog; this module is only the store. Same pub/sub shape as
// src/lib/toast.ts, read by ToastViewport through useSyncExternalStore.

let hosts: readonly Element[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeToastHost(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToastHost(): Element | null {
  return hosts.at(-1) ?? null
}

// Pushes `host` to the top, moving it there if it is already registered - a
// reopened dialog goes back to the top of the top layer.
export function addToastHost(host: Element): void {
  if (hosts.at(-1) === host) return
  hosts = [...hosts.filter((h) => h !== host), host]
  emit()
}

export function removeToastHost(host: Element): void {
  if (!hosts.includes(host)) return
  hosts = hosts.filter((h) => h !== host)
  emit()
}
