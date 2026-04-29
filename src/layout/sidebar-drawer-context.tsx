import { createContext, useContext, useMemo, useState, useEffect } from 'react'

// Coordinates the mobile sidebar trigger (in NavBar, top-left of the
// header) with the drawer instance owned by whichever page provides
// sidebar content. The trigger and the drawer live in different React
// subtrees — NavBar is mounted by AppShell, the drawer is mounted by
// ListDetailPage — so a context bridges them.
//
// Pages that have a sidebar drawer call useRegisterSidebarDrawer() on
// mount; the trigger renders whenever any page is registered. Pages
// that don't (Gear, Settings, Help, About) simply omit the call and
// the trigger stays hidden, leaving NavBar's mobile chrome at: brand
// + hamburger.

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
export function useRegisterSidebarDrawer() {
  const ctx = useSidebarDrawer()
  const { setAvailable, setOpen } = ctx
  useEffect(() => {
    setAvailable(true)
    return () => {
      setAvailable(false)
      setOpen(false)
    }
  }, [setAvailable, setOpen])
  return { open: ctx.open, setOpen: ctx.setOpen }
}
