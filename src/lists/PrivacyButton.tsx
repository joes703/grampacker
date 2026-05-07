import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Globe } from 'lucide-react'
import type { List } from '../lib/types'
import { usePortalPopover } from '../lib/use-portal-popover'
import PrivacyPanel from './PrivacyPanel'

type Props = { list: List }

// Privacy toggle + share-link manager. The trigger is a single icon button;
// clicking opens a popover (portal-rendered to escape any overflow clipping)
// containing PrivacyPanel. Outside-click + scroll/resize close the popover.
// PrivacyPanel is shared with the mobile share-modal path so the inner UI
// stays in sync between both surfaces.
export default function PrivacyButton({ list }: Props) {
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
        title={list.is_shared ? 'Public — click to manage' : 'Private — click to manage'}
        aria-label={list.is_shared ? 'Privacy: public — click to manage' : 'Privacy: private — click to manage'}
        aria-pressed={list.is_shared}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
          list.is_shared
            ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'border-gray-300 text-gray-500 hover:bg-gray-50'
        }`}
      >
        <Globe size={14} />
        <span className="hidden sm:inline">Share</span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-50 w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          style={{ top: pos.top, right: pos.right }}
        >
          <PrivacyPanel list={list} />
        </div>,
        document.body,
      )}
    </>
  )
}
