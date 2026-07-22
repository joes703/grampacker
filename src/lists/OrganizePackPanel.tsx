import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, PackageOpen, Plus } from 'lucide-react'
import {
  fetchListItems,
  fetchPackingLocations,
  makeOptimisticReorder,
  makeOptimisticUpdate,
  queryKeys,
  reorderListItems,
  reorderPackingLocations,
  updateListItem,
} from '../lib/queries'
import type { List, ListItemWithGear, PackingLocation } from '../lib/types'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useReorderable } from '../lib/use-reorderable'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import { asButtonRef } from '../lib/dnd'
import RowIconButton from '../components/RowIconButton'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import LocationSection from './LocationSection'
import { usePackingLocationActions } from './use-packing-location-actions'
import {
  isPackingCollisionTarget,
  planPackingItemDragEnd,
} from './packing-dnd'
import ListDocumentToolbar from './ListDocumentToolbar'
import {
  buildContainerMoveExclusions,
  buildPackingTree,
  type PackingTreeLocation,
} from './packing-tree'

function buildSiblingLocationIdsById(
  roots: PackingTreeLocation[],
): Map<string, ReadonlySet<string>> {
  const siblingIdsById = new Map<string, ReadonlySet<string>>()

  function visit(siblings: PackingTreeLocation[]) {
    const siblingIds = new Set(siblings.map((node) => node.location.id))
    for (const node of siblings) {
      siblingIdsById.set(node.location.id, siblingIds)
      visit(node.children)
    }
  }

  visit(roots)
  return siblingIdsById
}

export function deriveOrganizeHiddenReorderItemIds(
  items: ListItemWithGear[],
): Set<string> {
  return new Set(items.filter((item) => item.isWorn).map((item) => item.id))
}

export default function OrganizePackPanel({
  list,
}: {
  list: List
}) {
  const qc = useQueryClient()
  const mobile = useIsBelowLg()
  const [newName, setNewName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<PackingLocation | null>(null)
  const [activePackingItemId, setActivePackingItemId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const {
    items: locations,
    isLoading: locationsLoading,
    isError: locationsError,
    activeItem,
    reorderPending,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
  } = useReorderable<PackingLocation>({
    queryKey: queryKeys.packingLocations(list.id),
    queryFn: () => fetchPackingLocations(list.id),
    mutationFn: (updates) => reorderPackingLocations(list.id, updates),
    dndKind: 'packing-location',
  })

  const { data: items = [], isPending: itemsLoading, isError: itemsError } = useQuery({
    queryKey: queryKeys.listItems(list.id),
    queryFn: () => fetchListItems(list.id),
  })
  const { createLocation, createItemContainer, renameLocation, removeLocation } =
    usePackingLocationActions(list.id, locations)
  const locationCreationPending =
    createLocation.isPending || createItemContainer.isPending

  const moveItem = useMutation({
    mutationFn: ({ itemId, locationId }: { itemId: string; locationId: string | null }) =>
      updateListItem(list.id, itemId, { packingLocationId: locationId }),
    ...makeOptimisticUpdate<
      ListItemWithGear,
      { itemId: string; locationId: string | null }
    >({
      qc,
      queryKey: queryKeys.listItems(list.id),
      id: ({ itemId }) => itemId,
      apply: (item, { locationId }) => ({ ...item, packingLocationId: locationId }),
    }),
  })
  const reorderItems = useMutation({
    mutationFn: (updates: { id: string; sortOrder: number }[]) =>
      reorderListItems(list.id, updates),
    ...makeOptimisticReorder<ListItemWithGear>(qc, queryKeys.listItems(list.id)),
  })
  const itemDragPending =
    moveItem.isPending || reorderItems.isPending || locationCreationPending

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const packingTree = useMemo(
    () => buildPackingTree(items, locations, {
      includeItem: (item) => !item.isWorn,
    }),
    [items, locations],
  )
  const siblingLocationIdsById = useMemo(
    () => buildSiblingLocationIdsById(packingTree.roots),
    [packingTree],
  )
  const packingCollisionDetection = useMemo<CollisionDetection>(() => (args) => closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) =>
      isPackingCollisionTarget(
        String(args.active.id),
        String(container.id),
        siblingLocationIdsById,
      ),
    ),
  }), [siblingLocationIdsById])
  const containerMoveExclusions = useMemo(
    () => buildContainerMoveExclusions(packingTree),
    [packingTree],
  )
  const realLocations = useMemo(
    () => locations.filter((location) => !location.id.startsWith('temp-')),
    [locations],
  )
  const realLocationIds = useMemo(
    () => new Set(realLocations.map((location) => location.id)),
    [realLocations],
  )
  const containerItemIds = useMemo(
    () => new Set(realLocations.flatMap((location) =>
      location.containerListItemId === null ? [] : [location.containerListItemId],
    )),
    [realLocations],
  )
  const containerItemIdByLocation = useMemo(
    () => new Map(realLocations.flatMap((location) =>
      location.containerListItemId === null
        ? []
        : [[location.id, location.containerListItemId] as const],
    )),
    [realLocations],
  )
  const hiddenReorderItemIds = useMemo(
    () => deriveOrganizeHiddenReorderItemIds(items),
    [items],
  )
  const wornItems = useMemo(
    () => items.filter((item) => item.isWorn),
    [items],
  )
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const activePackingItem = activePackingItemId
    ? itemsById.get(activePackingItemId) ?? null
    : null

  function requestMove(itemId: string, locationId: string | null) {
    const item = itemsById.get(itemId)
    const destination = locationId === null
      ? 'Unassigned'
      : realLocations.find((location) => location.id === locationId)?.name
    if (item && destination) setAnnouncement(`Moving ${item.gearItem.name} to ${destination}.`)
    moveItem.mutate({ itemId, locationId }, {
      onSuccess: () => {
        if (item && destination) setAnnouncement(`Moved ${item.gearItem.name} to ${destination}.`)
      },
      onError: () => {
        if (item) setAnnouncement(`Could not move ${item.gearItem.name}.`)
      },
    })
  }

  function onDragStart(event: DragStartEvent) {
    handleDragStart(event)
    const parsed = parseDnDId(String(event.active.id))
    if (parsed?.kind !== 'packing-item') return
    setActivePackingItemId(parsed.id)
    const item = itemsById.get(parsed.id)
    if (item) {
      setAnnouncement(
        `Dragging ${item.gearItem.name}. Reorder it here or choose another packing location.`,
      )
    }
  }

  function onDragCancel() {
    handleDragCancel()
    setActivePackingItemId(null)
    setAnnouncement('Move cancelled.')
  }

  function onDragEnd(event: DragEndEvent) {
    handleDragEnd(event)
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : undefined
    const activeParsed = parseDnDId(activeId)
    const draggedItem = activeParsed?.kind === 'packing-item'
      ? itemsById.get(activeParsed.id)
      : undefined
    const plan = planPackingItemDragEnd(
      activeId,
      overId,
      items,
      realLocationIds,
      containerItemIdByLocation,
      containerMoveExclusions,
      hiddenReorderItemIds,
    )
    setActivePackingItemId(null)
    if (plan?.kind === 'reorder') {
      if (draggedItem) setAnnouncement(`Reordering ${draggedItem.gearItem.name}.`)
      reorderItems.mutate(plan.updates, {
        onSuccess: () => {
          if (draggedItem) setAnnouncement(`Reordered ${draggedItem.gearItem.name}.`)
        },
        onError: () => {
          if (draggedItem) setAnnouncement(`Could not reorder ${draggedItem.gearItem.name}.`)
        },
      })
      return
    }
    if (!plan) {
      if (activeParsed?.kind === 'packing-item') {
        setAnnouncement('Move cancelled.')
      }
      return
    }
    requestMove(plan.itemId, plan.locationId)
  }

  function submitLocation(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name || name.length > 60 || locations.length >= 30 || locationCreationPending) return
    createLocation.mutate(name)
    setNewName('')
  }

  const busy = locationsLoading || itemsLoading
  const failed = (locationsError && locations.length === 0) || itemsError

  function renderLocationNode(node: PackingTreeLocation): ReactNode {
    const location = node.location
    const nested = node.children.length > 0 ? (
      <SortableContext
        items={node.children.map((child) =>
          makeDnDId('packing-location', child.location.id),
        )}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2 border-l border-gray-200 bg-gray-50/40 p-2 pl-3">
          {node.children.map((child) => renderLocationNode(child))}
        </div>
      </SortableContext>
    ) : undefined
    const sharedProps = {
      location,
      items: node.items,
      locations: realLocations,
      mobile,
      movePending: itemDragPending,
      containerCreationDisabled: locations.length >= 30 || locationCreationPending,
      containerItemIds,
      excludedLocationIds: node.containerItem
        ? containerMoveExclusions.get(node.containerItem.id)
        : undefined,
      itemCount: node.items.length + node.children.length,
      onRename: (name: string) => renameLocation.mutate({ id: location.id, name }),
      onDelete: () => setDeleteTarget(location),
      onMove: requestMove,
      onUseAsContainer: (item: ListItemWithGear) => createItemContainer.mutate({
        itemId: item.id,
        name: item.gearItem.name,
      }),
      children: nested,
    }

    return node.containerItem ? (
      <SortableItemContainerSection
        key={location.id}
        {...sharedProps}
        containerItem={node.containerItem}
        reorderPending={reorderPending || locationCreationPending}
      />
    ) : (
      <SortableLocationSection
        key={location.id}
        {...sharedProps}
        reorderPending={reorderPending || locationCreationPending}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-20 lg:pb-4">
      <ListDocumentToolbar
        list={list}
        mode="organize"
      />

      <form onSubmit={submitLocation} noValidate className="flex gap-2">
        <label className="sr-only" htmlFor="new-packing-location">New packing location</label>
        <input
          id="new-packing-location"
          value={newName}
          maxLength={60}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Add a location, e.g. Main pack"
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        />
        <button
          type="submit"
          disabled={!newName.trim() || newName.trim().length > 60 || locations.length >= 30 || locationCreationPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={15} /> Add
        </button>
      </form>
      {locations.length >= 30 ? (
        <p className="text-sm text-amber-800">This list has the maximum of 30 packing locations.</p>
      ) : null}

      {!busy && !failed && locations.length === 0 ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h2 className="text-sm font-semibold text-blue-950">Start with where your gear lives</h2>
          <p className="mt-1 text-sm text-blue-900">
            Add one or more pack locations. Your checklist will switch from gear categories to these locations.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {['Main pack', 'Top lid', 'Hip belt pockets'].map((name) => (
              <button
                key={name}
                type="button"
                disabled={locationCreationPending}
                onClick={() => createLocation.mutate(name)}
                className="rounded-md border border-blue-300 bg-white px-2.5 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {failed ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Couldn&apos;t load the pack organizer. Check your connection and try again.
        </p>
      ) : busy ? (
        <p className="text-sm text-gray-500">Loading pack organizer...</p>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={packingCollisionDetection}
            onDragStart={onDragStart}
            onDragCancel={onDragCancel}
            onDragEnd={onDragEnd}
          >
            <div className="space-y-3">
              <DroppableUnassignedSection
                location={null}
                items={packingTree.unassignedItems}
                locations={realLocations}
                mobile={mobile}
                movePending={itemDragPending}
                containerCreationDisabled={locations.length >= 30 || locationCreationPending}
                containerItemIds={containerItemIds}
                onMove={requestMove}
                onUseAsContainer={(item) => createItemContainer.mutate({
                  itemId: item.id,
                  name: item.gearItem.name,
                })}
              />
              <SortableContext
                items={packingTree.roots.map((node) =>
                  makeDnDId('packing-location', node.location.id),
                )}
                strategy={verticalListSortingStrategy}
              >
                {packingTree.roots.map((node) => renderLocationNode(node))}
              </SortableContext>
            </div>
            <DragOverlay dropAnimation={null}>
              {activePackingItem ? (
                <div className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm shadow-lg">
                  {activePackingItem.gearItem.name}
                </div>
              ) : activeItem ? (
                <div className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold shadow-lg">
                  {activeItem.name}
                </div>
              ) : null}
            </DragOverlay>
            <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
          </DndContext>
          <OrganizeWornSection items={wornItems} />
        </>
      )}

      {deleteTarget ? (
        <ConfirmDialog
          title={deleteTarget.containerListItemId === null
            ? 'Delete packing location'
            : 'Stop using item as container'}
          message={deleteTarget.containerListItemId === null
            ? `Delete "${deleteTarget.name}"? Its items will move to Unassigned.`
            : `Stop using "${deleteTarget.name}" as a container? Its items will move to Unassigned.`}
          confirmLabel={deleteTarget.containerListItemId === null ? 'Delete' : 'Stop using'}
          dangerous={deleteTarget.containerListItemId === null}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget
            setDeleteTarget(null)
            removeLocation.mutate(target.id)
          }}
        />
      ) : null}
    </div>
  )
}

function OrganizeWornSection({ items }: { items: ListItemWithGear[] }) {
  if (items.length === 0) return null

  return (
    <section className={FLAT_TABLE_SURFACE} aria-label="Worn">
      <div className="flex min-h-10 items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">Worn</h2>
        <span className={FLAT_TABLE_META_TEXT}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className={`${FLAT_TABLE_ROW} ${FLAT_TABLE_ROW_PADDING} ${FLAT_TABLE_BODY_TEXT} gap-2 bg-white`}
        >
          <span className="min-w-0 flex-1 truncate text-gray-900">{item.gearItem.name}</span>
          {item.quantity > 1 ? <span className="text-gray-500">x{item.quantity}</span> : null}
        </div>
      ))}
    </section>
  )
}

function DroppableUnassignedSection(props: React.ComponentProps<typeof LocationSection>) {
  const { setNodeRef, isOver } = useDroppable({
    id: makeDnDId('packing-location', 'unassigned'),
  })
  return (
    <div ref={setNodeRef} className={isOver ? 'rounded-lg ring-2 ring-blue-400' : ''}>
      <LocationSection {...props} />
    </div>
  )
}

function SortableItemContainerSection({
  location,
  containerItem,
  movePending,
  reorderPending,
  ...props
}: Omit<React.ComponentProps<typeof LocationSection>, 'location' | 'containerItem' | 'dragHandle' | 'nestHandle'> & {
  location: PackingLocation
  containerItem: ListItemWithGear
  movePending: boolean
  reorderPending: boolean
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
  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    setSortableNodeRef(node)
    setNestingNodeRef(node)
  }, [setNestingNodeRef, setSortableNodeRef])

  return (
    <div
      ref={setNodeRef}
      className={isOver ? 'rounded-lg ring-2 ring-blue-400' : ''}
      style={{
        transform: CSS.Transform.toString(isNesting ? nestingTransform : reorderTransform),
        transition: isNesting ? undefined : transition,
        opacity: isNesting || isReordering ? 0.35 : 1,
      }}
    >
      <LocationSection
        {...props}
        location={location}
        containerItem={containerItem}
        movePending={movePending}
        dragHandle={(
          <RowIconButton
            touchSafe
            ref={asButtonRef(setReorderActivatorNodeRef)}
            {...reorderListeners}
            {...reorderAttributes}
            disabled={reorderPending}
            variant="dragHandle"
            ariaLabel={`Reorder ${containerItem.gearItem.name}`}
            icon={<GripVertical size={14} />}
          />
        )}
        nestHandle={(
          <RowIconButton
            touchSafe
            ref={asButtonRef(setNestingActivatorNodeRef)}
            {...nestingListeners}
            {...nestingAttributes}
            disabled={movePending}
            ariaLabel={`Move ${containerItem.gearItem.name} into another container`}
            title="Move into another container"
            icon={<PackageOpen size={14} />}
          />
        )}
      />
    </div>
  )
}

function SortableLocationSection({
  location,
  reorderPending,
  ...props
}: Omit<React.ComponentProps<typeof LocationSection>, 'location' | 'dragHandle'> & {
  location: PackingLocation
  reorderPending: boolean
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
  } = useSortable({
    id: makeDnDId('packing-location', location.id),
    disabled: reorderPending || location.id.startsWith('temp-'),
  })

  return (
    <div
      ref={setNodeRef}
      className={isOver ? 'rounded-lg ring-2 ring-blue-400' : ''}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <LocationSection
        {...props}
        location={location}
        dragHandle={(
          <RowIconButton
            touchSafe
            ref={asButtonRef(setActivatorNodeRef)}
            {...listeners}
            {...attributes}
            variant="dragHandle"
            ariaLabel={`Drag ${location.name} to reorder`}
            icon={<GripVertical size={14} />}
          />
        )}
      />
    </div>
  )
}
