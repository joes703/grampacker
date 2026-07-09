import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { FLAT_TABLE_SURFACE } from '../components/flat-table-styles'

// Lazy boundary for the left-anchored sidebar drawer on the list page.
// The panel body (LibraryPanel) is passed in as `children` so this file
// imports only Radix Dialog + the chrome icons. Together with M11's
// useIsBelowLg gate at the caller, this never loads on desktop.
//
// Header: title + close. The title labels the drawer as the picker for
// pulling existing gear into this list; the Gear destination itself is
// reached via the mobile bottom bar, which exposes it on every authed
// route.
type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  children: React.ReactNode
}

export default function ListSidebarDrawer({ open, onOpenChange, children }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-sm flex-col bg-gray-50"
        >
          <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-gray-900">
              Add from gear
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close picker"
              className="ml-auto rounded p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
            <div className={`flex flex-col min-h-0 flex-1 ${FLAT_TABLE_SURFACE}`}>
              <div className="flex-1 min-h-0 overflow-hidden">
                {children}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
