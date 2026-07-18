import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2 } from 'lucide-react'
import { usePortalPopover } from '../lib/use-portal-popover'
import { POPOVER_SURFACE } from '../components/flat-table-styles'
import FoodOptionsContent from './FoodOptionsContent'

type Props = {
  onImport: () => void
  onExport: () => void
  canExport: boolean
}

// Desktop popover trigger for Food page rare/utility actions (Import/Export
// CSV). Mirrors GearOptionsButton: usePortalPopover for dismiss + a
// portal-rendered panel anchored to the trigger's bottom-right. Hidden below
// lg because MobileFoodActionBar owns the equivalent surface there.
export default function FoodOptionsButton(props: Props) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const open = pos !== null

  function openPopover() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
  }

  usePortalPopover({
    isOpen: open,
    onClose: () => setPos(null),
    triggerRef,
    contentRef: popoverRef,
  })

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setPos(null) : openPopover())}
        title="Food options"
        aria-label="Food options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <Settings2 size={14} />
        Options
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className={`fixed z-50 w-64 p-2 ${POPOVER_SURFACE}`}
          style={{ top: pos.top, right: pos.right }}
        >
          <FoodOptionsContent {...props} onAction={() => setPos(null)} />
        </div>,
        document.body,
      )}
    </>
  )
}
