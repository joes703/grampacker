import { Suspense, lazy, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Plus, X } from 'lucide-react'

const ListSelectorDrawer = lazy(() => import('./ListSelectorDrawer'))
import { queryKeys, createList, makeOptimisticInsert } from '../lib/queries'
import type { List } from '../lib/types'
import { usePortalPopover } from '../lib/use-portal-popover'
import { useIsMobile } from '../lib/use-breakpoint'
import { optimisticListPlaceholder } from '../lib/optimistic-list-placeholder'

type Props = {
  lists: List[]
  currentListId: string | null
  userId: string
  // Controlled open state — lifted to the parent (NavBar's ListHeading) so
  // the surrounding list-switcher container can also toggle the selector
  // via its own click handler.
  open: boolean
  onOpenChange: (next: boolean) => void
  // Element the desktop popover anchors to (and that usePortalPopover
  // treats as the trigger for outside-click). Typically the list-switcher
  // container, so the dropdown opens flush with the heading row's left
  // edge rather than from the chevron's corner.
  anchorRef: RefObject<HTMLElement | null>
}

// Trigger + dual-surface dropdown: portal popover at md+, Vaul bottom sheet
// at <md. Same content body for both. Used by the top bar to switch between
// lists, create a new one inline, or jump to /lists for full management.
export default function ListSelector({ lists, currentListId, userId, open, onOpenChange, anchorRef }: Props) {
  const isMobile = useIsMobile()
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Desktop popover dismissal. The hook noops when isOpen is false, so this
  // does no work on mobile (where Vaul handles its own dismissal). The
  // anchor doubles as the trigger for outside-click — clicking anywhere
  // inside the list-switcher container while open is treated as an inside
  // click and doesn't dismiss.
  usePortalPopover({
    isOpen: open && !isMobile,
    onClose: () => onOpenChange(false),
    triggerRef: anchorRef,
    contentRef: popoverRef,
  })

  // Compute popover position from the anchor's rect when the desktop
  // popover is about to render. Clamped on both sides — left to keep
  // ≥16 px off the viewport edge (tiny windows where the heading row is
  // itself near the left edge), right via the dropdown-width subtraction
  // (narrow tablets where the heading row sits close to the right edge).
  // Stale pos when closed is harmless — the desktop popover only renders
  // under `open && pos`, so we never read it in the closed state.
  useEffect(() => {
    if (!open || isMobile) return
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const dropdownWidth = 280
    setPos({
      top: rect.bottom + 4,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - dropdownWidth - 16)),
    })
  }, [open, isMobile, anchorRef])

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Stop propagation so the outer container's onClick (which also
          // toggles the selector) doesn't fire and immediately re-toggle.
          e.stopPropagation()
          onOpenChange(!open)
        }}
        aria-label="Switch list"
        aria-expanded={open}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:text-gray-700"
      >
        <ChevronDown size={16} />
      </button>

      {/* Desktop popover */}
      {open && !isMobile && pos && createPortal(
        // Stop event propagation so clicks and keystrokes don't bubble
        // through the React tree to NavBar's ListHeading container,
        // which also has onClick (toggles the selector) and onKeyDown
        // (Space/Enter activate). Without this, clicking "+ New list"
        // inside the popover would trigger the container's toggle and
        // close the popover before the form could render. The keystroke
        // guard mirrors the click guard — defense in depth alongside
        // NavBar's target check on its keyboard handler. The div is
        // strictly a propagation barrier; its interactive children own
        // their own a11y semantics, so the static-element-interactions
        // rule is misfiring here.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- propagation barrier; interactive children handle their own semantics
        <div
          ref={popoverRef}
          className="fixed z-50 w-[280px] rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <SelectorBody
            lists={lists}
            currentListId={currentListId}
            userId={userId}
            onClose={() => onOpenChange(false)}
          />
        </div>,
        document.body,
      )}

      {/* Mobile bottom sheet — vaul lazy-loaded; desktop never fetches the
          chunk because `isMobile` is false at ≥md. */}
      {isMobile && (
        <Suspense fallback={null}>
          <ListSelectorDrawer open={open} onOpenChange={onOpenChange}>
            <SelectorBody
              lists={lists}
              currentListId={currentListId}
              userId={userId}
              onClose={() => onOpenChange(false)}
            />
          </ListSelectorDrawer>
        </Suspense>
      )}
    </>
  )
}

function SelectorBody({
  lists,
  currentListId,
  userId,
  onClose,
}: {
  lists: List[]
  currentListId: string | null
  userId: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const createMut = useMutation({
    mutationFn: (name: string) => createList(userId, name, lists.length),
    ...makeOptimisticInsert<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      optimistic: (name) => optimisticListPlaceholder({ name, userId, sortOrder: lists.length }),
    }),
    onSuccess: (created) => {
      setCreating(false)
      setDraft('')
      onClose()
      navigate(`/lists/${created.id}`)
    },
  })

  function submitNew() {
    const trimmed = draft.trim()
    if (!trimmed || createMut.isPending) return
    createMut.mutate(trimmed)
  }

  return (
    <div className="flex flex-col">
      {/* List of lists */}
      <div className="max-h-[60vh] overflow-y-auto py-1">
        {lists.length === 0 ? (
          <p className="px-4 py-3 text-sm italic text-gray-400">No lists yet</p>
        ) : (
          lists.map((list) => {
            const isCurrent = list.id === currentListId
            return (
              <button
                key={list.id}
                type="button"
                onClick={() => {
                  if (!isCurrent) {
                    onClose()
                    navigate(`/lists/${list.id}`)
                  } else {
                    onClose()
                  }
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 ${
                  isCurrent ? 'font-medium text-gray-900' : 'text-gray-700'
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

      <div className="border-t border-gray-100" />

      {/* + New list */}
      {creating ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <input
            autoFocus
            type="text"
            placeholder="List name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew()
              if (e.key === 'Escape') {
                setDraft('')
                setCreating(false)
              }
            }}
            className="flex-1 min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={submitNew}
            disabled={!draft.trim() || createMut.isPending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft('')
              setCreating(false)
            }}
            aria-label="Cancel"
            className="rounded p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
        >
          <Plus size={14} className="text-gray-500" />
          <span>New list</span>
        </button>
      )}

      <div className="border-t border-gray-100" />

      {/* Manage lists */}
      <button
        type="button"
        onClick={() => {
          onClose()
          navigate('/lists')
        }}
        className="px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
      >
        Manage lists
      </button>
    </div>
  )
}
