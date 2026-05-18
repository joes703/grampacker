import { Drawer } from 'vaul'
import { X } from 'lucide-react'

// Lazy boundary for vaul's left-direction sidebar drawer on the list page.
// Mirrors ListSelectorDrawer's shape: Drawer.Root + Drawer.Portal +
// Drawer.Overlay + Drawer.Content + Drawer.Title; the panel body
// (LibraryPanel) is passed in as `children` so this file imports only
// vaul + the chrome icons. Together with M11's useIsBelowLg gate at the
// caller, vaul never loads on desktop.
//
// Header: title + close. The drawer previously also carried a "Manage"
// link to Gear Inventory; the mobile bottom bar now exposes a Gear
// destination on every authed route, so the in-drawer nav was redundant.
type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  children: React.ReactNode
}

export default function ListSidebarDrawer({ open, onOpenChange, children }: Props) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="left">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-sm flex-col bg-gray-50">
          <Drawer.Title className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">Gear Library</span>
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
