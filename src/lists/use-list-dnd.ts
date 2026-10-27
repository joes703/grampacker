import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  closestCenter,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  queryKeys,
  reorderListItems,
  reorderPackListItems,
  makeOptimisticReorder,
} from '../lib/queries'
import { makeOptimisticUnionPackReorder } from '../lib/queries/optimistic'
import { mutationKeys } from '../lib/queries/keys'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import type { FoodItemResponse, ListFoodResponse } from '../../shared/food'
import { parseDnDId } from '../lib/dnd-ids'
import type { ListDetailMode } from './list-detail-mode'
import {
  buildContainerMoveExclusions,
  buildSiblingLocationIdsById,
  derivePackReorderExclusions,
  type PackingTree,
} from './packing-tree'
import { isPackingCollisionTarget, planPackingRowDragEnd } from './packing-dnd'
import { deriveFilteredItemIds, planListItemReorder } from './list-reorder-plan'
import { passesPackFilters } from './section-rows'
import {
  nextUnionPackRankFor,
  packRowName,
  type UnionRankUpdates,
} from './pack-rows'
import { usePlacement } from './placement-context'
import { planPlacementWithinLocation } from './placement-plan'
import { useDragSensors } from '../lib/use-drag-sensors'

// One shared empty array for every "no food rows here" case: Edit mode, where
// Pack's food derivations are switched off, and a bag that holds no food. It
// reaches CategoryGroup as a prop, and CategoryGroup is memoized - a fresh []
// literal would be a new identity every render and defeat that memo.
export const EMPTY_FOOD_ITEMS: FoodItemResponse[] = []
// Edit mode has no pack filters, so nothing is ever hidden there. Module-level
// so the reorder planner isn't handed a fresh Set on every drag tick.
const EMPTY_HIDDEN_ITEM_IDS: ReadonlySet<string> = new Set<string>()
const EMPTY_EXCLUSIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map()

// The callbacks `narrated` hands every write it narrates.
type NarrationCallbacks = { onSuccess: () => void; onError: () => void }

// Everything that turns a drag, a drop or a click-to-place on the list
// detail page into a write and a screen-reader narration: the sensors, the
// two reorder mutations, the move requests, the placement mode's plan
// callback and lifecycle effects, the collision filter, and the packing
// derivations those consume. It renders nothing - the page still renders
// DndContext, DragOverlay and the aria-live region from what this returns.
//
// The hook does NOT subscribe to the queries itself: the page already owns
// those subscriptions and their derived maps, and subscribing twice would
// create two sources of truth for one render.
export function useListDnd({
  listId,
  mode,
  groupingKind,
  listItems,
  listItemsById,
  listFoodItems,
  packingLocations,
  packingTree,
  packingLocationsResolved,
  showUnpackedOnly,
  showUnreadyOnly,
  locationDrag,
  moveItem,
  moveFood,
  structuralWritePending,
}: {
  listId: string
  mode: ListDetailMode
  groupingKind: 'category' | 'location'
  listItems: ListItemWithGear[]
  listItemsById: ReadonlyMap<string, ListItemWithGear>
  listFoodItems: FoodItemResponse[]
  packingLocations: PackingLocation[]
  packingTree: PackingTree | null
  packingLocationsResolved: boolean
  showUnpackedOnly: boolean
  showUnreadyOnly: boolean
  // useReorderable's self-gating location-drag handlers, so one DndContext
  // serves item and section drags without cross-fire.
  locationDrag: {
    onDragStart: (e: DragStartEvent) => void
    onDragEnd: (e: DragEndEvent) => void
    onDragCancel: () => void
  }
  // The move mutations stay owned by useListItemActions / useListFood
  // (their optimistic cache wiring lives there); this hook only calls them.
  moveItem: {
    isPending: boolean
    mutate: (
      vars: { itemId: string; locationId: string | null; nextPackSortOrder: number },
      callbacks?: NarrationCallbacks,
    ) => void
  }
  moveFood: {
    isPending: boolean
    mutate: (
      vars: { foodId: string; locationId: string | null; nextPackSortOrder: number },
      callbacks?: NarrationCallbacks,
    ) => void
  }
  // Page-level composite (location creation or an optimistic bag delete in
  // flight): a pending optimistic bag delete makes cached locations lie
  // about what is rendered, so structural writes wait for it to settle
  // (round-7).
  structuralWritePending: boolean
}) {
  const qc = useQueryClient()

  // DOCUMENT order. List view only.
  const reorderItemsMut = useMutation({
    mutationKey: mutationKeys.reorderListItems(listId),
    mutationFn: (updates: { id: string; sortOrder: number }[]) =>
      reorderListItems(listId, updates),
    ...makeOptimisticReorder<ListItemWithGear>(qc, queryKeys.listItems(listId)),
  })

  // PACK order. Every reorder that happens in Pack view - drag and
  // click-to-place alike - goes here instead, which is the whole point of the
  // split: arranging your pack no longer rewrites the list you wrote or the
  // share link you sent someone.
  const reorderPackItemsMut = useMutation({
    mutationKey: mutationKeys.reorderPackItems(listId),
    mutationFn: (updates: UnionRankUpdates) =>
      reorderPackListItems(listId, updates),
    // The union helper spans both caches (0022: one drag can permute gear and
    // food ranks together, and the server applies both halves in one batch).
    ...makeOptimisticUnionPackReorder<ListItemWithGear, ListFoodResponse>(
      qc,
      queryKeys.listItems(listId),
      queryKeys.listFood(listId),
    ),
  })

  // Every reorder guard below must watch BOTH mutations. Pack view fires
  // reorderPackItemsMut, so a guard reading only reorderItemsMut.isPending is
  // permanently false in exactly the mode it was written for - a second pack
  // drag could start while the first was still in flight.
  const anyItemReorderPending =
    reorderItemsMut.isPending || reorderPackItemsMut.isPending
  const itemDragPending =
    moveItem.isPending ||
    moveFood.isPending ||
    anyItemReorderPending ||
    structuralWritePending

  // Split mouse vs touch so each gets the activation that fits its input.
  // MouseSensor: 5px drag threshold from the hover grip handle (desktop).
  // TouchSensor: a short press-and-hold (delay) before a drag starts, so a
  // quick tap still opens the edit modal and a vertical swipe still scrolls
  // the page — only a deliberate hold begins a reorder. dnd-kit's own
  // guidance is to use MouseSensor + TouchSensor (not PointerSensor) when
  // mouse and touch need different activation. PointerSensor's flat 5px
  // distance was hijacking touch scroll, which is what broke mobile reorder.
  const sensors = useDragSensors()

  // Active drag id. Three kinds share the page's one DndContext:
  //   item:             a row in category grouping (reorder within category)
  //   packing-item:     a row in location grouping (reorder OR move between
  //                     locations), and the backing item of a container
  //   packing-location: a section (reorder among siblings)
  // The page's DragOverlay branches on the parsed kind.
  const [activeId, setActiveId] = useState<string | null>(null)
  // Screen-reader narration for packing drags. Pointer users see the row
  // move; without this, a keyboard user gets no confirmation that a drop
  // changed anything.
  const [announcement, setAnnouncement] = useState('')

  // The narration trio every packing write follows: say what is starting,
  // then say it landed or that it could not. One owner so the four sites
  // (gear move, food move, click-to-place, pack reorder) cannot drift.
  // An undefined string skips that announcement without skipping the write -
  // the guards differ on purpose: starting and landing name the destination,
  // so they need one; the failure names only the row.
  function narrated(opts: {
    doing?: string
    done?: string
    failed?: string
    run: (callbacks: NarrationCallbacks) => void
  }) {
    if (opts.doing) setAnnouncement(opts.doing)
    opts.run({
      onSuccess: () => {
        if (opts.done) setAnnouncement(opts.done)
      },
      onError: () => {
        if (opts.failed) setAnnouncement(opts.failed)
      },
    })
  }

  // ── Packing drag derivations ───────────────────────────────────────────────
  // All lifted from the retired OrganizePackPanel. Read by handleDragEnd and
  // the collision filter, both of which run after commit, so declaring them
  // ahead of the handlers that read them is a readability choice, not a
  // correctness one.
  //
  // Deliberately NOT hand-memoized, unlike most derived values on this page.
  //
  // These form a dependency chain rooted in useReorderable's items array,
  // which the compiler analysis in eslint-plugin-react-hooks cannot prove is
  // unmutated downstream - so a useMemo over any of them fails
  // react-hooks/preserve-manual-memoization and lint (the real gate) goes red.
  //
  // Be precise about what that costs, because the obvious reading is wrong:
  // this repo runs the compiler's LINT rules but not its transform (plain
  // `react()` in vite.client.config.ts, no babel-plugin-react-compiler in
  // package.json). So nothing memoizes these for us - they genuinely
  // recompute every render. That is affordable on its own terms: a handful of
  // linear passes over at most 30 locations and 300 items, well under a
  // millisecond. What it does cost is memo stability downstream; see
  // renderPackRowAction in ListDetailPage for the part that actually matters.
  //
  // The expensive derivations (packingTree, weightBreakdown) keep their
  // explicit memos in the page - the rule accepts those, because their
  // inputs are query data the analysis can follow.

  // temp- ids are optimistic rows the server has not confirmed. They are not
  // valid drop destinations: a move would name a location that does not exist.
  const realLocations = packingLocations.filter(
    (location) => !location.id.startsWith('temp-'),
  )
  const realLocationIds = new Set(realLocations.map((location) => location.id))
  // Confirmed locations only: this answers a DESTINATION question (a container
  // cannot be dropped into its own bag), and a temp- bag is never a valid
  // destination. The planner also folds these ids into its reorder exclusions,
  // but that is a subset of packingReorderExclusions below, which covers
  // pending containers too.
  const containerItemIdByLocation = new Map(realLocations.flatMap((location) =>
    location.containerListItemId === null
      ? []
      : [[location.id, location.containerListItemId] as const],
  ))
  const containerMoveExclusions = packingTree
    ? buildContainerMoveExclusions(packingTree)
    : EMPTY_EXCLUSIONS
  const siblingLocationIdsById = buildSiblingLocationIdsById(packingTree?.roots ?? [])
  // Rows filtered out of the rendered list by the pack filters.
  const packFilteredItemIds = mode === 'pack'
    ? deriveFilteredItemIds(listItems, { showUnpackedOnly, showUnreadyOnly })
    : EMPTY_HIDDEN_ITEM_IDS
  // Everything the packing planner must not reorder against: the rows
  // buildPackingTree does not render inside a location - container headers,
  // including a promotion still in flight, and worn rows - plus whatever the
  // filters are currently hiding.
  const packingReorderExclusions = new Set([
    ...derivePackReorderExclusions(listItems, packingLocations),
    ...packFilteredItemIds,
  ])

  // ── Food in Pack mode (0022: a bag's contents are the gear+food union) ──
  // useListFood already holds the food rows for the weight total; Pack renders
  // the same rows. Everything below is a function of PAGE state - the mode,
  // the two row filters, which locations are on screen.
  const packFoodItems = mode === 'pack' ? listFoodItems : EMPTY_FOOD_ITEMS
  const foodById = new Map(packFoodItems.map((food) => [food.id, food]))
  // Filtered food rows, mirroring packFilteredItemIds for gear: hidden rows
  // must not participate in reorder planning. Same shared predicate as the
  // renderer and the gear planner (section-rows.ts).
  const packFilteredFoodIds = new Set(
    packFoodItems
      .filter((food) => !passesPackFilters(food, { showUnpackedOnly, showUnreadyOnly }))
      .map((food) => food.id),
  )
  // Food rows grouped by the location the page will actually RENDER. An
  // assignment to a location that is not on screen (optimistically deleted,
  // or still loading) folds into Unassigned, mirroring what buildPackingTree
  // does for gear rows - a row must never vanish because its bag did.
  const renderedLocationIds = new Set(
    (packingTree?.roots ?? []).flatMap(function collect(node): string[] {
      return [node.location.id, ...node.children.flatMap(collect)]
    }),
  )
  const foodByLocation = Map.groupBy(packFoodItems, (food) =>
    food.packingLocationId !== null && renderedLocationIds.has(food.packingLocationId)
      ? food.packingLocationId
      : null,
  )

  // Click-to-place. The plan is computed against the array the SECTION
  // rendered, handed back by the slot that was activated - never rebuilt from
  // a location id here, because the displayed cohort and a raw
  // packingLocationId scan diverge while a location delete is still
  // optimistic.
  const { placement, actions: placementActions } = usePlacement(
    (rowId, insertIndex, eligibleRows) => {
      // Reserved ranks: same-cohort rows the section did NOT render (worn
      // gear, filtered rows, container headers). The densify path that heals
      // a cross-table tie must not mint one of their slots.
      //
      // Locations are NORMALIZED through the rendered-location set, exactly
      // like buildPackingTree and foodByLocation normalize rows: during an
      // optimistic location delete the cache still carries the dead bag's
      // id while the rows RENDER under Unassigned, and comparing raw cached
      // ids would drop the genuine-Unassigned hidden rows from the avoid
      // set (round-6 finding 2).
      const renderedIds = new Set(
        eligibleRows.map((row) => (row.kind === 'gear' ? row.gear.id : row.food.id)),
      )
      const normalizeLocation = (locationId: string | null) =>
        locationId !== null && renderedLocationIds.has(locationId)
          ? locationId
          : null
      const cohortLocation = eligibleRows[0]
        ? normalizeLocation(
            eligibleRows[0].kind === 'gear'
              ? eligibleRows[0].gear.packingLocationId
              : eligibleRows[0].food.packingLocationId,
          )
        : null
      const avoidRanks = new Set([
        ...listItems
          .filter(
            (item) =>
              normalizeLocation(item.packingLocationId) === cohortLocation &&
              !renderedIds.has(item.id),
          )
          .map((item) => item.packSortOrder),
        ...listFoodItems
          .filter(
            (item) =>
              normalizeLocation(item.packingLocationId) === cohortLocation &&
              !renderedIds.has(item.id),
          )
          .map((item) => item.packSortOrder),
      ])
      const updates = planPlacementWithinLocation(
        rowId,
        insertIndex,
        eligibleRows,
        avoidRanks,
      )
      if (!updates) return
      const movedRow = eligibleRows.find(
        (row) => (row.kind === 'gear' ? row.gear.id : row.food.id) === rowId,
      )
      const movedName = movedRow ? packRowName(movedRow) : undefined
      // Pack rank: click-to-place is offered only inside a bag (the menu
      // withholds it outside location grouping), so it is always a pack
      // reorder - a union one since 0022.
      narrated({
        doing: movedName ? `Moving ${movedName}.` : undefined,
        done: movedName ? `Moved ${movedName}.` : undefined,
        failed: movedName ? `Could not move ${movedName}.` : undefined,
        run: (callbacks) => reorderPackItemsMut.mutate(updates, callbacks),
      })
    },
  )

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
    // A drag and a placement are two answers to the same question. Starting
    // one closes the other rather than leaving both offering targets.
    //
    // WITHOUT returning focus: a keyboard drag reads its keystrokes from the
    // focused drag handle, so sending focus back to the kebab here would
    // strand the drag that just started.
    placementActions.cancel({ returnFocus: false })
    locationDrag.onDragStart(e)
  }

  // dnd-kit announces drag start and cancel itself; repeating them here
  // would say each twice.
  function handleDragCancel() {
    setActiveId(null)
    locationDrag.onDragCancel()
  }

  // One implementation behind both move requests: a gear row and a food row
  // differ only in where the name is looked up and which mutation moves
  // them. Both are reachable only in pack mode - the row menus and the drag
  // plans that call them are pack-gated - where packFoodItems is exactly
  // listFoodItems, so ONE rank source serves both (they used to differ by
  // name only, and a reader had to prove the equivalence).
  //
  // nextPackSortOrder is the DESTINATION cohort's next UNION rank (gear and
  // food - 0022), mirroring the server. A gear-only maximum here would park
  // the row visually above food already in the bag until the refetch
  // corrected it (GATE 2 finding). A move never touches sortOrder, so the
  // row keeps its place in List view and on the share link.
  //
  // The write fires even when `name` is undefined (a row the caches no
  // longer hold a name for); only the narration is skipped.
  function requestMoveRow(
    name: string | undefined,
    locationId: string | null,
    mutate: (nextPackSortOrder: number, callbacks: NarrationCallbacks) => void,
  ) {
    const destination = locationId === null
      ? 'Unassigned'
      : realLocations.find((location) => location.id === locationId)?.name
    narrated({
      doing: name && destination ? `Moving ${name} to ${destination}.` : undefined,
      done: name && destination ? `Moved ${name} to ${destination}.` : undefined,
      failed: name ? `Could not move ${name}.` : undefined,
      run: (callbacks) =>
        mutate(nextUnionPackRankFor(listItems, listFoodItems, locationId), callbacks),
    })
  }

  function requestMove(itemId: string, locationId: string | null) {
    requestMoveRow(
      listItemsById.get(itemId)?.gearItem.name,
      locationId,
      (nextPackSortOrder, callbacks) =>
        moveItem.mutate({ itemId, locationId, nextPackSortOrder }, callbacks),
    )
  }

  function requestMoveFood(foodId: string, locationId: string | null) {
    requestMoveRow(
      foodById.get(foodId)?.name,
      locationId,
      (nextPackSortOrder, callbacks) =>
        moveFood.mutate({ foodId, locationId, nextPackSortOrder }, callbacks),
    )
  }

  // Single page-level drag handler over four id kinds.
  //
  // Order matters. locationDrag.onDragEnd runs FIRST and strictly
  // self-gates on the packing-location kind, so it no-ops for item drags and
  // the item planners below never see a section drag. That gating is why a
  // section reorder cannot be routed through planPackingRowDragEnd, which
  // only understands a packing-item as the active id: dropping a section
  // would animate and write nothing at all.
  //
  // Category grouping keeps the plain within-category reorder. Location
  // grouping gets the packing planner, which returns EITHER a reorder or a
  // cross-location move from the same gesture.
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    locationDrag.onDragEnd(e)

    const { active, over } = e
    const draggedId = String(active.id)
    const overId = over ? String(over.id) : undefined
    const activeParsed = parseDnDId(draggedId)

    // A pack drag writes pack ranks, and it cannot do that correctly without
    // knowing the real location layout. When the locations query has not
    // resolved, `packingLocations` is [] and the grouping silently falls back
    // to categories - at which point planListItemReorder takes its category
    // branch, whose justification (see the comment on it) is that every item
    // is in the single Unassigned cohort, so permuting a category-sized subset
    // permutes a subset of one cohort's ranks. That premise holds for a list
    // that genuinely HAS no locations. It is false when the locations merely
    // failed to load, and then the write redistributes ranks across items that
    // really do belong to different cohorts.
    //
    // A successful empty result IS resolved, so a location-free list keeps
    // dragging exactly as before.
    if (mode === 'pack' && !packingLocationsResolved) {
      setAnnouncement('Cannot reorder until packing locations have loaded.')
      return
    }

    if (
      activeParsed?.kind === 'packing-item' ||
      activeParsed?.kind === 'packing-food-item'
    ) {
      const draggedName =
        activeParsed.kind === 'packing-item'
          ? listItemsById.get(activeParsed.id)?.gearItem.name
          : foodById.get(activeParsed.id)?.name
      // In the no-locations category fallback, gear renders grouped by
      // category and food in its own section - the union is never displayed
      // as one sequence there. Excluding ALL gear makes a food drag permute
      // the food subsequence the user is actually looking at (a subset
      // permutation of the union, which the server accepts) instead of
      // computing indices against invisible gear rows.
      const reorderExclusions = groupingKind === 'category'
        ? new Set([...packingReorderExclusions, ...listItems.map((i) => i.id)])
        : packingReorderExclusions
      const plan = planPackingRowDragEnd(
        draggedId,
        overId,
        listItems,
        packFoodItems,
        realLocationIds,
        containerItemIdByLocation,
        containerMoveExclusions,
        reorderExclusions,
        packFilteredFoodIds,
        renderedLocationIds,
      )
      if (plan?.kind === 'reorder') {
        narrated({
          doing: draggedName ? `Reordering ${draggedName}.` : undefined,
          done: draggedName ? `Reordered ${draggedName}.` : undefined,
          failed: draggedName ? `Could not reorder ${draggedName}.` : undefined,
          run: (callbacks) => reorderPackItemsMut.mutate(plan.updates, callbacks),
        })
        return
      }
      if (!plan) {
        setAnnouncement('Move canceled.')
        return
      }
      if (plan.kind === 'move-gear') requestMove(plan.itemId, plan.locationId)
      else requestMoveFood(plan.foodItemId, plan.locationId)
      return
    }

    if (!over) return
    if (active.id === over.id) return

    const plan = planListItemReorder({
      activeId: draggedId,
      overId: String(over.id),
      items: listItems,
      groupingKind,
      mode,
      locations: packingLocations,
      hiddenItemIds: mode === 'pack' ? packFilteredItemIds : EMPTY_HIDDEN_ITEM_IDS,
    })
    if (plan?.kind === 'pack') reorderPackItemsMut.mutate(plan.updates)
    else if (plan) reorderItemsMut.mutate(plan.updates)
  }

  // Placement is a MODE, and a mode that outlives its subject acts on the
  // wrong thing. ListDetailInner is keyed only by list id, so switching to
  // List view does not remount it, and collapsing a section merely stops
  // rendering its rows - without this the mode could go invisible and come
  // back later against a changed list.
  //
  // The slots themselves already fail safe: each one only renders when the
  // placing row is present in the array ITS OWN section rendered, so a row
  // that is filtered away, removed, or moved elsewhere simply stops offering
  // slots. This clears the state behind that, for the cases where it would
  // otherwise linger.
  //
  // A row being promoted to a container is caught here, because
  // packingReorderExclusions counts pending containers.
  //
  // This check is deliberately NOT exhaustive. Everything it cannot see -
  // the section collapsing, another tab moving the row into a collapsed bag,
  // its location being optimistically deleted - shows up as "no usable slots
  // are mounted any more", which PlacementProvider watches directly. Adding a
  // predicate here per case would be a second, partial copy of a question the
  // slots can answer exactly.
  const placingItemId = placement?.itemId
  const placementCancel = placementActions.cancel
  const placingStillEligible =
    placingItemId === undefined ||
    (groupingKind === 'location' &&
      mode === 'pack' &&
      (foodById.has(placingItemId)
        ? !packFilteredFoodIds.has(placingItemId)
        : listItemsById.has(placingItemId) &&
          !packFilteredItemIds.has(placingItemId) &&
          !packingReorderExclusions.has(placingItemId)))
  useEffect(() => {
    if (!placingStillEligible) placementCancel()
  }, [placingStillEligible, placementCancel])

  // Escape closes the mode from anywhere, which is the documented way out of
  // it. Registered only while placing so it cannot shadow anything else.
  useEffect(() => {
    if (placingItemId === undefined) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') placementCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [placingItemId, placementCancel])

  // Location drags are constrained to siblings; item drags may target any
  // item or location. Without this filter, closestCenter would happily
  // reparent a section onto a cousin.
  const collisionDetection: CollisionDetection = (args) => closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) =>
      isPackingCollisionTarget(
        String(args.active.id),
        String(container.id),
        siblingLocationIdsById,
      ),
    ),
  })

  return {
    sensors,
    activeId,
    announcement,
    collisionDetection,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
    placement,
    placementActions,
    requestMove,
    requestMoveFood,
    anyItemReorderPending,
    itemDragPending,
    // Derivations the page's render consumes; the rest stay internal.
    realLocations,
    containerMoveExclusions,
    packFoodItems,
    foodById,
    foodByLocation,
  }
}
