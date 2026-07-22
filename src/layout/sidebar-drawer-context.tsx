import { createContext, useContext, useMemo, useState, useEffect } from 'react'

// Coordinates the mobile bottom bar's Add action with the drawer instance
// owned by whichever page provides sidebar content. The trigger and drawer
// live in different React subtrees, so a context bridges them.
//
// Pages that have a sidebar drawer call useRegisterSidebarDrawer() on
// mount; the Add action is enabled whenever a page is registered. Pages that
// do not provide the drawer simply omit the call.

type SidebarDrawerContextValue = {
  open: boolean
  setOpen: (v: boolean) => void
  available: boolean
  setAvailable: (v: boolean) => void
}

const SidebarDrawerContext = createContext<SidebarDrawerContextValue | null>(null)

export function SidebarDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [available, setAvailable] = useState(false)
  const value = useMemo(() => ({ open, setOpen, available, setAvailable }), [open, available])
  return <SidebarDrawerContext.Provider value={value}>{children}</SidebarDrawerContext.Provider>
}

export function useSidebarDrawer() {
  const ctx = useContext(SidebarDrawerContext)
  if (!ctx) throw new Error('useSidebarDrawer must be used within SidebarDrawerProvider')
  return ctx
}

// Page-side helper: marks the drawer as available while mounted, clears
// on unmount, and returns the open/setOpen pair so the page can render
// its own <Drawer.Root>. The page is responsible for the drawer's
// content; this hook only handles the registration handshake.
export function useRegisterSidebarDrawer(enabled = true) {
  const ctx = useSidebarDrawer()
  const { setAvailable, setOpen } = ctx
  useEffect(() => {
    setAvailable(enabled)
    if (!enabled) setOpen(false)
    return () => {
      setAvailable(false)
      setOpen(false)
    }
  }, [enabled, setAvailable, setOpen])
  return { open: ctx.open, setOpen: ctx.setOpen }
}
