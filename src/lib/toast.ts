// Tiny module-level pub/sub for toasts. Exposes showToast as a plain
// function so any module (queries, hooks, components) can trigger one
// without React context. The matching <ToastViewport> in
// src/components/Toast.tsx subscribes via useSyncExternalStore.
//
// Used selectively, not as a generic mutation-failure firehose. See
// src/App.tsx's MutationCache comment for the policy.

export type ToastType = 'info' | 'error' | 'success'

export type Toast = {
  id: number
  message: string
  type: ToastType
  // Wall-clock ms at which auto-dismiss fires. The viewport schedules a
  // setTimeout per toast keyed off this; storing the absolute time means
  // resubscribers (e.g. on hot reload) can compute the remaining delay
  // from `now` without extra plumbing.
  expiresAt: number
}

export type ToastOptions = {
  duration?: number
  type?: ToastType
}

const DEFAULT_DURATION_MS = 4000

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<(toasts: Toast[]) => void>()

function emit() {
  // Hand a fresh array to every listener so React's referential-equality
  // check in useSyncExternalStore re-renders on update.
  const snapshot = toasts.slice()
  for (const listener of listeners) listener(snapshot)
}

export function subscribe(listener: (toasts: Toast[]) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToasts(): Toast[] {
  return toasts
}

export function showToast(message: string, options: ToastOptions = {}): number {
  const id = nextId++
  const duration = options.duration ?? DEFAULT_DURATION_MS
  toasts = [
    ...toasts,
    { id, message, type: options.type ?? 'info', expiresAt: Date.now() + duration },
  ]
  emit()
  return id
}

export function dismissToast(id: number): void {
  const before = toasts.length
  toasts = toasts.filter((t) => t.id !== id)
  if (toasts.length !== before) emit()
}
