import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'
import RowIconButton from '../components/RowIconButton'
import ItemRow, { type ItemRowProps } from './ItemRow'

// This lived inside ItemRow.tsx, which meant every module that rendered a row
// imported @dnd-kit - including SharePage, the PUBLIC, READ-ONLY share view,
// which cannot drag anything. A read-only page was downloading a
// drag-and-drop library. Splitting it into its own module is what lets the
// bundler see that: nothing on the anonymous path imports this file, so
// @dnd-kit stays out of the anonymous graph entirely.
//
// Keep it that way. The rule is one line long: no VALUE import from @dnd-kit in
// ItemRow.tsx or CategoryGroup.tsx, because both are on the share view's
// critical path. Drag belongs to the authenticated list view, so it belongs
// here, in a module only the authenticated list view imports.
//
// Sortable wrapper for the authenticated list view. Calls useSortable, wires
// the row's outer ref + transform style + drag-handle button, and forwards
// everything else to ItemRow. Must be rendered inside a SortableContext.
// Drag is disabled in pack mode (structural changes inert while checking
// off items) and while a previous reorder mutation is in flight (prevents
// the rollback-clobber race when two reorders overlap).
export default function SortableItemRow(
  props: Omit<ItemRowProps, 'dragHandle' | 'outerRef' | 'outerStyle'>,
) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: makeDnDId('item', props.item.id),
    disabled: props.packMode || props.reorderPending,
  })

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // Desktop drives reorder from a compact in-row grip. This used to sit in
  // the outside-left gutter, but flat table surfaces intentionally use
  // overflow-hidden for rounded corners, which clips out-of-surface handles.
  // Mobile has no hover affordance, so the row itself remains the long-press
  // activator via rowDragListeners. Pack mode disables drag entirely.
  const handle =
    props.isBelowLg || props.packMode ? undefined : (
      <RowIconButton
        ref={asButtonRef(setActivatorNodeRef)}
        {...listeners}
        {...attributes}
        tabIndex={-1}
        variant="dragHandle"
        ariaLabel="Drag to reorder"
        icon={<GripVertical size={14} />}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      />
    )

  return (
    <ItemRow
      {...props}
      dragHandle={handle}
      rowDragListeners={props.isBelowLg && !props.packMode ? listeners : undefined}
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
    />
  )
}
