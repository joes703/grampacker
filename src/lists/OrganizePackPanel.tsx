import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { GripVertical, Plus } from 'lucide-react'
import {
  fetchListItems,
  fetchPackingLocations,
  makeOptimisticUpdate,
  queryKeys,
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
import LocationSection from './LocationSection'
import { usePackingLocationActions } from './use-packing-location-actions'
import { buildOrganizeGroups } from './organize-groups'
import { isPackingCollisionTarget, planPackingItemDrop } from './packing-dnd'
import ListDocumentToolbar from './ListDocumentToolbar'

const packingCollisionDetection: CollisionDetection = (args) => closestCenter({
  ...args,
  droppableContainers: args.droppableContainers.filter((container) =>
    isPackingCollisionTarget(String(args.active.id), String(container.id)),
  ),
})

export default function OrganizePackPanel({
  list,
  onTogglePackMode,
  onToggleOrganizeMode,
}: {
  list: List
  onTogglePackMode: () => void
  onToggleOrganizeMode: () => void
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

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const grouped = buildOrganizeGroups(items, locations)
  const assignedGroups = grouped.filter((group) => group.location !== null)
  const unassignedItems = grouped.find((group) => group.location === null)?.items ?? []
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
    if (item) setAnnouncement(`Moving ${item.gearItem.name}. Choose a packing location.`)
  }

  function onDragCancel() {
    handleDragCancel()
    setActivePackingItemId(null)
    setAnnouncement('Move cancelled.')
  }

  function onDragEnd(event: DragEndEvent) {
    handleDragEnd(event)
    const plan = planPackingItemDrop(
      String(event.active.id),
      event.over ? String(event.over.id) : undefined,
      items,
      realLocationIds,
      containerItemIdByLocation,
    )
    setActivePackingItemId(null)
    if (!plan) {
      if (parseDnDId(String(event.active.id))?.kind === 'packing-item') {
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-20 lg:pb-4">
      <ListDocumentToolbar
        list={list}
        mode="organize"
        onTogglePackMode={onTogglePackMode}
        onToggleOrganizeMode={onToggleOrganizeMode}
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
              items={unassignedItems}
              locations={realLocations}
              mobile={mobile}
              movePending={moveItem.isPending || locationCreationPending}
              containerCreationDisabled={locations.length >= 30 || locationCreationPending}
              containerItemIds={containerItemIds}
              onMove={requestMove}
              onUseAsContainer={(item) => createItemContainer.mutate({
                itemId: item.id,
                name: item.gearItem.name,
              })}
            />
            <SortableContext
              items={locations.map((location) => makeDnDId('packing-location', location.id))}
              strategy={verticalListSortingStrategy}
            >
              {assignedGroups.map((group) => {
                const location = group.location
                if (!location) return null
                return (
                  <SortableLocationSection
                    key={location.id}
                    location={location}
                    items={group.items}
                    locations={realLocations}
                    mobile={mobile}
                    movePending={moveItem.isPending || locationCreationPending}
                    containerCreationDisabled={locations.length >= 30 || locationCreationPending}
                    containerItemIds={containerItemIds}
                    reorderPending={reorderPending || locationCreationPending}
                    onRename={(name) => renameLocation.mutate({ id: location.id, name })}
                    onDelete={() => setDeleteTarget(location)}
                    onMove={requestMove}
                    onUseAsContainer={(item) => createItemContainer.mutate({
                      itemId: item.id,
                      name: item.gearItem.name,
                    })}
                  />
                )
              })}
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
