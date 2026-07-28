// Tiny module-level pub/sub for toasts. Exposes showToast as a plain
// function so any module (queries, hooks, components) can trigger one
// without React context. The matching <ToastViewport> in
// src/components/Toast.tsx subscribes via useSyncExternalStore.
//
// Used selectively, not as a generic mutation-failure firehose. See
// src/App.tsx's MutationCache comment for the policy.

export type ToastType = 'info' | 'error' | 'success'

// An optional single action on a toast (currently: Undo a removal).
//
// `onAction` is deliberately SYNCHRONOUS - `() => void`, not
// `() => Promise<void>`. The viewport calls it from a click handler and does
// not await it, so an async callback here would be exactly the
// fire-and-forget rejected promise AGENTS.md prohibits. An action that does
// async work owns its own try/catch and its own failure feedback; see
// useListItemRemoval, which routes Undo through a mutation and error-toasts
// on failure rather than letting a rejection escape.
export type ToastAction = {
  label: string
  onAction: () => void
}

export type Toast = {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
  // Wall-clock ms at which auto-dismiss fires. The viewport schedules a
  // setTimeout per toast keyed off this; storing the absolute time means
  // resubscribers (e.g. on hot reload) can compute the remaining delay
  // from `now` without extra plumbing.
  expiresAt: number
}

export type ToastOptions = {
  duration?: number
  type?: ToastType
  action?: ToastAction
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
    {
      id,
      message,
      type: options.type ?? 'info',
      action: options.action,
      expiresAt: Date.now() + duration,
    },
  ]
  emit()
  return id
}

export function dismissToast(id: number): void {
  const before = toasts.length
  toasts = toasts.filter((t) => t.id !== id)
  if (toasts.length !== before) emit()
}

// Drop every live toast. Called on sign-out: this store is module-level and
// its viewport is mounted above the authenticated routes, so without an
// explicit clear a toast - and, worse, its ACTION - outlives the session that
// created it. An Undo button surviving into a signed-out or freshly
// signed-in session would fire a write against the previous user's list.
export function clearToasts(): void {
  if (toasts.length === 0) return
  toasts = []
  emit()
}
