import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import InlineTitle from './InlineTitle'
import ListSelector from '../layout/ListSelector'

type Props = {
  list: List
  lists: List[]
  userId: string
}

// Current-list selector + inline-rename header. Extracted from NavBar.ListHeading
// so two surfaces can share the same component:
//   - NavBar's mobile route heading (md:hidden) — preserves the existing
//     top-bar list identity behavior on phones.
//   - ListDetailPage's desktop list toolbar — owns list identity in the
//     page body now that desktop NavBar is global-only.
//
// Behavior preserved verbatim from the previous in-NavBar version:
//   - Click anywhere on the container (except the inline-rename input or
//     descendant interactive controls) toggles the ListSelector dropdown.
//   - Pencil affordance increments editTrigger to push InlineTitle into
//     edit mode. Hover-revealed at md+; always visible at <md for touch.
//   - Renames go through updateList with an optimistic update so the
//     heading reflects the new name immediately.
export default function CurrentListHeader({ list, lists, userId }: Props) {
  const qc = useQueryClient()
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    ...makeOptimisticUpdate<List, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.lists(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({
        ...item,
        name,
        updated_at: new Date().toISOString(),
      }),
    }),
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // Counter the pencil increments to push InlineTitle into edit mode. The
  // counter idiom matches LibraryPanel's focusSearchTrigger.
  const [editTrigger, setEditTrigger] = useState(0)

  function handleContainerClick() {
    // Mid-edit, the container becomes click-inert: the input owns the
    // click target while the user is typing, and its blur handler runs
    // commit/cancel for clicks that escape. Without this guard, clicking
    // the container's padding while editing would commit AND open the
    // selector in the same gesture.
    if (editing) return
    setSelectorOpen((o) => !o)
  }

  return (
    // Visual container — primary click target opens the selector
    // (frequent action). Rename moves to the sibling pencil affordance,
    // hover-revealed at md+ and always visible at <md (touch).
    //
    // The chevron button inside ListSelector is the keyboard-accessible
    // trigger for the selector (Tab + Enter); this div is a mouse-only
    // hit-area expansion. We still satisfy the click-events-have-key-events
    // / no-static-element-interactions a11y rules with role="button" +
    // tabIndex={-1} + an Enter/Space onKeyDown so screen-reader users who
    // happen to focus the container directly get the same affordance.
    <div
      ref={containerRef}
      role="button"
      tabIndex={-1}
      aria-label="Switch list (click). Use the chevron to keyboard-activate."
      onClick={handleContainerClick}
      onKeyDown={(e) => {
        // Only act on keys focused on the container itself. Descendants
        // (the rename input, the chevron button, the pencil button) own
        // their own key handling — without this guard, keystrokes bubble
        // up through the React tree and Space/Enter get preventDefault'd
        // before the descendant can read them. Most visible failure:
        // spacebar didn't insert spaces while renaming a list inline.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleContainerClick()
        }
      }}
      className={`group flex flex-1 min-w-0 items-center rounded-lg bg-gray-50 transition-colors hover:bg-gray-100 ${
        editing ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      <InlineTitle
        key={list.id}
        name={list.name}
        onSave={(v) => renameMut.mutate({ id: list.id, name: v })}
        editTrigger={editTrigger}
        onEditingChange={setEditing}
      />
      {!editing && (
        <button
          type="button"
          onClick={(e) => {
            // Don't bubble to the container's onClick — that would open
            // the selector in the same gesture as entering edit mode.
            e.stopPropagation()
            setEditTrigger((t) => t + 1)
          }}
          aria-label="Rename list"
          title="Rename list"
          // 32x32 hit area (h-8 w-8) for touch comfort. opacity-100 at
          // <md so touch users can always see it; md:opacity-0 +
          // md:group-hover:opacity-100 hides it on desktop until the
          // user hovers the switcher container.
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-400 opacity-100 transition-opacity hover:text-gray-600 md:opacity-0 md:group-hover:opacity-100"
        >
          <Pencil size={14} />
        </button>
      )}
      <ListSelector
        lists={lists}
        currentListId={list.id}
        userId={userId}
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        anchorRef={containerRef}
      />
    </div>
  )
}
