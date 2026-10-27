import type { ReactNode } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { makeDnDId } from '../lib/dnd-ids'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import type { FoodItemResponse } from '../../shared/food'
import { PackLocationSection, type PackSectionProps } from './PackLocationSection'
import type { PackingTreeLocation } from './packing-tree'
import { EMPTY_FOOD_ITEMS } from './use-list-dnd'

// The recursive renderer for the packing tree's location sections, extracted
// from ListDetailPage. Every prop is a dependency the per-node render
// genuinely varies on; the rename and delete callbacks take the location so
// one set serves the whole tree.
//
// This file imports @dnd-kit and is authenticated-only. The dependency
// direction must stay tree -> PackLocationSection -> PackSection, so the
// section components never gain a dnd-kit import.
type PackingLocationTreeProps = {
  roots: PackingTreeLocation[]
  groupProps: PackSectionProps['groupProps']
  renderRowAction?: PackSectionProps['renderRowAction']
  renderFoodRowAction?: PackSectionProps['renderFoodRowAction']
  /** Builds the container header's menu. Page-owned, because that menu
   *  shares the move/edit/removal orchestration with the row menus. */
  renderContainerAction: (
    containerItem: ListItemWithGear,
    location: PackingLocation,
  ) => ReactNode
  foodByLocation: ReadonlyMap<string | null, FoodItemResponse[]>
  itemReorderPending: boolean
  /** Already includes creation-pending at the call site. */
  locationReorderPending: boolean
  movePending: boolean
  renamingLocationId: string | null
  onStartRename: (locationId: string) => void
  onCancelRename: () => void
  onRename: (locationId: string, name: string) => void
  onDeleteLocation: (location: PackingLocation) => void
}

export default function PackingLocationTree(props: PackingLocationTreeProps) {
  return (
    <SortableContext
      items={props.roots.map((node) =>
        makeDnDId('packing-location', node.location.id),
      )}
      strategy={verticalListSortingStrategy}
    >
      {props.roots.map((node) => renderNode(props, node, 0))}
    </SortableContext>
  )
}

function renderNode(
  props: PackingLocationTreeProps,
  node: PackingTreeLocation,
  depth: number,
): ReactNode {
  const location = node.location
  const containerItem = node.containerItem
  return (
    <PackLocationSection
      key={location.id}
      node={node}
      depth={depth}
      groupProps={props.groupProps}
      renderRowAction={props.renderRowAction}
      packFoodRows={props.foodByLocation.get(location.id) ?? EMPTY_FOOD_ITEMS}
      renderFoodRowAction={props.renderFoodRowAction}
      containerAction={
        containerItem ? props.renderContainerAction(containerItem, location) : undefined
      }
      itemReorderPending={props.itemReorderPending}
      locationReorderPending={props.locationReorderPending}
      movePending={props.movePending}
      renaming={props.renamingLocationId === location.id}
      onStartRename={() => props.onStartRename(location.id)}
      onCancelRename={props.onCancelRename}
      onRename={(name) => props.onRename(location.id, name)}
      onDelete={() => props.onDeleteLocation(location)}
    >
      {/* Nested containers get their OWN SortableContext. Sorting is
          scoped to a set of siblings, so without a context per level a
          nested section resolves against the root list, the strategy's
          auto-shift computes against the wrong neighbors, and a nested
          reorder produces no usable drop. */}
      {node.children.length > 0 && (
        <SortableContext
          items={node.children.map((child) =>
            makeDnDId('packing-location', child.location.id),
          )}
          strategy={verticalListSortingStrategy}
        >
          {node.children.map((child) => renderNode(props, child, depth + 1))}
        </SortableContext>
      )}
    </PackLocationSection>
  )
}
