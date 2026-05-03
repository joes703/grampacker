import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Drawer } from 'vaul'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import { queryKeys, createList } from '../lib/queries'
import type { List } from '../lib/types'
import { usePortalPopover } from '../lib/use-portal-popover'

type Props = {
  lists: List[]
  currentListId: string | null
  userId: string
}

// Inline media-query hook, kept private to this file. The selector is the
// only consumer today; if a second one appears, hoist to src/lib/.
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

// Trigger + dual-surface dropdown: portal popover at md+, Vaul bottom sheet
// at <md. Same content body for both. Used by the top bar to switch between
// lists, create a new one inline, or jump to /lists for full management.
export default function ListSelector({ lists, currentListId, userId }: Props) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Desktop popover dismissal. The hook noops when isOpen is false, so this
  // does no work on mobile (where Vaul handles its own dismissal).
  usePortalPopover({
    isOpen: open && !isMobile,
    onClose: () => setOpen(false),
    triggerRef,
    contentRef: popoverRef,
  })

  function handleTriggerClick() {
    if (open) {
      setOpen(false)
      return
    }
    if (!isMobile && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // Align dropdown's left edge with the trigger; clamped to keep ~16px off
      // the right edge of the viewport for narrow tablets.
      const dropdownWidth = 280
      setPos({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - dropdownWidth - 16),
      })
    }
    setOpen(true)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        aria-label="Switch list"
        aria-expanded={open}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:text-gray-700"
      >
        <ChevronDown size={16} />
      </button>

      {/* Desktop popover */}
      {open && !isMobile && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-50 w-[280px] rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          <SelectorBody
            lists={lists}
            currentListId={currentListId}
            userId={userId}
            onClose={() => setOpen(false)}
          />
        </div>,
        document.body,
      )}

      {/* Mobile bottom sheet */}
      {isMobile && (
        <Drawer.Root open={open} onOpenChange={setOpen} direction="bottom">
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-xl bg-white pb-[env(safe-area-inset-bottom)]">
              <Drawer.Title className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <span className="text-sm font-semibold text-gray-900">Switch list</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded p-1 text-gray-400 hover:text-gray-600"
                >
                  <X size={18} />
                </button>
              </Drawer.Title>
              <SelectorBody
                lists={lists}
                currentListId={currentListId}
                userId={userId}
                onClose={() => setOpen(false)}
              />
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
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
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
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
