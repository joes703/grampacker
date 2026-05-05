import { Drawer } from 'vaul'
import { Link } from 'react-router'
import { ChevronRight, X } from 'lucide-react'

// Lazy boundary for vaul's left-direction sidebar drawer on the list page.
// Mirrors ListSelectorDrawer's shape: Drawer.Root + Drawer.Portal +
// Drawer.Overlay + Drawer.Content + Drawer.Title; the panel body
// (LibraryPanel) is passed in as `children` so this file imports only
// vaul + the chrome icons. Together with M11's useIsBelowLg gate at the
// caller, vaul never loads on desktop.
type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Used in the "Manage" link href; closes the drawer on tap so the user
   *  sees the exit animation rather than an abrupt unmount on route change. */
  manageHref: string
  children: React.ReactNode
}

export default function ListSidebarDrawer({ open, onOpenChange, manageHref, children }: Props) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="left">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-sm flex-col bg-gray-50">
          <Drawer.Title className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">Gear Library</span>
            <Link
              to={manageHref}
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              Manage <ChevronRight size={12} />
            </Link>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close gear library"
              className="ml-auto rounded p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </Drawer.Title>
          <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
            <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 flex-1">
              <div className="flex-1 min-h-0 overflow-hidden">
                {children}
              </div>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
