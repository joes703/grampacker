import { Drawer } from 'vaul'
import { X } from 'lucide-react'

// Lazy boundary for vaul (~15-20 KB gzip mobile-only). Imported via
// React.lazy from ListSelector. The body (SelectorBody — list of lists,
// "+ New list", "Lists") stays in ListSelector since it's also used
// by the desktop popover and doesn't depend on vaul; passed as children.
// Together with M11's useIsMobile gate, vaul never loads on desktop.
type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  children: React.ReactNode
}

export default function ListSelectorDrawer({ open, onOpenChange, children }: Props) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="bottom">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-xl bg-white pb-[env(safe-area-inset-bottom)]"
          // Same propagation guard as the desktop popover — events
          // inside the bottom sheet must not bubble to the container.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Drawer.Title className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">Switch list</span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="rounded p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </Drawer.Title>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
