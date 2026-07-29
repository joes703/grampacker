import type { ComponentProps, ReactNode } from 'react'
import type { ListItemWithGear } from '../lib/types'
import CategoryGroup from './CategoryGroup'
import type { PackingTreeLocation } from './packing-tree'
import {
  PackSectionMenu,
  PackSectionRenameInput,
  useSortableContainerSection,
  useSortableLocationSection,
} from './SortablePackSection'

// One packing-location section in the merged Pack view: the checklist section
// (CategoryGroup) wrapped in its drag, drop and admin chrome.
//
// Two components rather than one with a conditional hook. A section backed by
// a list item needs a SECOND dnd identity (the backing item, so containers can
// be nested), and hooks cannot be called conditionally. React keys these by
// location id, so promoting an item to a container - or dropping that status -
// swaps the component type and remounts, which is the correct behavior anyway.
//
// The chrome is passed to CategoryGroup as opaque ReactNodes. CategoryGroup
// renders on the public share view and must not import @dnd-kit or any
// authenticated component; this module is the seam that keeps it that way,
// exactly like SortableCategoryRows does for rows.

export type PackSectionProps = {
  node: PackingTreeLocation
  depth: number
  groupProps: Omit<ComponentProps<typeof CategoryGroup>, 'name' | 'items'>
  collapsed: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  renderRowAction?: (item: ListItemWithGear) => ReactNode
  containerAction?: ReactNode
  itemReorderPending: boolean
  locationReorderPending: boolean
  movePending: boolean
  renaming: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onRename: (name: string) => void
  onDelete: () => void
  children?: ReactNode
}

// Nested sections indent under their parent. Depth 0 sits flush in the page's
// section stack.
function nestClass(depth: number): string {
  return depth === 0 ? '' : 'ml-3 border-l border-gray-200 pl-3 pt-2'
}

function sectionTitle(node: PackingTreeLocation): string {
  return node.containerItem?.gearItem.name ?? node.location.name
}

export function PackLocationSection(props: PackSectionProps) {
  return props.node.containerItem ? (
    <PackContainerSection {...props} containerItem={props.node.containerItem} />
  ) : (
    <PackPlainSection {...props} />
  )
}

function PackPlainSection({
  node,
  depth,
  groupProps,
  collapsed,
  onCollapsedChange,
  renderRowAction,
  itemReorderPending,
  locationReorderPending,
  renaming,
  onStartRename,
  onCancelRename,
  onRename,
  onDelete,
  children,
}: PackSectionProps) {
  const location = node.location
  const { setNodeRef, isOver, style, dragHandle } = useSortableLocationSection({
    location,
    reorderPending: locationReorderPending,
  })
  // An optimistic location has no server row yet, so rename and delete have
  // nothing to address.
  const confirmed = !location.id.startsWith('temp-')
  // A location can be item-backed while its backing ROW is out of view: a worn
  // container item is extracted into the Worn section, so buildPackingTree
  // resolves containerItem to null and this plain component renders instead of
  // PackContainerSection. The location is still item-backed - its name is the
  // gear item's, and the server rejects a rename - so the menu must be driven
  // by the structural fact on the location, never by whether the row happens to
  // be rendered.
  const itemBacked = location.containerListItemId !== null

  return (
    <div className={nestClass(depth)}>
      <div
        ref={setNodeRef}
        style={style}
        className={isOver ? 'rounded-lg ring-2 ring-blue-400' : ''}
      >
        <CategoryGroup
          {...groupProps}
          name={location.name}
          regionKey={location.id}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          items={node.items}
          packProgressItems={node.packProgressItems}
          reorderPending={itemReorderPending}
          renderRowAction={renderRowAction}
          headerLeading={dragHandle}
          titleContent={renaming ? (
            <PackSectionRenameInput
              name={location.name}
              onRename={onRename}
              onCancel={onCancelRename}
            />
          ) : undefined}
          headerAction={confirmed ? (
            <PackSectionMenu
              title={location.name}
              itemBacked={itemBacked}
              onRename={onStartRename}
              onDelete={onDelete}
            />
          ) : undefined}
        >
          {children}
        </CategoryGroup>
      </div>
    </div>
  )
}

function PackContainerSection({
  node,
  depth,
  groupProps,
  collapsed,
  onCollapsedChange,
  renderRowAction,
  containerAction,
  itemReorderPending,
  locationReorderPending,
  movePending,
  containerItem,
  children,
}: PackSectionProps & { containerItem: ListItemWithGear }) {
  const location = node.location
  const { setNodeRef, isOver, style, dragHandle, nestHandle } =
    useSortableContainerSection({
      location,
      containerItem,
      reorderPending: locationReorderPending,
      movePending,
    })
  const confirmed = !location.id.startsWith('temp-')

  return (
    <div className={nestClass(depth)}>
      <div
        ref={setNodeRef}
        style={style}
        className={isOver ? 'rounded-lg ring-2 ring-blue-400' : ''}
      >
        <CategoryGroup
          {...groupProps}
          name={sectionTitle(node)}
          regionKey={location.id}
          containerItem={containerItem}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          items={node.items}
          packProgressItems={node.packProgressItems}
          reorderPending={itemReorderPending}
          renderRowAction={renderRowAction}
          headerLeading={dragHandle}
          // An item-backed section has no rename (its name IS the gear item's
          // name) and no delete - only "stop using as container", which the
          // move menu also offers. The nest handle is what makes containers
          // nestable by drag; containerAction carries the same move actions
          // for keyboard and touch.
          headerAction={confirmed ? (
            <>
              {nestHandle}
              {containerAction}
            </>
          ) : undefined}
        >
          {children}
        </CategoryGroup>
      </div>
    </div>
  )
}

export { PackContainerSection, PackPlainSection }
