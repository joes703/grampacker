import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties } from 'react'
import { makeDnDId, type DnDIdKind } from './dnd-ids'

// The shared dnd-kit sortable-row recipe: typed id, the transform/transition/
// drag-fade outer style, and the spreadable activator props every grip button
// wires the same way. Per-surface rules stay at the call site: what disables
// dragging (select mode, an in-flight reorder, temp- ids) and what the grip
// looks like.
//
// The container pack section (useSortableContainerSection) stays on raw
// useSortable + useDraggable: its node carries two drag identities whose
// transforms merge, which is not this recipe.
export function useSortableRow({
  kind,
  id,
  disabled = false,
}: {
  kind: DnDIdKind
  id: string
  disabled?: boolean
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: makeDnDId(kind, id), disabled })

  const outerStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return {
    outerRef: setNodeRef,
    outerStyle,
    // Droppable hover state - only the pack location sections read it.
    isOver,
    // Spread onto the grip (RowIconButton or a custom button): activator
    // ref + dnd-kit listeners and attributes.
    handleProps: {
      ref: setActivatorNodeRef,
      ...listeners,
      ...attributes,
    },
  }
}

export type SortableHandleProps = ReturnType<typeof useSortableRow>['handleProps']
