import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

// Mobile primary-nav (Gear / Lists) is always-on by default. A page that
// renders a richer bottom bar of its own (List Detail, Gear, Lists) calls
// useSuppressMobilePrimaryNav() to hide the generic bar while the rich
// bar is mounted. The previous implementation suppressed by pathname
// match, which assumed the rich bar would always mount on those routes.
// Terminal states (list not found, future error/loading branches) broke
// that assumption and left mobile users with no nav. Keying suppression
// to actual mount state instead of route pattern makes the suppression
// a fact about runtime, not a guess about routes.
//
// Counter (not boolean) so concurrent registrations both decrement
// cleanly on unmount; defensive against future cases of two rich bars
// being mounted at once.

interface MobilePrimaryNavRegistry {
  count: number
  register: () => void
  unregister: () => void
}

const MobilePrimaryNavContext = createContext<MobilePrimaryNavRegistry | null>(null)

export function MobilePrimaryNavProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0)
  const register = useCallback(() => setCount((c) => c + 1), [])
  const unregister = useCallback(() => setCount((c) => Math.max(0, c - 1)), [])
  const value = useMemo(
    () => ({ count, register, unregister }),
    [count, register, unregister],
  )
  return (
    <MobilePrimaryNavContext.Provider value={value}>
      {children}
    </MobilePrimaryNavContext.Provider>
  )
}

export function useSuppressMobilePrimaryNav() {
  const ctx = useContext(MobilePrimaryNavContext)
  if (!ctx) {
    throw new Error(
      'useSuppressMobilePrimaryNav must be used inside <MobilePrimaryNavProvider>',
    )
  }
  const { register, unregister } = ctx
  useEffect(() => {
    register()
    return () => unregister()
  }, [register, unregister])
}

export function useIsMobilePrimaryNavSuppressed() {
  const ctx = useContext(MobilePrimaryNavContext)
  if (!ctx) {
    throw new Error(
      'useIsMobilePrimaryNavSuppressed must be used inside <MobilePrimaryNavProvider>',
    )
  }
  return ctx.count > 0
}
