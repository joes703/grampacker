import { useCallback, useState } from 'react'

// Set<T> with toggle/clear helpers. Used wherever the UI tracks "which of these
// items are selected/expanded/collapsed" — toggling an id flips its membership.
// The returned helpers are stable so they're safe to put in effect deps.
export function useToggleSet<T>(initial?: Iterable<T>) {
  const [set, setSet] = useState<Set<T>>(() => new Set(initial))

  const toggle = useCallback((id: T) => {
    setSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clear = useCallback(() => setSet(new Set()), [])

  const reset = useCallback((next: Iterable<T>) => setSet(new Set(next)), [])

  return { set, toggle, clear, reset }
}
