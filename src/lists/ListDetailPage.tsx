import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
const ListSidebarDrawer = lazy(() => import('./ListSidebarDrawer'))
import {
  queryKeys,
  fetchLists,
  fetchListItems,
  fetchGearItems,
  fetchCategories,
  fetchPackingLocations,
  fetchFoodPlans,
  updateList,
  updateListItem,
  reorderListItems,
  reorderPackingLocations,
  makeOptimisticReorder,
  makeOptimisticUpdate,
  type ListItemPatch,
} from '../lib/queries'
import type { Category, GearItem, ListItemWithGear, List, PackingLocation } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useReorderable } from '../lib/use-reorderable'
import { useLatestRef } from '../lib/use-latest-ref'
import {
  writeLastListPath,
  readLastListPath,
  clearLastListPath,
  getListIdFromListPath,
} from '../lib/last-list-path'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import { assignSortOrderSlots } from '../lib/grouping'
import { useGroupedListItems } from '../lib/use-grouped-list-items'
import { useStableWornItems } from '../lib/use-stable-worn-items'
import {
  baseGramsForCategory,
  computeWeightBreakdown,
  consumableGramsForCategory,
  withProjectedFood,
} from '../lib/weight-breakdown'
import { useFoodProjection } from './use-food-projection'
import { useFoodPlanLink } from './use-food-plan-link'
import { useFoodPack } from './use-food-pack'
import FoodPackSection from './FoodPackSection'
import FoodRow from './FoodRow'
import FoodPlanPicker from './FoodPlanPicker'
import { planPackingItemReorder } from './packing-dnd'

type LibraryTab = 'gear' | 'food'

// One label per half of the panel. Shared so the toggle's button text and the
// mobile drawer's accessible title cannot drift apart.
const LIBRARY_TAB_LABELS: Record<LibraryTab, string> = {
  gear: 'Add from gear',
  food: 'Food plan',
}

// Gear | Food switch for the library panel: two views of one panel, exactly one
// of which is active.
//
// Styled as tabs but deliberately NOT role="tablist"/"tab". That contract
// promises arrow-key navigation between tabs, a roving tabIndex, and an
// aria-controls'd tabpanel; claiming it without those makes keyboard behavior
// worse than plain buttons, because a screen reader announces a widget that is
// not there. Two aria-pressed toggles say exactly what these are and get Tab
// navigation for free. (The pane is also mounted twice below lg - CSS-hidden
// aside plus the drawer - so an aria-controls id would need to be unique per
// mount, which a real tablist here would have to solve too.)
function LibraryTabs({
  tab,
  onChange,
}: {
  tab: LibraryTab
  onChange: (tab: LibraryTab) => void
}) {
  return (
    <div
      role="group"
      aria-label="Add to this list"
      className="flex border-b border-gray-200 bg-gray-50"
    >
      {(['gear', 'food'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={tab === value}
          onClick={() => onChange(value)}
          className={`px-3 py-2 ${FLAT_TABLE_EYEBROW} border-b-2 -mb-px ${
            tab === value
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent hover:text-gray-900'
          }`}
        >
          {LIBRARY_TAB_LABELS[value]}
        </button>
      ))}
    </div>
  )
}
import WeightSummary from './WeightSummary'
import LibraryPanel from './LibraryPanel'
import DesktopListsPanel from './DesktopListsPanel'
import { FLAT_TABLE_EYEBROW, FLAT_TABLE_META_TEXT, FLAT_TABLE_SURFACE } from '../components/flat-table-styles'
import MobileListActionBar from './MobileListActionBar'
import ListDocumentToolbar from './ListDocumentToolbar'
import EmptyListCell from './EmptyListCell'
import PackingProgress from './PackingProgress'
import { useListResetActions } from './use-list-reset-actions'
import { useListItemActions } from './use-list-item-actions'
import { findBackedLocation, useListItemRemoval } from './use-list-item-removal'
import { useListGearActions } from './use-list-gear-actions'
import NotesEditor from './NotesEditor'
import { type AddItemData } from './use-quick-add-form'
import CategoryGroup from './CategoryGroup'
import { packingSortableRows, sortableRows } from './SortableCategoryRows'
import PanelCard from './PanelCard'
import ItemRow from './ItemRow'
import GearItemDialog from '../components/gear/GearItemDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import { useDocumentTitle } from '../lib/use-document-title'
import { useRegisterSidebarDrawer } from '../layout/sidebar-drawer-context'
import {
  deriveListMode,
  isLegacyOrganizePath,
  listDocumentTitle,
  persistedListPath,
  type ListDetailMode,
} from './list-detail-mode'
import { orderPackGroups, selectPackGroupingState } from './packing-grouping'
import { usePackingCollapsed } from './packing-collapse'
import {
  buildContainerMoveExclusions,
  buildPackingTree,
  buildSiblingLocationIdsById,
  deriveWornReorderExclusions,
  type PackingTreeLocation,
} from './packing-tree'
import { usePackingLocationActions } from './use-packing-location-actions'
import { isPackingCollisionTarget, planPackingItemDragEnd } from './packing-dnd'
import MoveToLocationMenu from './MoveToLocationMenu'
import { PackLocationSection } from './PackLocationSection'
import { DroppableUnassignedSection } from './SortablePackSection'
import { FOOD_PLANNING_ENABLED } from '../lib/product-features'
import { PACKING_LOCATION_CAP } from '../lib/caps'

// TRANSPLANT NOTE (print): the old page rendered PrintListHeader above the
// grid (a print-only document header) and carried print:* utility classes
// tuned around it. The header returns with the CSV/print slice; the
// print:hidden classes on transient chrome are kept since they're inert
// without a print stylesheet consumer.
// TRANSPLANT NOTE (tabs): the old page rendered ListWorkspaceTabs (a
// Gear/Pack two-tab remnant) above ListDocumentToolbar. The toolbar now owns
// direct List / Organize / Pack navigation; the old workspace tab strip returns
// only if the workspace grows real tabs (e.g. a Food tab with that slice).

const EMPTY_LIST_ITEMS: ListItemWithGear[] = []
const EMPTY_GEAR_ITEMS: GearItem[] = []
const EMPTY_CATEGORIES: Category[] = []
// Edit mode has no pack filters, so nothing is ever hidden there. Module-level
// so the reorder planner isn't handed a fresh Set on every drag tick.
const EMPTY_HIDDEN_ITEM_IDS: ReadonlySet<string> = new Set<string>()
const EMPTY_EXCLUSIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map()

// Every transient dialog/modal/inline-form on this page lives in one
// discriminated union, set/cleared atomically. `null` is the closed state
// (matching the pattern in src/gear/GearLibraryPage.tsx). edit-gear folds
// the optional list-item context AND the partial-save error message into
// one variant so they can never drift apart.
type DialogState =
  | { type: 'edit-gear'; gear: GearItem; listItem: ListItemWithGear | null; saveError: string | null }
  // `returnDialog` lets the confirm dialog restore the prior dialog on
  // cancel — set when the delete is launched from inside GearItemDialog
  // so the user lands back in the form they were editing rather than
  // dropping all the way to the page. Omitted (undefined) for deletes
  // launched directly from the row kebab.
  | { type: 'delete-gear'; candidate: GearItem; returnDialog?: DialogState }
  // The ONLY removal that still asks. A list item that backs a packing
  // location cascades that location away and orphans its contents, which Undo
  // cannot rebuild - see use-list-item-removal.ts for why. Every other
  // removal is immediate with an Undo toast.
  | {
      type: 'remove-container-item'
      item: ListItemWithGear
      location: PackingLocation
      returnDialog?: DialogState
    }

export function derivePackReorderExclusions(
  items: ListItemWithGear[],
  locations: PackingLocation[],
): Set<string> {
  const excludedItemIds = new Set(
    locations.flatMap((location) =>
      location.containerListItemId === null ? [] : [location.containerListItemId],
    ),
  )
  for (const item of items) {
    if (item.isWorn) excludedItemIds.add(item.id)
  }
  return excludedItemIds
}

// Rows the pack-mode filters have hidden. A hidden row must be neither a
// reorder source nor a reorder neighbour: the sort slots are computed from the
// rows the user can actually see, so counting an invisible row would drop the
// dragged row somewhere other than where it was released.
//
// Takes the same predicate shape CategoryGroup renders with, so the two cannot
// disagree about what "hidden" means.
export function deriveFilteredItemIds(
  items: ListItemWithGear[],
  { showUnpackedOnly, showUnreadyOnly }: {
    showUnpackedOnly: boolean
    showUnreadyOnly: boolean
  },
): Set<string> {
  const hidden = new Set<string>()
  if (!showUnpackedOnly && !showUnreadyOnly) return hidden
  for (const item of items) {
    const visible =
      (!showUnpackedOnly || !item.isPacked) && (!showUnreadyOnly || !item.isReady)
    if (!visible) hidden.add(item.id)
  }
  return hidden
}

export function planListItemReorder({
  activeId,
  overId,
  items,
  groupingKind,
  locations,
  hiddenItemIds,
}: {
  activeId: string
  overId: string | undefined
  items: ListItemWithGear[]
  groupingKind: 'category' | 'location'
  locations: PackingLocation[]
  // Rows currently filtered out of the rendered list (see
  // deriveFilteredItemIds). Empty set = nothing hidden.
  hiddenItemIds: ReadonlySet<string>
}): { id: string; sortOrder: number }[] | null {
  if (groupingKind === 'location') {
    const excludedItemIds = derivePackReorderExclusions(items, locations)
    for (const itemId of hiddenItemIds) excludedItemIds.add(itemId)
    return planPackingItemReorder(
      activeId,
      overId,
      items,
      'item',
      excludedItemIds,
    )
  }

  const active = parseDnDId(activeId)
  const over = overId === undefined ? null : parseDnDId(overId)
  if (active?.kind !== 'item' || over?.kind !== 'item') return null

  const activeItem = items.find((item) => item.id === active.id)
  const overItem = items.find((item) => item.id === over.id)
  if (!activeItem || !overItem) return null
  if (hiddenItemIds.has(activeItem.id) || hiddenItemIds.has(overItem.id)) return null
  const categoryId = activeItem.gearItem.categoryId
  if (overItem.gearItem.categoryId !== categoryId) return null

  const categoryItems = items.filter((item) =>
    item.gearItem.categoryId === categoryId && !hiddenItemIds.has(item.id),
  )
  const oldIndex = categoryItems.findIndex((item) => item.id === active.id)
  const newIndex = categoryItems.findIndex((item) => item.id === over.id)
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null
  return assignSortOrderSlots(arrayMove(categoryItems, oldIndex, newIndex))
}

export default function ListDetailPage() {
  // Default title for the wrapper; ListDetailInner overrides with the list
  // name once it mounts and the list resolves. Stays as "Lists" briefly while
  // the lists query is pending.
  useDocumentTitle('Lists')
  // Mounted only at /lists/:id, so params.id is guaranteed by the route.
  // Asserting here narrows routeId to string for ListDetailInner's listId prop.
  const { id } = useParams<{ id: string }>()
  const routeId = id!

  // isPending captures the "no data yet" window for first load. Passing it
  // through to the inner lets the not-found branch wait for the query to
  // settle before declaring the list missing — without this, the default
  // empty-array fallback would render "List not found" on every cold load
  // for ~1 paint before the query resolves. The session cookie scopes the
  // fetch server-side; there is no client-side userId filter.
  const { data: lists = [], isPending: listsLoading } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
  })

  // key={routeId} forces a fresh ListDetailInner instance per list, so local
  // state (open dialogs, draft inputs, etc.) doesn't leak when the user
  // switches lists.
  return (
    <ListDetailInner
      key={routeId}
      listId={routeId}
      lists={lists}
      listsLoading={listsLoading}
    />
  )
}

function ListDetailInner({
  listId,
  lists,
  listsLoading,
}: {
  listId: string
  lists: List[]
  listsLoading: boolean
}) {
  const qc = useQueryClient()
  // Pack mode is URL-represented as /lists/:id/pack so it's bookmarkable,
  // refresh-stable, and back/forward navigable. The legacy ?mode=pack URL
  // redirects below for old bookmarks and home-screen shortcuts.
  const location = useLocation()
  const navigate = useNavigate()
  const legacyPackMode = location.pathname === `/lists/${listId}` && new URLSearchParams(location.search).get('mode') === 'pack'
  // Organize was merged into Pack. Both retired URL shapes still resolve (via
  // deriveListMode) and get rewritten to /pack below, so old bookmarks and
  // home-screen shortcuts land in the view that replaced them rather than on
  // a dead route.
  const legacyOrganizeMode = isLegacyOrganizePath(location.pathname, listId)
  const mode: ListDetailMode = deriveListMode(location.pathname, location.search, listId)
  const { weightUnit } = useWeightUnit()
  // Page-level breakpoint, prop-drilled into rows via sharedGroupProps so a
  // long list registers ONE matchMedia subscription instead of one per row.
  const isBelowLg = useIsBelowLg()
  // Pack-mode filter: when true, hide already-packed items from each
  // category. Header counts and the "complete" affordance still reflect the
  // full items array. Lifted here because both PackingProgress (the toggle)
  // and CategoryGroup (the filter consumer) live as children of this page.
  const [showUnpackedOnly, setShowUnpackedOnly] = useState(false)
  // Peer of showUnpackedOnly for the ready column: "what still needs prepping".
  // Independent, not a mode switch - with both on you see only the rows that
  // are neither packed nor ready. Deliberately NOT persisted, same as its
  // sibling: a filter that survives a reload hides items from a user who has
  // forgotten they turned it on.
  const [showUnreadyOnly, setShowUnreadyOnly] = useState(false)
  const {
    collapsed: packingCollapsed,
    toggle: togglePackingCollapsed,
  } = usePackingCollapsed(listId)
  // Notes panel edit mode. Lifted here so PanelCard.headerAction can
  // render the pencil button conditionally (read mode only) without
  // exposing NotesEditor's internal state up through a callback.
  const [notesEditing, setNotesEditing] = useState(false)
  // Mobile sidebar drawer - open/setOpen are owned by SidebarDrawerContext so
  // the bottom bar's Add action can toggle the drawer from a sibling subtree.
  // The hook sets `available` to enable that action in edit and Pack modes.
  const { open: drawerOpen, setOpen: setDrawerOpen } = useRegisterSidebarDrawer(
    mode === 'edit' || mode === 'pack',
  )
  // Single discriminated union for every transient dialog/modal/inline-form
  // on this page. Mirrors the pattern in src/gear/GearLibraryPage.tsx —
  // `type` discriminator, `null` for the closed state. Folding the partial-
  // save error into the edit-gear variant means closing the dialog or
  // switching gear items naturally discards the error: no separate state to
  // keep in sync.
  const [dialog, setDialog] = useState<DialogState | null>(null)
  // Packing-location admin state, lifted from the retired OrganizePackPanel.
  // Which section is renaming (by id, so switching sections cannot leak a
  // half-typed name), the pending location delete, and the new-location draft.
  const [renamingLocationId, setRenamingLocationId] = useState<string | null>(null)
  const [deleteLocationTarget, setDeleteLocationTarget] = useState<PackingLocation | null>(null)
  const [newLocationName, setNewLocationName] = useState('')

  const list = lists.find((l) => l.id === listId)
  // Inner overrides the wrapper's "Lists" default with the list name once
  // it resolves; falls back to "Lists" while the lists query is pending so
  // the title doesn't briefly drop to the bare app name.
  useDocumentTitle(list ? listDocumentTitle(list.name, mode) : 'Lists')

  // The attached food plan's weight, derived from the plan document + the food
  // library. Passing null while Food is parked keeps preserved links dormant
  // without violating hook ordering or touching stored data.
  const { projection: foodProjection, isError: foodProjectionError } =
    useFoodProjection(FOOD_PLANNING_ENABLED ? (list?.foodPlanId ?? null) : null)
  // The list ROW is the authority on whether food is part of this trip. The
  // projection is only its weight, and it is absent while the plan loads or if
  // the fetch fails - moments when the food has not gone anywhere.
  const hasFoodPlan = FOOD_PLANNING_ENABLED && list?.foodPlanId != null
  const incompleteFood = foodProjection?.incomplete ?? false

  // Which half of the library panel is showing. Gear is the default: adding gear
  // is the everyday act, picking a plan happens once per trip.
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('gear')
  // Only fetched once the user actually opens the Food side - most sessions
  // never touch it, and the Food row gets its name from the plan document
  // rather than from this summary list.
  const {
    data: foodPlans = [],
    isPending: foodPlansPending,
    isError: foodPlansError,
  } = useQuery({
    queryKey: queryKeys.foodPlans(),
    queryFn: fetchFoodPlans,
    enabled: FOOD_PLANNING_ENABLED && libraryTab === 'food',
  })
  const { attachMut, detachMut, duplicateMut, busy: foodLinkBusy } =
    useFoodPlanLink()
  const onAttachFoodPlan = useCallback(
    (foodPlanId: string) => attachMut.mutate({ id: listId, foodPlanId }),
    [attachMut, listId],
  )
  const onDetachFoodPlan = useCallback(
    () => detachMut.mutate(listId),
    [detachMut, listId],
  )
  // Duplicate & attach (a plan already backing another list). The CAS
  // expectation is THIS list's current link as this render observed it.
  const listFoodPlanId = FOOD_PLANNING_ENABLED ? (list?.foodPlanId ?? null) : null

  // Pack-mode food checklist (design 8, slice 4): rows + totals + the CAS
  // toggle, with its own query subscriptions (colocation - see the hook).
  // Enabled only where it renders; packableTotal/packedTotal are 0 while
  // disabled, so edit mode and plan-less lists keep gear-only totals.
  //
  // !foodLinkBusy: never fetch pack state under a link the server hasn't
  // confirmed. During an optimistic attach the lists cache already shows
  // the NEW plan, but GET /food-pack is keyed by list alone and would
  // return the OLD plan's rows - entering pack mode in that window would
  // cache them under the new plan's key as phantom pre-checks (and retain
  // them if the attach then failed). Once the link settles, success has
  // removed the ['food-pack'] caches and failure has rolled the link back,
  // so the fetch that then fires is correct either way.
  const foodPack = useFoodPack(
    listId,
    listFoodPlanId,
    hasFoodPlan && mode === 'pack' && !foodLinkBusy,
  )
  const onDuplicateAttachFoodPlan = useCallback(
    (planId: string) =>
      duplicateMut.mutate({
        planId,
        listId,
        expectedFoodPlanId: listFoodPlanId,
      }),
    [duplicateMut, listId, listFoodPlanId],
  )


  useEffect(() => {
    if (legacyPackMode || legacyOrganizeMode) {
      void navigate(`/lists/${listId}/pack`, { replace: true })
    }
  }, [legacyOrganizeMode, legacyPackMode, listId, navigate])

  // Last-list cache write: stash the list path only AFTER the list resolves
  // to a real, server-permitted row. Writing on mount unconditionally would
  // make a stale cache sticky — the nav shortcut would send the user to a
  // dead list and the unconditional write would refresh the bad path,
  // locking the loop in. The reactive dep `list?.id` is undefined while
  // the lists query is in-flight or the route is invalid, so no write
  // fires on those paths. The `mode` dep tracks peer-mode toggling so the
  // stored path stays in sync with List, Pack, or Organize.
  useEffect(() => {
    if (list?.id) {
      writeLastListPath(persistedListPath(list.id, mode))
    }
  }, [list?.id, mode])

  // Last-list cache self-heal: if the route's listId is the cached one but
  // the list isn't in the user's `lists` collection (deleted, or another
  // account's list under a stale same-domain cache), clear the cache so the
  // nav shortcut takes the plain /lists path instead of looping back here.
  // Compare the cached path's extracted UUID against listId so an unrelated
  // missing-list deep-link doesn't wipe a valid cache. Gated on
  // !listsLoading so the in-flight window — where `list` is undefined for a
  // different reason — doesn't wipe a perfectly valid cache during cold load.
  useEffect(() => {
    if (listsLoading) return
    if (!list && listId) {
      const cachedPath = readLastListPath()
      if (cachedPath && getListIdFromListPath(cachedPath) === listId) {
        clearLastListPath()
      }
    }
  }, [list, listId, listsLoading])

  const listItemsQuery = useQuery({
    queryKey: queryKeys.listItems(listId),
    queryFn: () => fetchListItems(listId),
  })
  const listItems = listItemsQuery.data ?? EMPTY_LIST_ITEMS

  const gearItemsQuery = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: fetchGearItems,
  })
  const gearItems = gearItemsQuery.data ?? EMPTY_GEAR_ITEMS

  // O(1) id lookups for DnD callbacks and DragOverlay rendering. Linear
  // scan would be fine at typical N (~50 list items per list); the Map
  // signals intent more clearly and keeps drag-tick cost flat rather
  // than scaling with N. Ref-based callback finds (in onLibraryRemove
  // and sharedGroupProps's onEditGearItem/onDeleteGearItem) are NOT
  // converted — those read *Ref.current at click-time, and a
  // *ByIdRef would require an additional ref + useEffect to keep in
  // sync, which is more code than the linear scan saves at click cadence.
  const listItemsById = useMemo(
    () => new Map(listItems.map((i) => [i.id, i])),
    [listItems],
  )

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: fetchCategories,
  })
  const categories = categoriesQuery.data ?? EMPTY_CATEGORIES
  // Packing locations, and their reorder state machine.
  //
  // Subscribed in BOTH modes, not just pack. Pack mode needs it to group by
  // location and to reorder sections; edit mode needs it to answer "does this
  // row back a container?" before removing it, and removal is reachable from
  // every view (picker unpick, row kebab, mobile swipe, edit dialog). That
  // relationship lives only on the location row - a list item records where it
  // sits, never what it contains - so without this the edit-mode removal path
  // is blind to the cascade it is about to trigger. Capped at 30 rows/list.
  //
  // useReorderable rather than a bare useQuery because THIS component renders
  // the location SortableContext, and the hook's own useQuery subscription is
  // what keeps the optimistic reorder write and the drop animation in one
  // commit - see the hook's file comment for the race it structurally
  // prevents. It self-gates on dndKind, so its handleDragEnd can sit
  // alongside the item handler under one DndContext without cross-fire.
  const {
    items: packingLocations,
    isError: packingLocationsError,
    activeItem: activeLocation,
    reorderPending: locationReorderPending,
    handleDragStart: handleLocationDragStart,
    handleDragCancel: handleLocationDragCancel,
    handleDragEnd: handleLocationDragEnd,
  } = useReorderable<PackingLocation>({
    queryKey: queryKeys.packingLocations(listId),
    queryFn: () => fetchPackingLocations(listId),
    mutationFn: (updates) => reorderPackingLocations(listId, updates),
    dndKind: 'packing-location',
  })
  const packingGroupingState = selectPackGroupingState(categories, {
    data: packingLocations,
    isError: packingLocationsError,
  })
  const grouping = mode === 'pack'
    ? packingGroupingState.grouping
    : { kind: 'category' as const, groups: categories }
  const detailDataLoading = listItemsQuery.isPending || gearItemsQuery.isPending || categoriesQuery.isPending
  const detailDataError =
    (listItemsQuery.isError && listItemsQuery.data === undefined) ||
    (gearItemsQuery.isError && gearItemsQuery.data === undefined) ||
    (categoriesQuery.isError && categoriesQuery.data === undefined)
  const retryDetailData = useCallback(() => {
    void listItemsQuery.refetch()
    void gearItemsQuery.refetch()
    void categoriesQuery.refetch()
  }, [categoriesQuery, gearItemsQuery, listItemsQuery])

  // ── Mutations ──────────────────────────────────────────────────────────────

  // Gear/category inventory writes reachable from this list (edit gear, delete
  // gear from inventory, create a category from the edit-gear dialog) live in a
  // dedicated hook; it owns the gear-specific fan-out wiring across the
  // ['gear-items'] + every ['list-items', *] cache, the delete-gear error toast,
  // and the category optimistic insert. The page keeps the raw mutations' stable
  // `.mutate` reads (sharedGroupProps.onSaveGear*/onSetGearStatus), the edit-gear
  // dialog's sequential gear-then-list save orchestration + saveError state, and
  // the delete-gear confirm + returnDialog restore.
  const { updateGearItem, deleteGearItem, addCategory } = useListGearActions(categories)

  // List-item write actions (add existing gear / update fields / delete / Quick
  // Add new gear+item) live in a dedicated hook; it owns the optimistic
  // insert/update/delete wiring, the update sibling-in-flight invalidation gate,
  // and addNewItem's dual-cache invalidation + errorToast. The page keeps the
  // stable handler/memo layer that reads these raw mutations' `.mutate` through
  // the live binding (onLibraryAdd/onLibraryRemove/onAddNewItem, sharedGroupProps),
  // the addingNewItemRef double-fire guard, DnD/reorder, dialog orchestration,
  // and the inline notes/ready-checks list-field mutations. (Gear/category
  // writes live in useListGearActions, above.)
  const { addItem, updateItem, deleteItem, addNewItem } = useListItemActions(listId, {
    listItems,
  })

  const reorderItemsMut = useMutation({
    mutationFn: (updates: { id: string; sortOrder: number }[]) =>
      reorderListItems(listId, updates),
    ...makeOptimisticReorder<ListItemWithGear>(qc, queryKeys.listItems(listId)),
  })

  // Packing-location admin (create / rename / delete / promote an item to a
  // container), lifted from the retired OrganizePackPanel unchanged.
  const { createLocation, createItemContainer, renameLocation, removeLocation } =
    usePackingLocationActions(listId, packingLocations)
  const locationCreationPending =
    createLocation.isPending || createItemContainer.isPending

  // Moving an item between packing locations. Also lifted from the organizer:
  // it is the write behind both a cross-location drag and the row menu.
  const moveItemMut = useMutation({
    mutationFn: ({ itemId, locationId }: { itemId: string; locationId: string | null }) =>
      updateListItem(listId, itemId, { packingLocationId: locationId }),
    ...makeOptimisticUpdate<
      ListItemWithGear,
      { itemId: string; locationId: string | null }
    >({
      qc,
      queryKey: queryKeys.listItems(listId),
      id: ({ itemId }) => itemId,
      apply: (item, { locationId }) => ({ ...item, packingLocationId: locationId }),
    }),
  })
  const itemDragPending =
    moveItemMut.isPending || reorderItemsMut.isPending || locationCreationPending

  const notesMut = useMutation({
    mutationFn: (description: string) => updateList(listId, { description: description || null }),
    ...makeOptimisticUpdate<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => listId,
      apply: (item, description) => ({
        ...item,
        description: description || null,
        updatedAt: new Date().toISOString(),
      }),
    }),
  })

  // Guards against the inline Quick Add row firing twice when the user
  // commits the same draft rapidly (Enter then blur, or two Enter presses).
  // Each press fires a fresh quick-add request; without a gate the second
  // succeeds and creates a duplicate gear item + list item.
  // addNewItem.isPending lives on a fresh useMutation result each render,
  // so reading it through a [] -deps useCallback closure is stale; a ref is
  // the stable handle.
  const addingNewItemRef = useRef(false)

  // Split mouse vs touch so each gets the activation that fits its input.
  // MouseSensor: 5px drag threshold from the hover grip handle (desktop).
  // TouchSensor: a short press-and-hold (delay) before a drag starts, so a
  // quick tap still opens the edit modal and a vertical swipe still scrolls
  // the page — only a deliberate hold begins a reorder. dnd-kit's own
  // guidance is to use MouseSensor + TouchSensor (not PointerSensor) when
  // mouse and touch need different activation. PointerSensor's flat 5px
  // distance was hijacking touch scroll, which is what broke mobile reorder.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Active drag id. Three kinds share this one DndContext now:
  //   item:             a row in category grouping (reorder within category)
  //   packing-item:     a row in location grouping (reorder OR move between
  //                     locations), and the backing item of a container
  //   packing-location: a section (reorder among siblings)
  // The DragOverlay below branches on the parsed kind.
  const [activeId, setActiveId] = useState<string | null>(null)
  // Screen-reader narration for packing drags. Pointer users see the row
  // move; without this, a keyboard user gets no confirmation that a drop
  // changed anything.
  const [announcement, setAnnouncement] = useState('')

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
    handleLocationDragStart(e)
    const parsed = parseDnDId(String(e.active.id))
    if (parsed?.kind !== 'packing-item') return
    const item = listItemsById.get(parsed.id)
    if (item) {
      setAnnouncement(
        `Dragging ${item.gearItem.name}. Reorder it here or choose another packing location.`,
      )
    }
  }

  function handleDragCancel() {
    setActiveId(null)
    handleLocationDragCancel()
    setAnnouncement('Move cancelled.')
  }

  function requestMove(itemId: string, locationId: string | null) {
    const item = listItemsById.get(itemId)
    const destination = locationId === null
      ? 'Unassigned'
      : realLocations.find((location) => location.id === locationId)?.name
    if (item && destination) setAnnouncement(`Moving ${item.gearItem.name} to ${destination}.`)
    moveItemMut.mutate({ itemId, locationId }, {
      onSuccess: () => {
        if (item && destination) setAnnouncement(`Moved ${item.gearItem.name} to ${destination}.`)
      },
      onError: () => {
        if (item) setAnnouncement(`Could not move ${item.gearItem.name}.`)
      },
    })
  }

  // Single page-level drag handler over three id kinds.
  //
  // Order matters. locationReorder.handleDragEnd runs FIRST and strictly
  // self-gates on the packing-location kind, so it no-ops for item drags and
  // the item planners below never see a section drag. That gating is why a
  // section reorder cannot be routed through planPackingItemDragEnd, which
  // only understands a packing-item as the active id: dropping a section
  // would animate and write nothing at all.
  //
  // Category grouping keeps the plain within-category reorder. Location
  // grouping gets the packing planner, which returns EITHER a reorder or a
  // cross-location move from the same gesture.
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    handleLocationDragEnd(e)

    const { active, over } = e
    const draggedId = String(active.id)
    const overId = over ? String(over.id) : undefined
    const activeParsed = parseDnDId(draggedId)

    if (activeParsed?.kind === 'packing-item') {
      const draggedItem = listItemsById.get(activeParsed.id)
      const plan = planPackingItemDragEnd(
        draggedId,
        overId,
        listItems,
        realLocationIds,
        containerItemIdByLocation,
        containerMoveExclusions,
        packingReorderExclusions,
      )
      if (plan?.kind === 'reorder') {
        if (draggedItem) setAnnouncement(`Reordering ${draggedItem.gearItem.name}.`)
        reorderItemsMut.mutate(plan.updates, {
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
        setAnnouncement('Move cancelled.')
        return
      }
      requestMove(plan.itemId, plan.locationId)
      return
    }

    if (!over) return
    if (active.id === over.id) return

    const updates = planListItemReorder({
      activeId: draggedId,
      overId: String(over.id),
      items: listItems,
      groupingKind: grouping.kind,
      locations: packingLocations,
      hiddenItemIds: mode === 'pack' ? packFilteredItemIds : EMPTY_HIDDEN_ITEM_IDS,
    })
    if (updates) reorderItemsMut.mutate(updates)
  }

  // Pack/Ready reset actions live in a dedicated hook; it owns the field-scoped
  // cancel/snapshot/optimistic-clear/rollback/invalidate lifecycle on the
  // ['list-items', listId] cache (resetPacked and resetReady each restore only
  // their own field on failure, so they compose) and the failure toasts. The
  // page keeps the PackingProgress wiring, the per-item toggles, and the
  // ready-checks-enabled toggle.
  // The plan link routes "Reset packed" through the food side too (design
  // 8: reset spans both) and keys the pack-state cache it clears.
  const { resetPacked, resetReady } = useListResetActions(listId, listFoodPlanId)


  // ── Derived data ───────────────────────────────────────────────────────────

  // Stable across pack-mode toggles. The naive `useMemo([listItems])` shape
  // mints a fresh Set on every list-items mutation — including isPacked
  // toggles where membership did not change — which busts LibraryPanel's
  // React.memo barrier on the inner CategoryGroup.
  //
  // Fix: derive a primitive membership signature during render (a sorted
  // join of gearItemIds) and key the Set's useMemo on that signature, not
  // on the listItems array reference. When pack-mode flips an item's
  // isPacked but membership is unchanged, gearIdsKey is identical and the
  // Set keeps its prior reference. When the user adds or removes gear,
  // gearIdsKey changes and the Set rebuilds — same behavior as before, but
  // only when it actually matters.
  //
  // The sort is order-independent intentionally: list-item reorder
  // shouldn't invalidate the membership Set. Cost is O(n log n) on the
  // id strings per render, negligible at our row counts.
  const gearIdsKey = listItems
    .map((i) => i.gearItemId)
    .sort()
    .join('|')
  const listItemGearIds = useMemo(
    () => new Set(listItems.map((i) => i.gearItemId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gearIdsKey is the membership signature; depending on listItems would defeat the stability we're after
    [gearIdsKey],
  )

  const grouped = useGroupedListItems(listItems, grouping)
  const orderedPackGroups = orderPackGroups(grouped, grouping.kind)
  const packingTree = useMemo(
    () => mode === 'pack' && packingLocations.length > 0
      ? buildPackingTree(listItems, packingLocations, {
          includeItem: (item) => !item.isWorn,
        })
      : null,
    [listItems, packingLocations, mode],
  )
  const packingCollapseHandlers = useMemo(
    () => new Map(
      packingLocations.map((packingLocation) => [
        packingLocation.id,
        () => togglePackingCollapsed(packingLocation.id),
      ]),
    ),
    [packingLocations, togglePackingCollapsed],
  )

  // ── Packing drag derivations ───────────────────────────────────────────────
  // All lifted from the retired OrganizePackPanel. Read by handleDragEnd and
  // the collision filter, both of which run after commit, so declaring them
  // below the handlers is safe.
  //
  // Deliberately NOT hand-memoized, unlike most derived values on this page.
  // These form a dependency chain rooted in useReorderable's items array, and
  // the React Compiler cannot prove that array is not mutated downstream - so
  // a useMemo over it trips react-hooks/preserve-manual-memoization and, worse,
  // makes the compiler skip optimizing this ENTIRE component, costing far more
  // than the memos save. Plain consts let the compiler memoize them itself,
  // which it does correctly. The work here is a handful of passes over at most
  // 30 locations; the expensive derivations above (packingTree, weightBreakdown)
  // keep their explicit memos because the compiler accepts those.

  // temp- ids are optimistic rows the server has not confirmed. They are not
  // valid drop destinations: a move would name a location that does not exist.
  const realLocations = packingLocations.filter(
    (location) => !location.id.startsWith('temp-'),
  )
  const realLocationIds = new Set(realLocations.map((location) => location.id))
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
  // Everything the packing planner must not reorder against: worn rows (they
  // live in their own trailing section, not inside any location) plus
  // whatever the filters are currently hiding.
  const packingReorderExclusions = new Set([
    ...deriveWornReorderExclusions(listItems),
    ...packFilteredItemIds,
  ])

  // Location drags are constrained to siblings; item drags may target any
  // item or location. Without this filter, closestCenter would happily
  // reparent a section onto a cousin.
  const packingCollisionDetection: CollisionDetection = (args) => closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) =>
      isPackingCollisionTarget(
        String(args.active.id),
        String(container.id),
        siblingLocationIdsById,
      ),
    ),
  })
  const toggleUnassignedCollapse = useCallback(
    () => togglePackingCollapsed('__unassigned__'),
    [togglePackingCollapsed],
  )
  // Food composes into the gear breakdown here, at the page level, so the
  // mobile strip and the desktop table are handed ONE number and cannot
  // disagree about what the pack weighs. Food moves consumable + total only
  // (design 5.3); grams is already rounded once by the projection (5.6).
  const weightBreakdown = useMemo(
    () =>
      withProjectedFood(
        computeWeightBreakdown(listItems, categories),
        foodProjection?.grams ?? 0,
      ),
    [categories, listItems, foodProjection],
  )
  // Mirrors WeightSummary's own render guard. A plan that projects to nothing
  // still earns the panel when it is an undercount, because the "estimate" note
  // is the only thing explaining why the total looks wrong.
  const showWeightSummary =
    listItems.length > 0 || weightBreakdown.totalPackGrams > 0 || incompleteFood

  // Worn rows are always extracted into one trailing section in Edit and Pack.
  // CategoryGroup filters ordinary sections at the leaf so unchanged groups
  // retain their stable item-array references. useStableWornItems similarly
  // preserves the trailing section's array identity across unrelated updates.
  const wornItems = useStableWornItems(grouped, true)

  // gearItems / listItems are read by handlers in sharedGroupProps and the
  // LibraryPanel onAdd / onRemove callbacks, but only at call time (never
  // synchronously during memo computation). Stashing them in refs lets the
  // closures see the latest data without forcing the memo to invalidate on
  // every list-items mutation. Pre-fix, every mutation invalidated
  // `['list-items']` → busted the memo → minted fresh prop references →
  // re-rendered every CategoryGroup + dnd-kit's useSortable per row.
  // Pack-mode checkbox ticks were the dominant render cost.
  //
  // useLatestRef updates the ref in useEffect, not synchronously during
  // render. The handlers below all run after commit (user gestures), so
  // they observe the freshest committed value. Render-time ref writes were
  // banned by react-hooks/refs in React 19 because they tear under
  // concurrent rendering.
  const gearItemsRef = useLatestRef(gearItems)
  const listItemsRef = useLatestRef(listItems)
  // Read at click time by requestRemoveListItem to decide whether a removal
  // needs the container confirm. Same rationale as the two refs above: the
  // removal handler must stay reference-stable, and the locations array
  // changes on every packing write.
  const packingLocationsRef = useLatestRef(packingLocations)

  // Removal + Undo. Owns the "does this destroy more than the row?" rule, the
  // Undo toast and the restore mutation; the page keeps only the container
  // confirm, which needs page-level dialog state.
  const { removeWithUndo } = useListItemRemoval(
    listId,
    (itemId, onRemoved) => deleteItem.mutate(itemId, { onSuccess: onRemoved }),
  )

  // Stable callbacks for LibraryPanel. Inline arrows would mint fresh
  // references on every parent render and defeat LibraryPanel's React.memo
  // on the inner CategoryGroup. addItem / deleteItem follow the same
  // mutation-ref convention as sharedGroupProps below — `.mutate` is read
  // through the live binding at call time, never depended on directly.
  const onLibraryAdd = useCallback(
    (item: GearItem) => addItem.mutate(item),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addItem is a TanStack mutation result; .mutate is stable, the wrapper is not
    [],
  )
  // Every remove-from-list path funnels through here: the picker's unpick
  // toggle, the row kebab, the mobile swipe, and the edit dialog. One function
  // so the rule cannot drift between them.
  //
  // The rule: remove immediately and offer Undo, UNLESS the row backs a
  // packing location - that removal destroys structure beyond the row and
  // cannot be undone, so it asks first.
  const requestRemoveListItem = useCallback(
    (li: ListItemWithGear, returnDialog?: DialogState) => {
      const backedLocation = findBackedLocation(li.id, packingLocationsRef.current)
      if (backedLocation) {
        setDialog({
          type: 'remove-container-item',
          item: li,
          location: backedLocation,
          returnDialog,
        })
        return
      }
      removeWithUndo(li)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- packingLocationsRef is a ref (always stable); removeWithUndo and setDialog are stable
    [],
  )

  const onLibraryRemove = useCallback(
    (item: GearItem) => {
      const li = listItemsRef.current.find((l) => l.gearItemId === item.id)
      if (li) requestRemoveListItem(li)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listItemsRef is a ref (always-stable); requestRemoveListItem is stable
    [],
  )

  // Defined once and mounted by both the desktop aside and mobile drawer. The
  // feature gate removes the selector and leaves the Gear pane active in both.
  const libraryPane = (
    <>
      {/* The panel's Gear | Food toggle (design 8). Two different verbs sharing
          one panel: Gear adds many items, Food picks the ONE plan for this trip.
          The toggle lives out here rather than inside LibraryPanel because that
          component is memoized on reference-stable props and knows only about
          gear. */}
      {FOOD_PLANNING_ENABLED && (
        <LibraryTabs tab={libraryTab} onChange={setLibraryTab} />
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!FOOD_PLANNING_ENABLED || libraryTab === 'gear' ? (
          <LibraryPanel
            gearItems={gearItems}
            categories={categories}
            listItemGearIds={listItemGearIds}
            weightUnit={weightUnit}
            onAdd={onLibraryAdd}
            onRemove={onLibraryRemove}
          />
        ) : (
          <FoodPlanPicker
            plans={foodPlans}
            isPending={foodPlansPending}
            isError={foodPlansError}
            attachedPlanId={list?.foodPlanId ?? null}
            busy={foodLinkBusy}
            onAttach={onAttachFoodPlan}
            onDetach={onDetachFoodPlan}
            onDuplicateAttach={onDuplicateAttachFoodPlan}
          />
        )}
      </div>
    </>
  )

  // Stable callback for CategoryGroup's "+ Add new item" affordance.
  // CategoryGroup's onAddItem signature is (categoryId, data) => void so we
  // can pass ONE memoized handler to both the categorized and uncategorized
  // call sites instead of two fresh inline arrows. addNewItem see prior
  // mutation-ref convention.
  const onAddNewItem = useCallback(
    (categoryId: string | null, data: AddItemData) => {
      if (addingNewItemRef.current) return
      addingNewItemRef.current = true
      addNewItem.mutate(
        { categoryId, data },
        { onSettled: () => { addingNewItemRef.current = false } },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addNewItem: see addItem note
    [],
  )

  // Per-row handler bag passed to every CategoryGroup. Memoized so each
  // category section doesn't re-render on every parent state change.
  //
  // Mutation refs are intentionally NOT in deps. TanStack Query rebuilds the
  // useMutation result object on every render (the wrapper is fresh; only
  // the internal `.mutate` callback is stable), so depending on `updateItem`
  // etc. would defeat the memo and re-create this bag every render. Calling
  // `.mutate` through the live binding is safe: the closure resolves
  // `updateItem.mutate` at call time, which is always the current stable ref.
  // setDialog (the React useState setter) is React-guaranteed stable.
  const sharedGroupProps = useMemo(
    () => ({
      packMode: mode === 'pack',
      // Ready checks are always on. This used to read list.readyChecksEnabled,
      // a per-list opt-in toggled from PackingProgress. The toggle was pure
      // friction - a checklist either has a prep step or you ignore the
      // column - so the feature is now unconditional and the flag is pinned
      // true here rather than threaded through every consumer.
      //
      // The lists.ready_checks_enabled column stays: dropping it means a
      // SQLite table rebuild, and a rebuild of `lists` cascade-deletes
      // list_items (AGENTS.md). It is inert compatibility data now - list
      // duplication still copies it, nothing reads it. is_ready on each item
      // was always persisted independently of this flag, so a list that had
      // ready checks on, collected some ticks, then turned them off gets
      // those ticks back rather than a reset - which is the honest outcome:
      // the data was never deleted, only hidden.
      readyChecksEnabled: true,
      weightUnit,
      isBelowLg,
      // Injects the drag rendering. CategoryGroup itself has no @dnd-kit import
      // (it is on the public share view's path); this is the seam that keeps the
      // library in the authenticated chunk. See SortableCategoryRows.tsx.
      // Location grouping needs `packing-item:` ids so the packing planner
      // (reorder OR cross-location move) sees the drag; category grouping
      // keeps `item:`, whose planner only reorders within a category.
      renderRows: grouping.kind === 'location' ? packingSortableRows : sortableRows,
      showUnpackedOnly,
      showUnreadyOnly,
      onUpdate: (itemId: string, patch: ListItemPatch) => updateItem.mutate({ itemId, patch }),
      onDelete: (itemId: string) => {
        const li = listItemsRef.current.find((item) => item.id === itemId)
        if (li) requestRemoveListItem(li)
      },
      onSaveGearName: (gearId: string, n: string) =>
        updateGearItem.mutate({ id: gearId, patch: { name: n } }),
      onSaveGearDescription: (gearId: string, d: string) =>
        updateGearItem.mutate({ id: gearId, patch: { description: d } }),
      onSaveGearWeight: (gearId: string, w: number) =>
        updateGearItem.mutate({ id: gearId, patch: { weightGrams: w } }),
      onEditGearItem: (gearId: string) => {
        const g = gearItemsRef.current.find((x) => x.id === gearId)
        const li = listItemsRef.current.find((l) => l.gearItem.id === gearId)
        if (g) setDialog({ type: 'edit-gear', gear: g, listItem: li ?? null, saveError: null })
      },
      onDeleteGearItem: (gearId: string) => {
        const g = gearItemsRef.current.find((x) => x.id === gearId)
        if (g) setDialog({ type: 'delete-gear', candidate: g })
      },
      // Quick status - same updateGearItem path the dialog uses, so the
      // existing list-items fan-out (gearItem.status is in the embedded
      // projection) keeps open list views consistent.
      onSetGearStatus: (gearId: string, status: GearItem['status']) =>
        updateGearItem.mutate({ id: gearId, patch: { status } }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above re: mutation refs
    [mode, grouping.kind, weightUnit, isBelowLg, showUnpackedOnly, showUnreadyOnly],
  )

  // The per-row packing menu: move this item to another location, or promote
  // it to a container. This is the keyboard- and touch-reachable equivalent of
  // dragging a row between sections, and the ONLY route to those actions for
  // anyone not using a pointer.
  //
  // Not folded into sharedGroupProps on purpose: it depends on the locations
  // array, which changes on every packing write, and sharedGroupProps is
  // memoized precisely to keep unrelated sections from re-rendering.
  //
  // A plain function, not a useCallback: its inputs are the un-memoized
  // packing derivations above, so a memo could never hit, and pretending
  // otherwise would just be a misleading dependency array. Pack sections
  // therefore re-render with the page, which is what the Organize view this
  // replaced did too.
  const renderPackRowAction = (item: ListItemWithGear) => (
    <MoveToLocationMenu
      itemId={item.id}
      itemName={item.gearItem.name}
      currentLocationId={item.packingLocationId}
      locations={realLocations}
      mobile={isBelowLg}
      disabled={itemDragPending}
      containerCreationDisabled={
        packingLocations.length >= PACKING_LOCATION_CAP || locationCreationPending
      }
      isContainer={false}
      excludedLocationIds={containerMoveExclusions.get(item.id)}
      onMove={(locationId) => requestMove(item.id, locationId)}
      onUseAsContainer={() => createItemContainer.mutate({
        itemId: item.id,
        name: item.gearItem.name,
      })}
    />
  )

  function renderPackingLocationNode(
    node: PackingTreeLocation,
    depth = 0,
  ): ReactNode {
    const location = node.location
    const containerItem = node.containerItem
    return (
      <PackLocationSection
        key={location.id}
        node={node}
        depth={depth}
        groupProps={sharedGroupProps}
        collapsed={packingCollapsed.has(location.id)}
        onCollapsedChange={packingCollapseHandlers.get(location.id)}
        renderRowAction={renderPackRowAction}
        containerAction={containerItem ? (
          <MoveToLocationMenu
            itemId={containerItem.id}
            itemName={containerItem.gearItem.name}
            currentLocationId={containerItem.packingLocationId}
            locations={realLocations}
            mobile={isBelowLg}
            disabled={itemDragPending}
            containerCreationDisabled={
              packingLocations.length >= PACKING_LOCATION_CAP || locationCreationPending
            }
            isContainer
            excludedLocationIds={containerMoveExclusions.get(containerItem.id)}
            onMove={(locationId) => requestMove(containerItem.id, locationId)}
            onStopUsingAsContainer={() => setDeleteLocationTarget(location)}
          />
        ) : undefined}
        itemReorderPending={reorderItemsMut.isPending}
        locationReorderPending={locationReorderPending || locationCreationPending}
        movePending={itemDragPending}
        renaming={renamingLocationId === location.id}
        onStartRename={() => setRenamingLocationId(location.id)}
        onCancelRename={() => setRenamingLocationId(null)}
        onRename={(name) => renameLocation.mutate({ id: location.id, name })}
        onDelete={() => setDeleteLocationTarget(location)}
      >
        {/* Nested containers get their OWN SortableContext. Sorting is
            scoped to a set of siblings, so without a context per level a
            nested section resolves against the root list, the strategy's
            auto-shift computes against the wrong neighbours, and a nested
            reorder produces no usable drop. */}
        {node.children.length > 0 && (
          <SortableContext
            items={node.children.map((child) =>
              makeDnDId('packing-location', child.location.id),
            )}
            strategy={verticalListSortingStrategy}
          >
            {node.children.map((child) => renderPackingLocationNode(child, depth + 1))}
          </SortableContext>
        )}
      </PackLocationSection>
    )
  }

  // ── Loading / not found ────────────────────────────────────────────────────

  // Cold-load window: lists query in-flight, no resolved list yet. Render a
  // neutral skeleton instead of "List not found" — the latter is reserved
  // for the genuinely-missing case (deleted list, stale deep link, another
  // account's list). Without this gate, every cold load on /lists/:id
  // flashed "List not found" for ~1 paint before the query resolved.
  if (listsLoading && !list) {
    return <ListDetailStatus title="Loading list..." busy />
  }

  if (!list) {
    // Terminal "missing list" state: deleted list, stale deep link, or a
    // list the session can't see. MobilePrimaryNav suppresses itself on
    // /lists/:id (the page is expected to render its own richer bar), and
    // the mobile top-nav menu only exposes Help/Settings/Sign out. Without
    // an in-content action here, a mobile user lands in a navigation
    // dead-end. Render an empty state with a Back-to-lists link so there's
    // always a way out.
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <p className="text-base font-medium text-gray-700">List not found</p>
        <p className="text-sm text-gray-500">
          This list may have been deleted or the link is no longer valid.
        </p>
        <Link
          to="/lists"
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Back to lists
        </Link>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const editDialogListItem = dialog?.type === 'edit-gear' ? dialog.listItem : null

  return (
    <div className="flex flex-col gap-4 print:pb-0">
      {/* Two-column grid (sidebar renders only in Edit; Organize returned
          through its exclusive branch above and Pack stays focused). */}
      <div className="flex gap-4 items-start">
        {/* LEFT column — Lists switcher above the gear library picker.
            Hidden in pack mode on desktop so the user can focus on packing.
            DesktopListsPanel is the primary desktop workflow for list
            switching/management; /lists remains the mobile management page
            and a desktop fallback (e.g. when no lists exist). */}
        {mode === 'edit' && (
          <aside
            className="hidden lg:flex w-80 shrink-0 flex-col gap-3 sticky self-start print:hidden"
            style={{ top: '1rem', height: 'calc(100vh - 2rem)' }}
          >
            {/* shrink-0 + max-h-72 keeps the lists switcher compact even
                with many lists: the panel scrolls internally beyond that
                cap and the gear picker below always has room. */}
            <DesktopListsPanel
              lists={lists}
              currentListId={listId}
              className="shrink-0 max-h-72"
            />

            <div className={`flex flex-col min-h-0 flex-1 ${FLAT_TABLE_SURFACE}`}>
              {libraryPane}
            </div>
          </aside>
        )}

        {/* RIGHT column — list document. Title toolbar + weight table +
            items (always visible; packing checkbox column appears in pack
            mode). Pack mode narrows from 7xl (AppShell main) to 3xl +
            mx-auto so the sparser layout reads as focused rather than
            stretched across the full width the missing sidebar leaves
            behind. */}
        <div className={`flex-1 min-w-0 space-y-4 ${mode === 'pack' ? 'max-w-3xl mx-auto' : ''}`}>
          <ListDocumentToolbar
            list={list}
            mode={mode}
          />

          {detailDataError ? (
            <ListDetailStatus
              title="Couldn't load list details"
              body="Check your connection and try again."
              onRetry={retryDetailData}
              showBackToLists
            />
          ) : detailDataLoading ? (
            <ListDetailStatus title="Loading list details..." busy />
          ) : (
            <>
              {/* Pack-mode progress bar. When Food is enabled it renders for a food-only list too:
                  a list with no gear but an attached plan still has packing
                  to track. With a plan attached it waits for foodPack.isReady
                  (unless the food side errored - then gear-only totals plus
                  the banner below are the honest state): gear-only totals
                  during the food fetch would show wrong denominators and
                  could claim "All packed!" when unpacked food remains.
                  !foodLinkBusy for the same reason: while a link mutation is
                  settling, hasFoodPlan reflects an OPTIMISTIC link (a
                  mid-detach render says "no plan" even though the detach may
                  fail), so either generation's totals would be a guess -
                  hold the bar for the sub-second settle instead. */}
              {mode === 'pack' && !foodLinkBusy &&
                (!hasFoodPlan || foodPack.isReady || foodPack.isError) &&
                (listItems.length > 0 || foodPack.packableTotal > 0) && (
                <div className="print:hidden">
                  <PackingProgress
                    total={listItems.length + foodPack.packableTotal}
                    packed={listItems.filter((i) => i.isPacked).length + foodPack.packedTotal}
                    onReset={resetPacked}
                    showUnpackedOnly={showUnpackedOnly}
                    onToggleShowUnpackedOnly={() => setShowUnpackedOnly((v) => !v)}
                    showUnreadyOnly={showUnreadyOnly}
                    onToggleShowUnreadyOnly={() => setShowUnreadyOnly((v) => !v)}
                    readyChecks={{
                      ready: listItems.filter((i) => i.isReady).length,
                      total: listItems.length,
                      onResetReady: resetReady,
                    }}
                  />
                </div>
              )}

              {/* Notes + Weight summary — side by side on desktop, with Notes
                  getting the wider column. Both hidden in pack mode: neither
                  is active-use information while packing (PackingProgress
                  above is the only summary the packer needs). The entire grid
                  renders nothing in pack mode.
                  WeightSummary owns its own mobile-vs-desktop split: below lg
                  it's a compact Base/Total/Consumable strip with a collapsed
                  "Weight breakdown" disclosure, at lg+ it's the existing
                  PanelCard table. */}
              {mode === 'edit' && (
                // Two columns exactly when WeightSummary renders something -
                // the same condition it guards itself with. Keying this on
                // listItems alone hid the weight of a food-only list; keying it
                // on "a plan is attached" would reserve an empty column for a
                // plan that projects to nothing.
                <div className={`print:hidden grid gap-4 ${showWeightSummary ? 'grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]' : 'grid-cols-1'}`}>
                  <PanelCard
                    title="Notes"
                    headerAction={
                      !notesEditing && (
                        <button
                          type="button"
                          onClick={() => setNotesEditing(true)}
                          aria-label="Edit notes"
                          title="Edit notes"
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        >
                          <Pencil size={13} />
                        </button>
                      )
                    }
                  >
                    <NotesEditor
                      key={list.id}
                      initial={list.description ?? ''}
                      onSave={(v) => notesMut.mutate(v)}
                      editing={notesEditing}
                      onEditingChange={setNotesEditing}
                    />
                  </PanelCard>
                  <WeightSummary
                    items={listItems}
                    categories={categories}
                    breakdown={weightBreakdown}
                    incompleteFood={incompleteFood}
                  />
                </div>
              )}

              {/* Food, between the summary and the gear groups. Edit mode
                  renders the derived Food row; pack mode expands it into the
                  per-food checklist (FoodPackSection). */}
              {FOOD_PLANNING_ENABLED && mode === 'pack' && foodPack.isError && (
                <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Couldn&apos;t load this list&apos;s food checklist. Gear packing
                  still works.
                </p>
              )}
              {/* A food-only list has NOTHING else on the page while the
                  checklist data loads (the progress bar above also waits),
                  so say what's happening instead of rendering blank. Gear
                  lists skip this: their item groups render regardless. */}
              {mode === 'pack' && hasFoodPlan && listItems.length === 0 &&
                !foodPack.isReady && !foodPack.isError && (
                  <p className={`mt-4 ${FLAT_TABLE_META_TEXT}`}>
                    Loading food checklist...
                  </p>
                )}
              {FOOD_PLANNING_ENABLED && mode === 'pack' && (
                <FoodPackSection
                  rows={foodPack.rows}
                  weightUnit={weightUnit}
                  showUnpackedOnly={showUnpackedOnly}
                  onToggle={foodPack.toggle}
                />
              )}
              {mode === 'edit' && foodProjectionError && (
                <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Couldn&apos;t load this list&apos;s food plan, so the weight below leaves
                  food out.
                </p>
              )}
              {mode === 'edit' && foodProjection && (
                <FoodRow
                  projection={foodProjection}
                  weightUnit={weightUnit}
                  busy={foodLinkBusy}
                  onDetach={onDetachFoodPlan}
                />
              )}

              {/* Packing-location admin, lifted from the retired Organize
                  view. Pack mode is the organizer now, so building the
                  structure and filling it happen in one place instead of
                  across two tabs. Edit mode never shows this: locations are a
                  packing concern. */}
              {mode === 'pack' && (
                <PackLocationControls
                  locations={packingLocations}
                  creationPending={locationCreationPending}
                  draft={newLocationName}
                  onDraftChange={setNewLocationName}
                  onCreate={(name) => {
                    createLocation.mutate(name)
                    setNewLocationName('')
                  }}
                />
              )}

              {/* Items grouped by category */}
              {listItems.length === 0 ? (
                // A list with a plan but no gear is not empty - it has food. This
                // asks the LIST ROW, not the projection: the projection is absent
                // while the plan is still loading and after a failed fetch, and
                // neither of those means the list became empty.
                hasFoodPlan ? null : <EmptyListCell onMobileAdd={() => setDrawerOpen(true)} />
              ) : (() => {
                const activeParsed = activeId ? parseDnDId(activeId) : null
                const activeItem =
                  activeParsed?.kind === 'item' ? (listItemsById.get(activeParsed.id) ?? null) : null
                const activePackingItem =
                  activeParsed?.kind === 'packing-item'
                    ? (listItemsById.get(activeParsed.id) ?? null)
                    : null
                return (
                  <div className="flex flex-col gap-3">
                    <DndContext
                      sensors={sensors}
                      // Location grouping needs the packing filter: it keeps a
                      // section drag from landing on a cousin (which would
                      // silently reparent it) and keeps an item drag from
                      // colliding with things it can never be dropped on.
                      // Category grouping has one kind of target and needs no
                      // filtering.
                      collisionDetection={
                        grouping.kind === 'location' ? packingCollisionDetection : closestCenter
                      }
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragCancel={handleDragCancel}
                    >
                      {/* Categories render in their global sortOrder but are not
                          reorderable here — category-level DnD is /gear-only. Each
                          CategoryGroup still renders a per-category SortableContext
                          internally so items reorder within their category. */}
                      {mode === 'pack' && packingGroupingState.showErrorNotice && (
                        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          Couldn&apos;t load packing locations. Showing the last available grouping.
                        </p>
                      )}
                      {grouping.kind === 'location' && packingTree ? (
                        <>
                          {/* Unassigned is a drop target but not sortable: it
                              is not a location row and has no sortOrder.
                              Dragging a row here is how you take it back out
                              of a container. */}
                          <DroppableUnassignedSection>
                            <CategoryGroup
                              key="__unassigned__"
                              name="Unassigned"
                              categoryId={null}
                              regionKey="packing-unassigned"
                              collapsed={packingCollapsed.has('__unassigned__')}
                              onCollapsedChange={toggleUnassignedCollapse}
                              items={packingTree.unassignedItems}
                              {...sharedGroupProps}
                              renderRowAction={renderPackRowAction}
                              reorderPending={reorderItemsMut.isPending}
                            />
                          </DroppableUnassignedSection>
                          <SortableContext
                            items={packingTree.roots.map((node) =>
                              makeDnDId('packing-location', node.location.id),
                            )}
                            strategy={verticalListSortingStrategy}
                          >
                            {packingTree.roots.map((node) => renderPackingLocationNode(node))}
                          </SortableContext>
                        </>
                      ) : orderedPackGroups.map((group) => {
                          const definition = group.group
                          if (definition) {
                            return (
                              <CategoryGroup
                                key={definition.id}
                                name={definition.name}
                                categoryId={definition.id}
                                items={group.items}
                                {...sharedGroupProps}
                                reorderPending={reorderItemsMut.isPending}
                                baseSubtotalGrams={baseGramsForCategory(weightBreakdown, definition.id)}
                                consumableSubtotalGrams={consumableGramsForCategory(weightBreakdown, definition.id)}
                                onAddItem={onAddNewItem}
                              />
                            )
                          }
                          return (
                            <CategoryGroup
                              key="__uncategorized__"
                              name="Uncategorized"
                              categoryId={null}
                              items={group.items}
                              {...sharedGroupProps}
                              reorderPending={reorderItemsMut.isPending}
                              baseSubtotalGrams={baseGramsForCategory(weightBreakdown, null)}
                              consumableSubtotalGrams={consumableGramsForCategory(weightBreakdown, null)}
                              onAddItem={onAddNewItem}
                            />
                          )
                        })}
                      <DragOverlay dropAnimation={null}>
                        {activeItem ? (
                          <ItemRow item={activeItem} weightUnit={weightUnit} isBelowLg={isBelowLg} />
                        ) : activePackingItem ? (
                          // Location grouping drags a `packing-item:`, and the
                          // full ItemRow clone is too heavy to read mid-drag
                          // when the target is another section rather than a
                          // slot. A name chip is the whole payload.
                          <div className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm shadow-lg">
                            {activePackingItem.gearItem.name}
                          </div>
                        ) : activeLocation ? (
                          <div className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold shadow-lg">
                            {activeLocation.name}
                          </div>
                        ) : null}
                      </DragOverlay>
                      {/* Packing drags have no visible result for a screen
                          reader otherwise: the row simply stops being where
                          it was. */}
                      <div className="sr-only" aria-live="polite" aria-atomic="true">
                        {announcement}
                      </div>
                    </DndContext>

                    {/* Worn section — visible in both normal and pack mode when
                        at least one worn item exists.
                        Sits outside the DndContext: it isn't a reorder target
                        (no renderRows), and worn items don't render inside
                        their original category or location sections.
                        Spreads the
                        same sharedGroupProps every in-category section uses so
                        row chrome stays consistent — including readyChecksEnabled
                        (Ready checkbox column in Pack mode), onSetGearStatus,
                        edit/delete handlers, weight unit, and breakpoint.
                        Worn-specific overrides come after the spread
                        so they win: section name "Worn", the stable wornItems
                        list, and renderRows={undefined} (no drag). The items
                        array walks categories in display order so in-section
                        order is stable and predictable. regionKey is explicit
                        because this section passes no categoryId: without it
                        the collapsible region derives the same
                        'cat-region-uncategorized' id as the real Uncategorized
                        section above, duplicating the id in the document and
                        pointing both chevrons' aria-controls at one target. */}
                    {wornItems.length > 0 && (
                      <CategoryGroup
                        {...sharedGroupProps}
                        name="Worn"
                        items={wornItems}
                        regionKey="worn"
                        wornSection
                        // Unlabelled on purpose: the section title already says
                        // Worn, and this is the canonical list-level worn total.
                        // It must NOT look itself up by category - it has no
                        // categoryId, and a null lookup would hand it
                        // Uncategorized's base figure.
                        //
                        // Caveat, deliberately accepted: computeWeightBreakdown
                        // buckets the defensive isConsumable+isWorn state as
                        // consumable, while this section's grouper selects on
                        // isWorn. So a dual-flagged row would render here while
                        // its weight sat in consumableGrams. A DB CHECK forbids
                        // that state; the aggregator only tolerates it so an
                        // optimistic-update glitch cannot crash the page. Do not
                        // "fix" it by summing rows here - that reintroduces the
                        // second definition of the metric this change removed.
                        subtotalGrams={weightBreakdown.wornGrams}
                        renderRows={undefined}
                      />
                    )}
                  </div>
                )
              })()}
            </>
          )}
        </div>
      </div>

      {/* Mobile gear-library drawer — mirrors the desktop left aside.
          Slides in from the LEFT, dismissed by overlay tap, the close
          button, or Escape. Stays open across multiple add/remove
          actions so the user can build up a list quickly.

          JS-gated by isBelowLg so desktop genuinely doesn't mount the
          drawer; React.lazy on the wrapper means desktop also never
          fetches the Radix Dialog chunk. */}
      {isBelowLg && (
        <div className="print:hidden">
          <Suspense fallback={null}>
            <ListSidebarDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              title={LIBRARY_TAB_LABELS[libraryTab]}
            >
              <div className="flex h-full flex-col">{libraryPane}</div>
            </ListSidebarDrawer>
          </Suspense>
        </div>
      )}

      {/* Gear-item edit (reached from the row tap on mobile or the kebab →
          Edit on any viewport). Reuses GearItemDialog and, when a list item
          accompanies the gear item, renders an "On this list" section with
          quantity / worn / consumable controls.
          Save runs sequentially: gear first, then the per-list patch. If
          the gear write fails, nothing is applied. If the gear write
          succeeds but the list write fails, the gear changes are committed
          but the list item is unchanged — surfaced via dialog.saveError so
          the user can retry (PATCH is idempotent on the gear side) or
          close to keep the partial result intentionally.
          updateGearItem already invalidates ['list-items'] (broad) so
          other lists pick up the change. */}
      {dialog?.type === 'edit-gear' && (
        <GearItemDialog
          key={dialog.gear.id}
          categories={categories}
          item={dialog.gear}
          listContext={
            editDialogListItem
              ? {
                  quantity: editDialogListItem.quantity,
                  isWorn: editDialogListItem.isWorn,
                  isConsumable: editDialogListItem.isConsumable,
                }
              : undefined
          }
          saving={updateGearItem.isPending || updateItem.isPending}
          saveError={dialog.saveError}
          onClose={() => setDialog(null)}
          onCreateCategory={(categoryName) => addCategory.mutateAsync(categoryName)}
          onSave={(gearPatch, listPatch) => {
            void (async () => {
              const gearTarget = dialog.gear
              const listTarget = dialog.listItem
              // Reset prior error so the user sees fresh state for this attempt.
              // Spread the variant so we keep the targets while clearing saveError.
              setDialog({ ...dialog, saveError: null })
              try {
                await updateGearItem.mutateAsync({ id: gearTarget.id, patch: gearPatch })
              } catch {
                setDialog({ ...dialog, saveError: "Couldn't save gear changes. No changes were applied." })
                return
              }
              if (listPatch && listTarget) {
                try {
                  await updateItem.mutateAsync({ itemId: listTarget.id, patch: listPatch })
                } catch {
                  setDialog({
                    ...dialog,
                    saveError:
                      "Saved gear changes, but couldn't update this list item. Try again, or close to keep just the gear changes.",
                  })
                  return
                }
              }
              setDialog(null)
            })()
          }}
          onRemoveFromList={
            editDialogListItem
              ? () => {
                  // Close the editor first: a pristine item removes with no
                  // confirm, and leaving the dialog open over a row that no
                  // longer exists is worse than the friction we just removed.
                  // If a confirm IS needed, requestRemoveListItem re-opens on
                  // top of this and `returnDialog` restores the editor on
                  // cancel (both setDialog calls batch; the confirm wins).
                  setDialog(null)
                  requestRemoveListItem(editDialogListItem, dialog)
                }
              : undefined
          }
          onDeleteFromInventory={
            dialog.listItem
              ? () => {
                  const target = dialog.gear
                  setDialog({ type: 'delete-gear', candidate: target, returnDialog: dialog })
                }
              : undefined
          }
        />
      )}


      {/* The one removal that still asks. Ordinary removals are immediate
          with an Undo toast; this row backs a packing location, so removing
          it cascades that location away and drops everything inside it to
          Unassigned. Undo cannot rebuild that (see use-list-item-removal.ts),
          so the dialog names the consequence instead of asking in the
          abstract. Still no Undo offered afterwards - the confirm IS the
          safeguard here. */}
      {dialog?.type === 'remove-container-item' && (
        <ConfirmDialog
          title="Remove container from list"
          message={`"${dialog.item.gearItem.name}" is being used as a packing container. Removing it from this list also deletes the "${dialog.location.name}" container, and anything packed inside it moves to Unassigned. This can't be undone. The gear item stays in your library.`}
          confirmLabel="Remove"
          dangerous
          onCancel={() => setDialog(dialog.returnDialog ?? null)}
          onConfirm={() => {
            const target = dialog.item
            setDialog(null)
            deleteItem.mutate(target.id)
          }}
        />
      )}

      {/* Delete-from-inventory confirm (reached from the kebab). Removes the
          gear item from the library and cascades to every list item that
          references it (ON DELETE CASCADE on gear_item_id). */}
      {dialog?.type === 'delete-gear' && (
        <ConfirmDialog
          title="Delete from inventory"
          message={`This will remove "${dialog.candidate.name}" from your inventory and from any list it appears on. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          // Cancel restores the prior dialog when one was captured (the
          // user launched delete from inside GearItemDialog). Otherwise
          // close to the page.
          onCancel={() => setDialog(dialog.returnDialog ?? null)}
          onConfirm={() => {
            const target = dialog.candidate
            setDialog(null)
            deleteGearItem.mutate(target.id)
          }}
        />
      )}

      {/* Delete a packing location / stop using an item as a container.
          Lifted from the retired Organize view. Deleting a location does not
          touch the gear in it - its items fall back to Unassigned - so this
          is recoverable by re-creating the location, unlike removing the
          backing ITEM (which is why that path has its own confirm). */}
      {deleteLocationTarget && (
        <ConfirmDialog
          title={deleteLocationTarget.containerListItemId === null
            ? 'Delete packing location'
            : 'Stop using item as container'}
          message={deleteLocationTarget.containerListItemId === null
            ? `Delete "${deleteLocationTarget.name}"? Its items will move to Unassigned.`
            : `Stop using "${deleteLocationTarget.name}" as a container? Its items will move to Unassigned.`}
          confirmLabel={deleteLocationTarget.containerListItemId === null ? 'Delete' : 'Stop using'}
          dangerous={deleteLocationTarget.containerListItemId === null}
          onCancel={() => setDeleteLocationTarget(null)}
          onConfirm={() => {
            const target = deleteLocationTarget
            setDeleteLocationTarget(null)
            removeLocation.mutate(target.id)
          }}
        />
      )}

      {/* Mobile-only bottom action bar. Gear / Lists / Add / Options
          in normal mode; Options is dropped in pack mode (pack-mode
          controls live inline in PackingProgress, and List options is
          list-admin not needed mid-pack). The view navigation above stays
          available independently. lg:hidden inside the bar
          itself, so desktop never renders it. */}
      <MobileListActionBar list={list} mode={mode} />

    </div>
  )
}

// Create a packing location, plus the first-run nudge. Lifted from the
// retired OrganizePackPanel: a list with no locations groups by gear category
// (selectPackGrouping), which is a fine checklist but not a packing plan, so
// this is the on-ramp from one to the other.
function PackLocationControls({
  locations,
  creationPending,
  draft,
  onDraftChange,
  onCreate,
}: {
  locations: PackingLocation[]
  creationPending: boolean
  draft: string
  onDraftChange: (value: string) => void
  onCreate: (name: string) => void
}) {
  const trimmed = draft.trim()
  const atCap = locations.length >= PACKING_LOCATION_CAP
  // noValidate makes maxLength inert for SUBMIT purposes (AGENTS.md), so the
  // length check is manual here and the server is the real gate.
  const canSubmit = Boolean(trimmed) && trimmed.length <= 60 && !atCap && !creationPending

  return (
    <div className="space-y-3 print:hidden">
      <form
        noValidate
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSubmit) return
          onCreate(trimmed)
        }}
      >
        <label className="sr-only" htmlFor="new-packing-location">New packing location</label>
        <input
          id="new-packing-location"
          value={draft}
          maxLength={60}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Add a location, e.g. Main pack"
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={15} /> Add
        </button>
      </form>
      {atCap ? (
        <p className="text-sm text-amber-800">
          This list has the maximum of {PACKING_LOCATION_CAP} packing locations.
        </p>
      ) : null}

      {locations.length === 0 ? (
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
                disabled={creationPending}
                onClick={() => onCreate(name)}
                className="rounded-md border border-blue-300 bg-white px-2.5 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ListDetailStatus({
  title,
  body,
  busy = false,
  onRetry,
  showBackToLists = false,
}: {
  title: string
  body?: string
  busy?: boolean
  onRetry?: () => void
  showBackToLists?: boolean
}) {
  return (
    <div
      className="flex h-64 flex-col items-center justify-center gap-3 text-center"
      aria-busy={busy || undefined}
    >
      <div className="space-y-2">
        <p className="text-base font-medium text-gray-700">{title}</p>
        {body ? <p className="text-sm text-gray-500">{body}</p> : null}
      </div>
      {(onRetry || showBackToLists) ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
          ) : null}
          {showBackToLists ? (
            <Link
              to="/lists"
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to lists
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
