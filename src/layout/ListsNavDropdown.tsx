import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ListChecks, Plus } from 'lucide-react'
import { usePortalPopover } from '../lib/use-portal-popover'
import { useRequireSession } from '../auth/use-require-session'
import { queryKeys, fetchLists } from '../lib/queries'

// Desktop-only top-nav Lists dropdown. The trigger pill matches the other
// md+ nav buttons (Gear/Help/Settings) so visual rhythm holds, and carries
// the active state when the route is /lists or /lists/:id. Clicking the
// pill anywhere opens a portal popover with the user's lists, "View all
// lists" (→ /lists), and "New list" (→ /lists). It is not a split button;
// the chevron is a visual cue only.
//
// Mobile is intentionally untouched — the mobile bottom-bar Lists item
// still navigates straight to /lists. This component is rendered only
// inside NavBar's `hidden md:flex` cluster.
//
// Dismissal: standard usePortalPopover (mousedown outside, scroll, resize,
// Escape), same as ListSettingsButton / GearOptionsButton.
//
// Position: anchored to the trigger's bottom-left. Clamped to keep ≥16px
// off the viewport edges so the popover never clips on narrow desktops.
export default function ListsNavDropdown() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''
  // Same query key NavBar's RouteHeading and ListDetailPage use — TanStack
  // Query dedupes by key, so this isn't an extra network call.
  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
  })

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const open = pos !== null

  // Pill is active on /lists and any /lists/:id, mirroring the prior
  // NavLink isActive semantics.
  const listsRouteActive =
    pathname === '/lists' || /^\/lists\/[^/]+$/.test(pathname)
  // For checkmarking the current list row inside the dropdown.
  const currentListMatch = pathname.match(/^\/lists\/([^/]+)$/)
  const currentListId = currentListMatch?.[1] ?? null

  function openPopover() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const popoverWidth = 240
    const left = Math.max(
      16,
      Math.min(rect.left, window.innerWidth - popoverWidth - 16),
    )
    setPos({ top: rect.bottom + 6, left })
  }

  usePortalPopover({
    isOpen: open,
    onClose: () => setPos(null),
    triggerRef,
    contentRef: popoverRef,
  })

  function go(to: string) {
    setPos(null)
    navigate(to)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setPos(null) : openPopover())}
        title="Lists"
        aria-label="Lists"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
          listsRouteActive
            ? 'bg-gray-100 text-gray-900'
            : 'text-gray-600 hover:bg-gray-50'
        }`}
      >
        <ListChecks size={14} />
        <span className="sr-only lg:not-sr-only">Lists</span>
        <ChevronDown size={12} className="opacity-60" />
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          role="menu"
          aria-label="Lists"
          className="fixed z-50 w-60 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {lists.length === 0 ? (
              <p className="px-3 py-2 text-sm italic text-gray-400">No lists yet.</p>
            ) : (
              lists.map((list) => {
                const isCurrent = list.id === currentListId
                return (
                  <button
                    key={list.id}
                    type="button"
                    role="menuitem"
                    onClick={() => go(`/lists/${list.id}`)}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 ${
                      isCurrent
                        ? 'bg-gray-50 font-medium text-gray-900'
                        : 'text-gray-700'
                    }`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {isCurrent && <Check size={14} className="text-blue-600" />}
                    </span>
                    <span className="truncate">{list.name}</span>
                  </button>
                )
              })
            )}
          </div>

          <div className="my-1 border-t border-gray-100" />

          <button
            type="button"
            role="menuitem"
            onClick={() => go('/lists')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            <ListChecks size={14} className="text-gray-500" />
            <span>View all lists</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => go('/lists')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            <Plus size={14} className="text-gray-500" />
            <span>New list</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
