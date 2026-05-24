import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2 } from 'lucide-react'
import { usePortalPopover } from '../lib/use-portal-popover'
import { POPOVER_SURFACE } from '../components/flat-table-styles'
import GearOptionsContent from './GearOptionsContent'

type Props = {
  onNewCategory: () => void
  onImport: () => void
  onExport: () => void
  canExport: boolean
  onCollapseAll: () => void
  onExpandAll: () => void
  canCollapseExpand: boolean
}

// Desktop popover trigger for Gear page rare/utility actions (New category,
// Import, Export, Collapse all, Expand all). Mirrors the ListSettingsButton
// shape: usePortalPopover for dismiss + portal-rendered panel anchored to
// the trigger's bottom-right. Hidden at <md because MobileGearActionBar
// owns the equivalent surface there.
export default function GearOptionsButton(props: Props) {
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
        title="Gear options"
        aria-label="Gear options"
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
          <GearOptionsContent {...props} onAction={() => setPos(null)} />
        </div>,
        document.body,
      )}
    </>
  )
}
