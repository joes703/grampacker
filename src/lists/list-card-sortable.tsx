import { GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'

// Shared dnd-kit wiring for list-card rows. Both ListsPage's row table and
// DesktopListsPanel's compact rail row render the same shape (drag handle
// + name + kebab) on top of the same `'list-card'` DnD kind. The
// row-chrome differences (padding, hover, divide-y vs border-b, the
// active-list highlight, the "Updated …" meta column) stay per-site
// because they're intentional and shallow. The boilerplate that didn't
// vary — the useSortable call, the transform/opacity style, and the grip
// button itself — lives here so a future density or grip change happens
// in one place.
//
// Rename gating + reorder-pending gating: pass `disabled = renaming ||
// reorderPending` exactly as both call sites did inline before. Keeping
// the disabled rule at the call site (not built into the hook) is
// intentional — the rule is "anything that should suspend dragging,"
// which can grow per surface (e.g. modal-open, multi-select).
//
// Icon size is a prop so the existing visuals don't drift: ListsPage's
// card-page row carries a 16px grip (denser chrome around it); the
// panel row's denser layout uses 14px to match. Pass explicitly; default
// 14 matches the more recent panel surface.
export function useListCardSortable({
  listId,
  disabled,
  gripIconSize = 14,
}: {
  listId: string
  disabled?: boolean
  gripIconSize?: number
}): {
  outerRef: (el: HTMLElement | null) => void
  outerStyle: React.CSSProperties
  dragHandle: React.ReactNode
} {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: makeDnDId('list-card', listId),
    disabled,
  })

  const outerStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // ROW_CONTROL_TARGET = 40px touch / 28px pointer (see flat-table-styles).
  // `touch-none` keeps a drag that starts on the grip from racing the
  // browser's scroll on touch devices; because the grip is a dedicated
  // target (not the whole card) this doesn't cost normal list scrolling.
  // TouchSensor's press-and-hold delay gates accidental drags.
  const dragHandle = (
    <button
      ref={asButtonRef(setActivatorNodeRef)}
      type="button"
      {...listeners}
      {...attributes}
      tabIndex={-1}
      aria-label="Drag to reorder list"
      className={`${ROW_CONTROL_TARGET} shrink-0 text-gray-400 cursor-grab touch-none hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing`}
    >
      <GripVertical size={gripIconSize} />
    </button>
  )

  return { outerRef: setNodeRef, outerStyle, dragHandle }
}

// Inline-rename input chrome for list rows. Both ListsPage's row table
// and DesktopListsPanel's panel row swap the row's name link for a
// blue-bordered text input on rename; the input's class string was
// identical between the two sites. Centralized so the focus ring / weight
// / size stay in lockstep.
//
// Stays at text-sm (not lg:text-[13px]) intentionally: this is ephemeral
// editing chrome, not body text, and matching the surrounding row's
// link weight (font-medium text-gray-900) gives the user a stable size
// across the rename swap on both viewports.
export const LIST_RENAME_INPUT_CLASS =
  'rounded border border-blue-400 px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
