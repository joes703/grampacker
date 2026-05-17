import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2 } from 'lucide-react'
import type { List } from '../lib/types'
import { usePortalPopover } from '../lib/use-portal-popover'
import ListSettingsPanel from './ListSettingsPanel'

type Props = { list: List }

// Popover trigger for current-list settings (Group worn items + Sharing).
// Shares the usePortalPopover dismiss pattern with the per-card
// PrivacyButton, RowKebab, etc. (see CLAUDE.md's popover rule). The
// per-card share button on /lists keeps its own PrivacyButton; this is the
// in-list-detail entrypoint where sharing now lives inside List options.
export default function ListSettingsButton({ list }: Props) {
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
        title="List options"
        aria-label="List options"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
      >
        <Settings2 size={14} />
        <span className="hidden sm:inline">List options</span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-50 w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          style={{ top: pos.top, right: pos.right }}
        >
          <ListSettingsPanel list={list} />
        </div>,
        document.body,
      )}
    </>
  )
}
