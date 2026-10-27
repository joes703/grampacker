import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import type { StableListItemGroup } from '../lib/use-grouped-list-items'
import { PACKING_LOCATION_CAP } from '../lib/caps'
import type { FoodItemResponse } from '../../shared/food'
import RowIconButton from '../components/RowIconButton'
import PackSection from './PackSection'
import type { SharedPackSectionProps } from './section-parts'
import EmptyListCell from './EmptyListCell'
import ListDndArea from './ListDndArea'
import MoveToLocationMenu from './MoveToLocationMenu'
import PackLocationControls from './PackLocationControls'
import PackingLocationTree from './PackingLocationTree'
import PackingProgress from './PackingProgress'
import { DroppableUnassignedSection } from './SortablePackSection'
import type { PackingTree } from './packing-tree'
import { EMPTY_FOOD_ITEMS, type useListDnd } from './use-list-dnd'
import type { usePackingLocationActions } from './use-packing-location-actions'

const EMPTY_LIST_ITEMS: ListItemWithGear[] = []

type Props = {
  listItems: ListItemWithGear[]
  grouped: StableListItemGroup[]
  groupingKind: 'category' | 'location'
  // Null while the list has no packing locations: Pack then groups by
  // category.
  packingTree: PackingTree | null
  wornItems: ListItemWithGear[]
  groupProps: SharedPackSectionProps
  dnd: ReturnType<typeof useListDnd>
  listItemsById: ReadonlyMap<string, ListItemWithGear>
  weightUnit: WeightUnit
  isBelowLg: boolean
  isBelowXl: boolean
  filters: {
    showUnpackedOnly: boolean
    onToggleShowUnpackedOnly: () => void
    showUnreadyOnly: boolean
    onToggleShowUnreadyOnly: () => void
  }
  onResetPacked: () => void
  onResetReady: () => void
  locations: {
    items: PackingLocation[]
    // False while the query is pending or failed its first load: an empty
    // array then is a guess, not "no locations".
    resolved: boolean
    loadFailed: boolean
    onRetry: () => void
    active: PackingLocation | null
    reorderPending: boolean
    creationPending: boolean
  }
  locationActions: ReturnType<typeof usePackingLocationActions>
  onDeleteLocation: (location: PackingLocation) => void
  onEditItem: (gearId: string) => void
  onRemoveItem: (item: ListItemWithGear) => void
  onOpenDrawer: () => void
}

// The Pack view's document: packing progress, the packing-location controls,
// the sections (by location, or by category until the list has a location),
// and the Worn pile.
export default function PackDocument({
  listItems,
  grouped,
  groupingKind,
  packingTree,
  wornItems,
  groupProps,
  dnd,
  listItemsById,
  weightUnit,
  isBelowLg,
  isBelowXl,
  filters,
  onResetPacked,
  onResetReady,
  locations,
  locationActions: { createLocation, createItemContainer, renameLocation },
  onDeleteLocation,
  onEditItem,
  onRemoveItem,
  onOpenDrawer,
}: Props) {
  // Which section is renaming (by id, so switching sections cannot leak a
  // half-typed name), and the new-location draft.
  const [renamingLocationId, setRenamingLocationId] = useState<string | null>(null)
  const [newLocationName, setNewLocationName] = useState('')

  const { packFoodItems, itemDragPending } = dnd
  const total = listItems.length + packFoodItems.length

  // What every move menu here shares. The menu is the keyboard- and
  // touch-reachable equivalent of dragging a row between sections, and the
  // ONLY route to those actions for anyone not using a pointer.
  const menuBase = {
    locations: dnd.realLocations,
    mobile: isBelowLg,
    disabled: itemDragPending,
    locationsUnavailable: !locations.resolved,
  }
  const containerCreationDisabled =
    locations.items.length >= PACKING_LOCATION_CAP || locations.creationPending

  // A plain function, not a useCallback: its inputs change on every packing
  // write, so a memo could never hit.
  //
  // KNOWN TRADE: a fresh function defeats PackSection's React.memo for pack
  // sections, so a checkbox tick re-renders every section. PROFILED AND
  // ACCEPTED (2026-10, jsdom at 1280px): a tick at the worst case the caps
  // allow (300 items across 30 locations) commits in ~140ms jsdom, roughly
  // 15-45ms in a browser. A stable menu alone would not restore the memo
  // hits: every list-items write rebuilds packingTree, which hands every
  // section a fresh `items` array. Re-profile before adding cost to this path
  // (more per-row work, higher caps).
  const renderRowAction = (item: ListItemWithGear) => (
    <MoveToLocationMenu
      {...menuBase}
      itemId={item.id}
      itemName={item.gearItem.name}
      currentLocationId={item.packingLocationId}
      containerCreationDisabled={containerCreationDisabled}
      isContainer={false}
      excludedLocationIds={dnd.containerMoveExclusions.get(item.id)}
      onMove={(locationId) => dnd.requestMove(item.id, locationId)}
      // Drops the row from the list and leaves the gear item in the library.
      // onRemoveItem owns the container-backing case, which needs a confirm.
      onRemoveFromList={() => onRemoveItem(item)}
      onEdit={() => onEditItem(item.gearItem.id)}
      onUseAsContainer={() => createItemContainer.mutate({ itemId: item.id, name: item.gearItem.name })}
    />
  )

  // The food row's menu: move between bags only. Food cannot back a
  // container, and food membership is authored in the Food view.
  const renderFoodRowAction = (food: FoodItemResponse) => (
    <MoveToLocationMenu
      {...menuBase}
      itemId={food.id}
      itemName={food.name}
      currentLocationId={food.packingLocationId}
      containerCreationDisabled
      isContainer={false}
      onMove={(locationId) => dnd.requestMoveFood(food.id, locationId)}
    />
  )

  // A container's own row lives in its section header, so the ordinary row
  // menu never renders for it; this is its menu.
  const renderContainerAction = (containerItem: ListItemWithGear, location: PackingLocation) => (
    <MoveToLocationMenu
      {...menuBase}
      itemId={containerItem.id}
      itemName={containerItem.gearItem.name}
      currentLocationId={containerItem.packingLocationId}
      containerCreationDisabled={containerCreationDisabled}
      isContainer
      excludedLocationIds={dnd.containerMoveExclusions.get(containerItem.id)}
      onMove={(locationId) => dnd.requestMove(containerItem.id, locationId)}
      // Removing it takes the location with it (container_list_item_id
      // cascades) and drops its contents to Unassigned; onRemoveItem routes
      // this case through a confirm that names both.
      onRemoveFromList={() => onRemoveItem(containerItem)}
      onEdit={() => onEditItem(containerItem.gearItem.id)}
      onStopUsingAsContainer={() => onDeleteLocation(location)}
    />
  )

  // Worn rows sit outside the packing tree: they are not in a bag, so move,
  // reorder and containerize do not apply. Edit and removal do, and the Worn
  // section has no packing menu to hang them on, so they are direct buttons.
  const renderWornRowAction = (item: ListItemWithGear) => (
    <>
      <RowIconButton
        touchSafe
        onClick={() => onEditItem(item.gearItem.id)}
        ariaLabel={`Edit ${item.gearItem.name}`}
        title="Edit item"
        icon={<Pencil size={14} />}
      />
      <RowIconButton
        touchSafe
        disabled={itemDragPending}
        onClick={() => onRemoveItem(item)}
        ariaLabel={`Remove ${item.gearItem.name} from list`}
        title="Remove from list"
        icon={<Trash2 size={14} />}
      />
    </>
  )

  return (
    <>
      {total > 0 && (
        <div className="print:hidden">
          {/* The pack is gear plus food: a progress bar that ignored food
              would read 100% with the food still on the counter. */}
          <PackingProgress
            total={total}
            packed={
              listItems.filter((i) => i.isPacked).length +
              packFoodItems.filter((f) => f.isPacked).length
            }
            onReset={onResetPacked}
            showUnpackedOnly={filters.showUnpackedOnly}
            onToggleShowUnpackedOnly={filters.onToggleShowUnpackedOnly}
            showUnreadyOnly={filters.showUnreadyOnly}
            onToggleShowUnreadyOnly={filters.onToggleShowUnreadyOnly}
            readyChecks={{
              ready:
                listItems.filter((i) => i.isReady).length +
                packFoodItems.filter((f) => f.isReady).length,
              total,
              onResetReady,
            }}
          />
        </div>
      )}

      {/* The way back to the gear library for the ONE width band that has no
          other path to it: lg to xl. Below lg the bottom action bar carries
          Add; at xl and up the picker aside is always on screen. A JS gate
          rather than `xl:hidden`, so the button is absent from the DOM where
          it does not apply. */}
      {!isBelowLg && isBelowXl && (
        <div className="print:hidden flex justify-end">
          <button
            type="button"
            onClick={onOpenDrawer}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus size={15} /> Add gear
          </button>
        </div>
      )}

      <PackLocationControls
        locations={locations.items}
        // The empty-state nudge must not fire on a guess: an empty array is
        // also what a pending or failed query looks like, and the starter
        // buttons would then create duplicates. A stale cached [] during a
        // background refetch can still show it; the outcome there is one
        // extra, visible, deletable location.
        locationsResolved={locations.resolved}
        loadFailed={locations.loadFailed}
        onRetry={locations.onRetry}
        creationPending={locations.creationPending}
        draft={newLocationName}
        onDraftChange={setNewLocationName}
        onCreate={(name) => {
          createLocation.mutate(name)
          setNewLocationName('')
        }}
      />

      {total === 0 ? (
        <div className="flex flex-col gap-3">
          <EmptyListCell onMobileAdd={onOpenDrawer} />
        </div>
      ) : (
        // Paper gets two columns: a checklist row is narrow, so one column
        // wasted half of every sheet. Rows and section headers refuse to
        // split from what follows them (PRINT_KEEP_TOGETHER /
        // PRINT_KEEP_WITH_NEXT). Block layout drops the flex gap, so each
        // card carries its own margin there.
        <div
          data-testid="pack-print-columns"
          className="flex flex-col gap-3 print:block print:columns-2 print:gap-4 print:*:mb-2"
        >
          <ListDndArea
            dnd={dnd}
            groupingKind={groupingKind}
            listItemsById={listItemsById}
            activeLocation={locations.active}
            weightUnit={weightUnit}
            isBelowLg={isBelowLg}
          >
            {groupingKind === 'location' && packingTree ? (
              <>
                {/* Unassigned is a drop target but not sortable: it is not a
                    location row and has no sortOrder. Dragging a row here
                    takes it back out of a container. */}
                <DroppableUnassignedSection>
                  <PackSection
                    name="Unassigned"
                    // An empty Unassigned bucket is what a finished,
                    // organized list looks like.
                    emptyLabel="Everything has a location."
                    items={packingTree.unassignedItems}
                    {...groupProps}
                    renderRowAction={renderRowAction}
                    packFoodRows={dnd.foodByLocation.get(null) ?? EMPTY_FOOD_ITEMS}
                    renderFoodRowAction={renderFoodRowAction}
                    reorderPending={dnd.anyItemReorderPending}
                  />
                </DroppableUnassignedSection>
                <PackingLocationTree
                  roots={packingTree.roots}
                  groupProps={groupProps}
                  renderRowAction={renderRowAction}
                  renderFoodRowAction={renderFoodRowAction}
                  renderContainerAction={renderContainerAction}
                  foodByLocation={dnd.foodByLocation}
                  itemReorderPending={dnd.anyItemReorderPending}
                  locationReorderPending={locations.reorderPending || locations.creationPending}
                  movePending={itemDragPending}
                  renamingLocationId={renamingLocationId}
                  onStartRename={setRenamingLocationId}
                  onCancelRename={() => setRenamingLocationId(null)}
                  onRename={(id, name) => renameLocation.mutate({ id, name })}
                  onDeleteLocation={onDeleteLocation}
                />
              </>
            ) : (
              <>
                {/* Until the list has its first packing location, Pack groups
                    by category. The move menu still renders, so the feature
                    is there on a new list's first visit. A category can be
                    empty here because all its items are worn. */}
                {grouped.map((group) => (
                  <PackSection
                    key={group.group?.id ?? '__uncategorized__'}
                    name={group.group?.name ?? 'Uncategorized'}
                    emptyLabel="No items in this category."
                    items={group.items}
                    {...groupProps}
                    renderRowAction={renderRowAction}
                    reorderPending={dnd.anyItemReorderPending}
                  />
                ))}
                {/* Food gets its own section so the checklist still covers
                    the whole pack. Rows check off and reorder among
                    themselves; bag assignment starts with the first
                    location. */}
                {packFoodItems.length > 0 && (
                  <PackSection
                    name="Food"
                    items={EMPTY_LIST_ITEMS}
                    {...groupProps}
                    packFoodRows={packFoodItems}
                    renderFoodRowAction={renderFoodRowAction}
                    reorderPending={dnd.anyItemReorderPending}
                  />
                )}
              </>
            )}
          </ListDndArea>

          {/* Worn gear is a separate pile when packing: you lay it out to
              wear, you do not pack it. Outside the DndContext - it is not a
              reorder target. Items are in document order. */}
          {wornItems.length > 0 && (
            <PackSection
              {...groupProps}
              name="Worn"
              items={wornItems}
              wornSection
              renderRows={undefined}
              renderRowAction={renderWornRowAction}
            />
          )}
        </div>
      )}
    </>
  )
}
