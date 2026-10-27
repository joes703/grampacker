import type { ReactNode } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import { parseDnDId } from '../lib/dnd-ids'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import ItemRow from './ItemRow'
import type { useListDnd } from './use-list-dnd'

type Props = {
  dnd: ReturnType<typeof useListDnd>
  groupingKind: 'category' | 'location'
  listItemsById: ReadonlyMap<string, ListItemWithGear>
  // The packing-location section being dragged (Pack only).
  activeLocation?: PackingLocation | null
  weightUnit: WeightUnit
  isBelowLg: boolean
  children: ReactNode
}

// The list document's one DndContext, with the drag overlay and the
// screen-reader narration. List and Pack both render their sections inside it.
export default function ListDndArea({
  dnd,
  groupingKind,
  listItemsById,
  activeLocation = null,
  weightUnit,
  isBelowLg,
  children,
}: Props) {
  const active = dnd.activeId ? parseDnDId(dnd.activeId) : null
  const activeItem = active?.kind === 'item' ? (listItemsById.get(active.id) ?? null) : null
  // Location grouping drags `packing-item:` and `packing-food-item:` ids. The
  // full ItemRow clone is too heavy to read mid-drag when the target is
  // another section rather than a slot, so those drags show a name chip.
  const activeChipName =
    active?.kind === 'packing-item'
      ? listItemsById.get(active.id)?.gearItem.name
      : active?.kind === 'packing-food-item'
        ? dnd.foodById.get(active.id)?.name
        : undefined

  return (
    <DndContext
      sensors={dnd.sensors}
      // Location grouping needs the packing filter: it keeps a section drag
      // from landing on a cousin (which would silently reparent it) and keeps
      // an item drag from colliding with things it can never be dropped on.
      // Category grouping has one kind of target and needs no filtering.
      collisionDetection={groupingKind === 'location' ? dnd.collisionDetection : closestCenter}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      {children}
      {/* className reaches the overlay's own portaled wrapper; the chips
          below are not inside anything already print-hidden. */}
      <DragOverlay dropAnimation={null} className="print:hidden">
        {activeItem ? (
          <ItemRow item={activeItem} weightUnit={weightUnit} isBelowLg={isBelowLg} />
        ) : activeChipName !== undefined ? (
          <div className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm shadow-lg">
            {activeChipName}
          </div>
        ) : activeLocation ? (
          <div className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold shadow-lg">
            {activeLocation.name}
          </div>
        ) : null}
      </DragOverlay>
      {/* Packing drags have no visible result for a screen reader otherwise:
          the row simply stops being where it was. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {dnd.announcement}
      </div>
    </DndContext>
  )
}
