import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'
import RowIconButton from '../components/RowIconButton'
import ItemRow, { type ItemRowProps } from './ItemRow'
import { useIsPlacing } from './placement-context'

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
// Drag is disabled while a previous reorder mutation is in flight (prevents
// the rollback-clobber race when two reorders overlap).
//
// Pack mode USED to disable drag entirely, on the reasoning that structural
// changes were inert while checking items off - true only because arranging
// happened in a separate Organize view. Pack is that view now, so pack rows
// drag like any other. Note there were two independent pack gates here (the
// `disabled` flag AND the handle being withheld); both are gone, because
// removing one without the other leaves rows registered as sortable with no
// activator to start a drag from.
//
// `dndKind` picks the id namespace. Category grouping keeps `item:`, whose
// planner reorders within a category. Location grouping uses `packing-item:`,
// which the packing planner understands - it can reorder within a location
// AND move a row between locations, and it shares that id space with the
// `packing-location:` drop targets. Same row component, two drag contracts.
export default function SortableItemRow({
  dndKind = 'item',
  ...props
}: Omit<ItemRowProps, 'dragHandle' | 'outerRef' | 'outerStyle'> & {
  dndKind?: 'item' | 'packing-item'
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: makeDnDId(dndKind, props.item.id),
    disabled: props.reorderPending,
  })

  // Click-to-place marks the row it is moving, so the insertion slots are not
  // floating next to an unidentified row. Read from context rather than passed
  // down - the section above this is memoized and bails out, and the prop
  // would have to come through CategoryGroup, which is on the share path.
  //
  // A TINT, not the 0.4 opacity dragging uses. A dragging row is inert and
  // under the cursor for a moment; a placing row stays put, stays interactive,
  // and keeps its checkboxes and menu operable. Fading all of that to 40%
  // would take the row's lightest text below its contrast floor while the user
  // is still expected to read and use it.
  const isPlacing = useIsPlacing(props.item.id)
  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    // Tailwind blue-50 / blue-400, matching the slots and the mode banner.
    ...(isPlacing
      ? { backgroundColor: '#eff6ff', boxShadow: 'inset 3px 0 0 0 #60a5fa' }
      : null),
  }

  // Every viewport drives reorder from a dedicated in-row grip. This used to sit in
  // the outside-left gutter, but flat table surfaces intentionally use
  // overflow-hidden for rounded corners, which clips out-of-surface handles.
  // On touch, keeping listeners on the grip preserves ordinary row scrolling;
  // the page-level TouchSensor still supplies delayed activation.
  //
  // The grip stays visible in pack mode rather than fading in on hover: a
  // pack row's grip also MOVES the row between locations, so it is a primary
  // affordance there, not a power-user shortcut. The label says both.
  const packing = dndKind === 'packing-item'
  const handle = (
    <RowIconButton
      touchSafe
      ref={asButtonRef(setActivatorNodeRef)}
      {...listeners}
      {...attributes}
      disabled={props.reorderPending}
      variant="dragHandle"
      ariaLabel={
        packing
          ? `Reorder or move ${props.item.gearItem.name}`
          : `Reorder ${props.item.gearItem.name}`
      }
      icon={<GripVertical size={14} />}
      className={props.isBelowLg || packing ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity'}
    />
  )

  return (
    <ItemRow
      {...props}
      dragHandle={handle}
      outerRef={setNodeRef}
      outerStyle={sortableStyle}
    />
  )
}
