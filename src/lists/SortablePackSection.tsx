import { useCallback, useState, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { useSortableRow } from '../lib/use-sortable-row'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, PackageOpen, Pencil, Trash2 } from 'lucide-react'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import { MAX_PACKING_LOCATION_NAME } from '../lib/caps'
import { makeDnDId } from '../lib/dnd-ids'
import KebabMenu from '../components/KebabMenu'
import InlineRenameInput from '../components/InlineRenameInput'
import RowIconButton from '../components/RowIconButton'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import { FLAT_TABLE_HEADER_TITLE } from '../components/flat-table-styles'

// The drag + admin chrome for a packing-location section in pack mode.
//
// Same seam as SortableCategoryRows: PackSection must not import @dnd-kit or
// any authenticated component. This module owns both and hands PackSection
// opaque ReactNodes through its headerLeading / headerAction props. Only the
// authenticated Pack view (PackDocument, PackLocationSection) imports this
// file.
//
// It wraps the checklist section itself, because arranging and packing are
// one view.

// A location section that is NOT backed by an item. One identity: the section
// itself, which reorders among its siblings and accepts item drops.
export function useSortableLocationSection({
  location,
  reorderPending,
}: {
  location: PackingLocation
  reorderPending: boolean
}) {
  const { outerRef, outerStyle, isOver, handleProps } = useSortableRow({
    kind: 'packing-location',
    id: location.id,
    // A temp- id is an optimistic row the server has not confirmed. Dragging
    // it would address a location that does not exist yet.
    disabled: reorderPending || location.id.startsWith('temp-'),
  })

  return {
    setNodeRef: outerRef,
    isOver,
    style: outerStyle,
    dragHandle: (
      <RowIconButton
        touchSafe
        {...handleProps}
        disabled={reorderPending}
        variant="dragHandle"
        ariaLabel={`Drag ${location.name} to reorder`}
        icon={<GripVertical size={14} />}
      />
    ),
  }
}

// A location BACKED by a list item ("use as container"). Two identities on one
// node, and both are load-bearing:
//
//   packing-location:<id>  - reorder this section among its siblings, and be a
//                            drop target for items.
//   packing-item:<itemId>  - drag the BACKING ITEM into another container,
//                            which is how containers nest.
//
// Collapsing this to the section identity alone would silently remove
// nesting: the backing item would no longer be a drag source, and
// buildContainerMoveExclusions - which exists to stop a container being
// dropped into its own subtree - would have nothing to constrain.
export function useSortableContainerSection({
  location,
  containerItem,
  reorderPending,
  movePending,
}: {
  location: PackingLocation
  containerItem: ListItemWithGear
  reorderPending: boolean
  movePending: boolean
}) {
  const {
    attributes: reorderAttributes,
    listeners: reorderListeners,
    setActivatorNodeRef: setReorderActivatorNodeRef,
    setNodeRef: setSortableNodeRef,
    transform: reorderTransform,
    transition,
    isDragging: isReordering,
    isOver,
  } = useSortable({
    id: makeDnDId('packing-location', location.id),
    disabled: reorderPending || location.id.startsWith('temp-'),
  })
  const {
    attributes: nestingAttributes,
    listeners: nestingListeners,
    setActivatorNodeRef: setNestingActivatorNodeRef,
    setNodeRef: setNestingNodeRef,
    transform: nestingTransform,
    isDragging: isNesting,
  } = useDraggable({
    id: makeDnDId('packing-item', containerItem.id),
    disabled: movePending,
  })
  const setNodeRef = useCallback((node: HTMLElement | null) => {
    setSortableNodeRef(node)
    setNestingNodeRef(node)
  }, [setNestingNodeRef, setSortableNodeRef])

  return {
    setNodeRef,
    isOver,
    style: {
      // Whichever drag is active owns the transform; they share a node.
      transform: CSS.Transform.toString(isNesting ? nestingTransform : reorderTransform),
      transition: isNesting ? undefined : transition,
      opacity: isNesting || isReordering ? 0.35 : 1,
    },
    dragHandle: (
      <RowIconButton
        touchSafe
        ref={setReorderActivatorNodeRef}
        {...reorderListeners}
        {...reorderAttributes}
        disabled={reorderPending}
        variant="dragHandle"
        ariaLabel={`Reorder ${containerItem.gearItem.name}`}
        icon={<GripVertical size={14} />}
      />
    ),
    nestHandle: (
      <RowIconButton
        touchSafe
        ref={setNestingActivatorNodeRef}
        {...nestingListeners}
        {...nestingAttributes}
        disabled={movePending}
        ariaLabel={`Move ${containerItem.gearItem.name} into another container`}
        title="Move into another container"
        icon={<PackageOpen size={14} />}
      />
    ),
  }
}

// Rename / Delete for a plain location, Stop-using-as-container for an
// item-backed one.
export function PackSectionMenu({
  title,
  itemBacked,
  onRename,
  onDelete,
}: {
  title: string
  itemBacked: boolean
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <KebabMenu touchSafe ariaLabel={`${title} options`} menuLabel={`${title} actions`}>
      {({ close }) =>
        itemBacked ? (
          <RowMenuItem icon={<PackageOpen size={13} />} onClick={() => {
            close()
            onDelete()
          }}>
            Stop using as container
          </RowMenuItem>
        ) : (
          <>
            <RowMenuItem icon={<Pencil size={13} />} onClick={() => {
              close()
              onRename()
            }}>
              Rename
            </RowMenuItem>
            <RowMenuSeparator />
            <RowMenuItem icon={<Trash2 size={13} />} tone="danger" onClick={() => {
              close()
              onDelete()
            }}>
              Delete location
            </RowMenuItem>
          </>
        )
      }
    </KebabMenu>
  )
}

// Rename-in-place for a packing location.
// Self-contained draft state: the page owns only WHICH section is renaming, so
// switching sections cannot leak a half-typed name between them (the caller
// keys this by location id).
export function PackSectionRenameInput({
  name,
  onRename,
  onCancel,
}: {
  name: string
  onRename: (name: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(name)

  function commit() {
    const next = draft.trim()
    // maxLength caps the upper bound; an empty or unchanged name is simply
    // not a rename, so it closes without a write.
    if (next && next !== name) onRename(next)
    onCancel()
  }

  return (
    <>
      {/* This input REPLACES the section title while a rename is open, so
          hiding it in print would leave the section with no heading at all.
          The static name prints in its place. */}
      <span className={`hidden print:block min-w-0 flex-1 [overflow-wrap:anywhere] ${FLAT_TABLE_HEADER_TITLE}`}>
        {name}
      </span>
      <InlineRenameInput
        value={draft}
        maxLength={MAX_PACKING_LOCATION_NAME}
        selectOnOpen={false}
        ariaLabel="Packing location name"
        onChange={setDraft}
        onSubmit={commit}
        onCancel={onCancel}
        className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-2 py-1 text-sm font-semibold text-gray-900 print:hidden"
      />
    </>
  )
}

// The Unassigned bucket. Not sortable (it is not a location row and has no
// sortOrder) but it IS a drop target - dragging a row here is how you take it
// out of a container.
export function DroppableUnassignedSection({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: makeDnDId('packing-location', 'unassigned'),
  })
  return (
    <div ref={setNodeRef} className={isOver ? 'rounded-lg ring-2 ring-blue-400' : ''}>
      {children}
    </div>
  )
}
