import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router'
import { ClipboardList, Globe, MoreVertical, Shirt } from 'lucide-react'
import type { List } from '../lib/types'
import { usePortalPopover } from '../lib/use-portal-popover'

type Props = {
  list: List
  // NavBar opens a share modal (PrivacyPanel inside <Modal>) when this fires.
  // Done at the parent level so the modal is portal-rendered into the
  // document root rather than nested inside the popover, which would close
  // when the modal opened (mousedown bubbling through the dialog backdrop).
  onShareClick: () => void
  // Group worn is owned by ListContextControls (which holds the mutation
  // bound to the ['lists'] cache); the kebab just dispatches the toggle and
  // reads the current state from list.group_worn for active styling.
  onGroupWornClick: () => void
}

// Mobile-only kebab on /lists/:id that exposes Pack, Group worn, and Share.
// At md+ those controls render inline in the top bar and this component is
// hidden by its parent's `md:hidden` wrapper. Pack mode is URL-driven
// (?mode=pack); Share hands off to NavBar via the onShareClick callback.
export default function ListActionsKebab({ list, onShareClick, onGroupWornClick }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const isPackMode = searchParams.get('mode') === 'pack'
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = pos !== null

  usePortalPopover({
    isOpen: open,
    onClose: () => setPos(null),
    triggerRef,
    contentRef: menuRef,
  })

  function openMenu() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }

  function togglePackMode() {
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev)
        if (isPackMode) np.delete('mode')
        else np.set('mode', 'pack')
        return np
      },
      { replace: false },
    )
    setPos(null)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setPos(null) : openMenu())}
        aria-label="List actions"
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
      >
        <MoreVertical size={18} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: pos.top, right: pos.right }}
        >
          <button
            type="button"
            onClick={togglePackMode}
            aria-pressed={isPackMode}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
              isPackMode
                ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <ClipboardList size={14} />
            <span>{isPackMode ? 'Exit pack mode' : 'Pack mode'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPos(null)
              onGroupWornClick()
            }}
            aria-pressed={list.group_worn}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
              list.group_worn
                ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Shirt size={14} />
            <span>{list.group_worn ? 'Ungroup worn' : 'Group worn'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPos(null)
              onShareClick()
            }}
            aria-pressed={list.is_shared}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
              list.is_shared
                ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Globe size={14} />
            <span>Share…</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
