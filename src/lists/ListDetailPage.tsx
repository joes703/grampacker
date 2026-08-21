import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
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
  updateList,
  updateListItem,
  reorderListItems,
  reorderPackListItems,
  reorderPackingLocations,
  makeOptimisticReorder,
  makeOptimisticUpdate,
  type ListItemPatch,
} from '../lib/queries'
import { makeOptimisticUnionPackReorder } from '../lib/queries/optimistic'
import { mutationKeys } from '../lib/queries/keys'
import type { Category, GearItem, ListItemWithGear, List, PackingLocation } from '../lib/types'
import { authClient } from '../lib/auth-client'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg, useIsBelowXl } from '../lib/use-breakpoint'
import { useReorderable } from '../lib/use-reorderable'
import { useLatestRef } from '../lib/use-latest-ref'
import {
  writeLastListPath,
  readLastListPath,
  clearLastListPath,
  getListIdFromListPath,
} from '../lib/last-list-path'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import {
  assignPackRankSlots,
  assignSortOrderSlots,
} from '../lib/grouping'
import { useGroupedListItems } from '../lib/use-grouped-list-items'
import { useStableWornItems } from '../lib/use-stable-worn-items'
import {
  baseGramsForCategory,
  computeListWeightBreakdown,
  consumableGramsForCategory,
} from '../lib/weight-breakdown'

// One shared empty array for every "no food rows here" case: Edit mode, where
// Pack's food derivations are switched off, and a bag that holds no food. It
// reaches CategoryGroup as a prop, and CategoryGroup is memoized - a fresh []
// literal would be a new identity every render and defeat that memo.
const EMPTY_FOOD_ITEMS: FoodItemResponse[] = []

import WeightSummary from './WeightSummary'
import FoodView from './FoodView'
import type { FoodItemResponse, ListFoodResponse } from '../../shared/food'
import LibraryPanel from './LibraryPanel'
import DesktopListsPanel from './DesktopListsPanel'
import {
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import MobileListActionBar from './MobileListActionBar'
import ListDocumentToolbar from './ListDocumentToolbar'
import EmptyListCell from './EmptyListCell'
import PackingProgress from './PackingProgress'
import { useListResetActions } from './use-list-reset-actions'
import { useListItemActions } from './use-list-item-actions'
import { useListFood } from './use-list-food'
import { resolveRemovalPlan } from './list-item-removal'
import { useListGearActions } from './use-list-gear-actions'
import NotesEditor from './NotesEditor'
import { type AddItemData } from './use-quick-add-form'
import CategoryGroup, { type SectionIdentity } from './CategoryGroup'
import { packingSortableRows, sortableRows } from './SortableCategoryRows'
import PanelCard from './PanelCard'
import ItemRow from './ItemRow'
import RowIconButton from '../components/RowIconButton'
import StatusPanel from '../components/StatusPanel'
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
import {
  buildContainerMoveExclusions,
  buildPackingTree,
  buildSiblingLocationIdsById,
  deriveWornReorderExclusions,
  type PackingTreeLocation,
} from './packing-tree'
import { usePackingLocationActions } from './use-packing-location-actions'
import { isPackingCollisionTarget, planPackingRowDragEnd } from './packing-dnd'
import {
  nextUnionPackRankFor,
  packRowName,
  type UnionRankUpdates,
} from './pack-rows'
import MoveToLocationMenu from './MoveToLocationMenu'
import { PackLocationSection } from './PackLocationSection'
import { PlacementProvider, usePlacement } from './placement-context'
import { planPlacementWithinLocation } from './placement-plan'
import { DroppableUnassignedSection } from './SortablePackSection'
import { PACKING_LOCATION_CAP } from '../lib/caps'

// TRANSPLANT NOTE (print): the old page rendered PrintListHeader above the
// grid (a print-only document header) and carried print:* utility classes
// tuned around it. The header returns with the CSV/print slice; the
// print:hidden classes on transient chrome are kept since they're inert
// without a print stylesheet consumer.
// TRANSPLANT NOTE (tabs): the old page rendered ListWorkspaceTabs (a
// Gear/Pack two-tab remnant) above ListDocumentToolbar. The toolbar now owns
// direct List / Organize / Pack navigation; the old workspace tab strip returns

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
  // The ONLY removal that asks. A list item can be USED AS a packing
  // container, and removing it removes that container too, moving its
  // contents to Unassigned - intended, but more than the row that was
  // clicked. Every other removal goes straight through. See
  // list-item-removal.ts for the rule.
  //
  // `location` is null in the fail-safe case: the packing-locations lookup
  // failed, so we could not establish whether this row is a container. Asking
  // without being able to name one is worse copy than the normal path, and
  // better than removing a container unannounced.
  | {
      type: 'remove-container-item'
      item: ListItemWithGear
      location: PackingLocation | null
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
// reorder source nor a reorder neighbor: the sort slots are computed from the
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
  mode,
  locations,
  hiddenItemIds,
}: {
  activeId: string
  overId: string | undefined
  items: ListItemWithGear[]
  groupingKind: 'category' | 'location'
  /** Which VIEW the drag happened in. Decides which ordering is written -
   *  see the note in the category branch for why grouping.kind cannot. */
  mode: ListDetailMode
  locations: PackingLocation[]
  // Rows currently filtered out of the rendered list (see
  // deriveFilteredItemIds). Empty set = nothing hidden.
  hiddenItemIds: ReadonlySet<string>
}):
  | { kind: 'pack'; updates: UnionRankUpdates }
  | { kind: 'list'; updates: { id: string; sortOrder: number }[] }
  | null {
  if (groupingKind === 'location') {
    const excludedItemIds = derivePackReorderExclusions(items, locations)
    for (const itemId of hiddenItemIds) excludedItemIds.add(itemId)
    // `item:`-kind ids in location grouping: a gear-only cohort reorder
    // (packing rows carry `packing-item:` ids and never reach this branch).
    // A gear-only permutation is still a valid UNION permutation - a subset's
    // ranks are a subset of the union multiset - so the food half is empty.
    if (overId === undefined || activeId === overId) return null
    const active = parseDnDId(activeId)
    const over = parseDnDId(overId)
    if (active?.kind !== 'item' || over?.kind !== 'item') return null
    const activeItem = items.find((i) => i.id === active.id)
    const overItem = items.find((i) => i.id === over.id)
    if (!activeItem || !overItem) return null
    if (excludedItemIds.has(activeItem.id) || excludedItemIds.has(overItem.id)) return null
    if (activeItem.packingLocationId !== overItem.packingLocationId) return null
    const locationItems = items
      .filter((i) =>
        i.packingLocationId === activeItem.packingLocationId &&
        !excludedItemIds.has(i.id),
      )
      .toSorted((a, b) => a.packSortOrder - b.packSortOrder)
    const oldIndex = locationItems.findIndex((i) => i.id === active.id)
    const newIndex = locationItems.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null
    // Location grouping is Pack view, so this writes the PACK rank. Tagging
    // the result rather than returning a bare array is what keeps the caller
    // from posting a pack permutation to the document-order endpoint - the two
    // payloads are structurally similar enough that an untagged union would be
    // an easy mistake to make and a hard one to see.
    return {
      kind: 'pack' as const,
      updates: {
        items: assignPackRankSlots(arrayMove(locationItems, oldIndex, newIndex)),
        foodItems: [],
      },
    }
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

  const categoryItems = items
    .filter((item) =>
      item.gearItem.categoryId === categoryId &&
      !hiddenItemIds.has(item.id) &&
      // Worn rows are pulled out into their own section and are not draggable,
      // but they were still landing in this planning array - so a category
      // holding one produced a permutation naming a worn row, which the
      // pack-order route rejects outright. The effect was a 400 on an ordinary
      // drag in any list with worn gear. Location grouping already excluded
      // them (derivePackReorderExclusions); the category fallback did not.
      //
      // Only in pack mode: List view genuinely renders worn rows inside their
      // categories, so excluding them there would plan against rows the user
      // is not looking at.
      !(mode === 'pack' && item.isWorn),
    )
    // Sorted by whichever order the user is actually looking at. The cache is
    // canonically in document order, so the pack fallback has to re-sort or it
    // would compute the move against a sequence not on screen.
    .toSorted((a, b) =>
      mode === 'pack'
        ? a.packSortOrder - b.packSortOrder
        : a.sortOrder - b.sortOrder,
    )
  const oldIndex = categoryItems.findIndex((item) => item.id === active.id)
  const newIndex = categoryItems.findIndex((item) => item.id === over.id)
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null
  const moved = arrayMove(categoryItems, oldIndex, newIndex)
  // MODE decides, not grouping.kind. Pack falls back to category grouping
  // until a list has its first packing location - which is every list on its
  // first visit - and a drag there is still a Pack action. Keying this on
  // grouping.kind would leave the original bug alive on exactly that surface,
  // and then creating a first location would reveal a stale pack order nobody
  // had arranged.
  //
  // Permuting a category-sized SUBSET of the Unassigned cohort is still a
  // valid cohort permutation: a subset's ranks are a subset of the multiset,
  // so redistributing them among themselves leaves the cohort intact.
  return mode === 'pack'
    ? {
        kind: 'pack' as const,
        updates: { items: assignPackRankSlots(moved), foodItems: [] },
      }
    : { kind: 'list' as const, updates: assignSortOrderSlots(moved) }
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
  //
  // isError and isFetching are threaded through for the same reason isPending
  // is, and they matter more: the `= []` default made a FAILED lists fetch
  // indistinguishable from a successful empty one, so a dropped connection
  // rendered the terminal "List not found" state - copy that tells the user
  // their list was deleted - with no retry.
  //
  // Both flags are passed RAW rather than pre-reduced here, because the
  // question they answer ("is this list actually missing, or do we just not
  // know?") needs `list`, which only the inner resolves. In TanStack Query v5
  // a failed background refetch sets status to 'error' while KEEPING the
  // cached collection, so `isError` alone cannot be used as a terminal
  // failure signal - see the branches in ListDetailInner.
  const {
    data: listsData,
    isPending: listsLoading,
    isFetching: listsFetching,
    isPaused: listsPaused,
    isError: listsIsError,
    refetch: refetchLists,
  } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
  })
  const lists = listsData ?? []
  const retryLists = useCallback(() => {
    void refetchLists()
  }, [refetchLists])

  // key={routeId} forces a fresh ListDetailInner instance per list, so local
  // state (open dialogs, draft inputs, etc.) doesn't leak when the user
  // switches lists.
  return (
    <ListDetailInner
      key={routeId}
      listId={routeId}
      lists={lists}
      listsLoading={listsLoading}
      listsFetching={listsFetching}
      listsPaused={listsPaused}
      listsIsError={listsIsError}
      onRetryLists={retryLists}
    />
  )
}

function ListDetailInner({
  listId,
  lists,
  listsLoading,
  listsFetching,
  listsPaused,
  listsIsError,
  onRetryLists,
}: {
  listId: string
  lists: List[]
  listsLoading: boolean
  listsFetching: boolean
  listsPaused: boolean
  listsIsError: boolean
  onRetryLists: () => void
}) {

  // "Whatever we have is not a settled answer from the server." Any of the
  // three means the collection in hand may be incomplete or stale, so an
  // absent list proves nothing.
  //
  // listsPaused is the one that is easy to miss: offline, a fetch sits at
  // fetchStatus 'paused', which makes isFetching FALSE. A warm cache that
  // predates the list being shared with this user would otherwise look like a
  // settled, successful absence and render "List not found".
  const listsIndeterminate = listsLoading || listsFetching || listsPaused
  const qc = useQueryClient()
  // Owner for the last-list pointer: the shortcut it feeds (RootRedirect) only
  // follows a pointer the current account wrote, so both the write and the
  // self-heal read below are scoped to this session's user. Guaranteed present
  // here (this page renders inside RequireSession); read for the id only.
  const { data: session } = authClient.useSession()
  const ownerId = session?.user.id ?? null
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
  // Only the Pack "Add gear" trigger reads this: it exists exactly in the
  // band where Pack has neither the aside (xl+) nor the mobile action bar's
  // Add (below lg). A JS gate rather than `xl:hidden` so the control is
  // absent from the DOM where it does not apply - a CSS-hidden button still
  // answers queries, and this file's viewport tests would pass vacuously.
  const isBelowXl = useIsBelowXl()
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
  // The edit-gear save currently awaiting a response, held as the exact DialogState
  // object it was submitted from. Same device as GearLibraryPage's: it is both the
  // dialog's own pending flag (the mutations behind it are shared with inline row
  // writes, so their `isPending` is not this dialog's) and the identity a late
  // completion is checked against before it touches the screen.
  const [savingGearAttempt, setSavingGearAttempt] = useState<DialogState | null>(null)
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
      writeLastListPath(persistedListPath(list.id, mode), ownerId)
    }
  }, [list?.id, mode, ownerId])

  // Last-list cache self-heal: if the route's listId is the cached one but
  // the list isn't in the user's `lists` collection (deleted, or another
  // account's list under a stale same-domain cache), clear the cache so the
  // nav shortcut takes the plain /lists path instead of looping back here.
  // Compare the cached path's extracted UUID against listId so an unrelated
  // missing-list deep-link doesn't wipe a valid cache. Gated on
  // !listsLoading so the in-flight window — where `list` is undefined for a
  // different reason — doesn't wipe a perfectly valid cache during cold load.
  //
  // Gated on the other two non-authoritative states for the same reason: a
  // failed fetch also leaves `list` undefined, and an in-flight refetch over a
  // stale collection leaves it undefined while the real answer is still on the
  // wire. Clearing the cache in either case would let one offline page load
  // permanently forget which list the user was working in. The cache is only
  // wrong if the server SETTLED and SAID the list is not in the collection -
  // so this runs only on a completed, successful fetch.
  //
  // listsFetching (not just listsLoading) is what covers the warm-cache case:
  // with a cached collection present, isPending is already false during the
  // refetch, so isPending alone would let the effect fire on stale absence.
  useEffect(() => {
    if (listsIndeterminate || listsIsError) return
    if (!list && listId) {
      const cachedPath = readLastListPath(ownerId)
      if (cachedPath && getListIdFromListPath(cachedPath) === listId) {
        clearLastListPath()
      }
    }
  }, [list, listId, listsIndeterminate, listsIsError, ownerId])

  const listItemsQuery = useQuery({
    queryKey: queryKeys.listItems(listId),
    queryFn: () => fetchListItems(listId),
  })
  const listItems = listItemsQuery.data ?? EMPTY_LIST_ITEMS

  // This list's food: the query, its weight, and the two writes the page makes
  // against it. See the hook for what it owns and what stays here.
  const {
    food: listFood,
    grams: foodGrams,
    isPending: listFoodPending,
    loadFailed: listFoodLoadFailed,
    refetch: refetchListFood,
    patchPackState: foodPackPatchMut,
    moveFood: moveFoodMut,
  } = useListFood(listId)

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
    isPending: packingLocationsPending,
    isLoadingError: packingLocationsFailed,
    refetch: retryPackingLocations,
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
  // useReorderable collapses "loading", "failed" and "genuinely empty" into
  // one empty array. Anything that would tell the user this list HAS no
  // locations - or WRITE as though it had none - needs to know the difference.
  //
  // isPending + isLoadingError rather than the cache's own status: a
  // background refetch that fails leaves status 'error' over locations we
  // still hold, and those are perfectly good to act on. Asking
  // qc.getQueryState for 'success' (as this did) went false in that case and
  // would now disable working controls.
  const packingLocationsResolved =
    !packingLocationsPending && !packingLocationsFailed
  const packingGroupingState = selectPackGroupingState(categories, {
    data: packingLocations,
    isError: packingLocationsError,
  })
  const grouping = mode === 'pack'
    ? packingGroupingState.grouping
    : { kind: 'category' as const, groups: categories }
  // Food joins the SAME gate as items/gear/categories. A failed food fetch must
  // not fall through as zero food weight: the total would look right and be
  // wrong, and pack weight is the number this page exists to report.
  const detailDataLoading =
    listItemsQuery.isPending ||
    gearItemsQuery.isPending ||
    categoriesQuery.isPending ||
    listFoodPending
  const detailDataError =
    (listItemsQuery.isError && listItemsQuery.data === undefined) ||
    (gearItemsQuery.isError && gearItemsQuery.data === undefined) ||
    (categoriesQuery.isError && categoriesQuery.data === undefined) ||
    listFoodLoadFailed
  const retryDetailData = useCallback(() => {
    void listItemsQuery.refetch()
    void gearItemsQuery.refetch()
    void categoriesQuery.refetch()
    void refetchListFood()
  }, [categoriesQuery, gearItemsQuery, refetchListFood, listItemsQuery])

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
  // and the inline notes list-field mutation. (Gear/category writes live in
  // useListGearActions, above.)
  const { addItem, updateItem, deleteItem, addNewItem } = useListItemActions(listId, {
    listItems,
    foodItems: listFood.items,
  })

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

  // Packing-location admin (create / rename / delete / promote an item to a
  // container), lifted from the retired OrganizePackPanel unchanged.
  const { createLocation, createItemContainer, renameLocation, removeLocation } =
    usePackingLocationActions(listId, packingLocations)
  const locationCreationPending =
    createLocation.isPending || createItemContainer.isPending

  // Moving an item between packing locations. Also lifted from the organizer:
  // it is the write behind both a cross-location drag and the row menu.
  type MoveItemVars = {
    itemId: string
    locationId: string | null
    nextPackSortOrder: number
  }
  const moveItemMut = useMutation({
    mutationKey: mutationKeys.moveListItem(listId),
    mutationFn: ({ itemId, locationId }: MoveItemVars) =>
      updateListItem(listId, itemId, { packingLocationId: locationId }),
    ...makeOptimisticUpdate<ListItemWithGear, MoveItemVars>({
      qc,
      queryKey: queryKeys.listItems(listId),
      id: ({ itemId }) => itemId,
      // nextPackSortOrder mirrors the rank the server assigns a move (repo
      // `nextPackSortOrderInCohort`). Applying only the assignment would park
      // the row at its OLD rank until the refetch landed, so it would appear
      // at some arbitrary depth of its new location and then visibly jump to
      // the bottom a moment later. The caller computes it, because `apply`
      // only ever sees the one row and the rank depends on all of them.
      //
      // sortOrder is deliberately untouched: a move rearranges your pack, not
      // your document.
      apply: (item, { locationId, nextPackSortOrder }) => ({
        ...item,
        packingLocationId: locationId,
        packSortOrder: nextPackSortOrder,
      }),
      // Toasted for the reorder reason rather than the delete one (see the rule in
      // src/lib/mutation-error-handler.ts): this is the write behind a DRAG, and a
      // rollback that sends the row back where it came from is indistinguishable
      // from the user having dragged it back themselves. The row-menu "Move to"
      // path shares the mutation and is no more obvious.
      errorToast: "Couldn't move that item. Please try again.",
    }),
  })
  // Every reorder guard below must watch BOTH mutations. Pack view fires
  // reorderPackItemsMut, so a guard reading only reorderItemsMut.isPending is
  // permanently false in exactly the mode it was written for - a second pack
  // drag could start while the first was still in flight.
  const anyItemReorderPending =
    reorderItemsMut.isPending || reorderPackItemsMut.isPending
  const itemDragPending =
    moveItemMut.isPending ||
    moveFoodMut.isPending ||
    anyItemReorderPending ||
    locationCreationPending ||
    // A pending optimistic bag delete makes cached locations lie about what
    // is rendered; structural writes wait for it to settle (round-7).
    removeLocation.isPending

  const notesMut = useMutation({
    mutationKey: mutationKeys.updateListNotes(listId),
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
  // Item ids whose removal preflight (the container check) is in flight. See
  // requestRemoveListItem: the preflight can await a fetch, during which the
  // row stays on screen and clickable.
  const removalPreflightRef = useRef(new Set<string>())

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
        ...listFood.items
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
      if (movedName) setAnnouncement(`Moving ${movedName}.`)
      // Pack rank: click-to-place is offered only inside a bag (the menu
      // withholds it outside location grouping), so it is always a pack
      // reorder - a union one since 0022.
      reorderPackItemsMut.mutate(updates, {
        onSuccess: () => {
          if (movedName) setAnnouncement(`Moved ${movedName}.`)
        },
        onError: () => {
          if (movedName) setAnnouncement(`Could not move ${movedName}.`)
        },
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
    handleLocationDragStart(e)
    const parsed = parseDnDId(String(e.active.id))
    const draggedName =
      parsed?.kind === 'packing-item'
        ? listItemsById.get(parsed.id)?.gearItem.name
        : parsed?.kind === 'packing-food-item'
          ? foodById.get(parsed.id)?.name
          : undefined
    if (draggedName) {
      setAnnouncement(
        `Dragging ${draggedName}. Reorder it here or choose another packing location.`,
      )
    }
  }

  function handleDragCancel() {
    setActiveId(null)
    handleLocationDragCancel()
    setAnnouncement('Move canceled.')
  }

  function requestMove(itemId: string, locationId: string | null) {
    const item = listItemsById.get(itemId)
    const destination = locationId === null
      ? 'Unassigned'
      : realLocations.find((location) => location.id === locationId)?.name
    if (item && destination) setAnnouncement(`Moving ${item.gearItem.name} to ${destination}.`)
    moveItemMut.mutate({
      itemId,
      locationId,
      // The DESTINATION cohort's next UNION rank (gear and food - 0022),
      // mirroring the server. A gear-only maximum here would park the row
      // visually above food already in the bag until the refetch corrected
      // it (GATE 2 finding). A move never touches sortOrder, so the row
      // keeps its place in List view and on the share link.
      nextPackSortOrder: nextUnionPackRankFor(listItems, listFood.items, locationId),
    }, {
      onSuccess: () => {
        if (item && destination) setAnnouncement(`Moved ${item.gearItem.name} to ${destination}.`)
      },
      onError: () => {
        if (item) setAnnouncement(`Could not move ${item.gearItem.name}.`)
      },
    })
  }

  function requestMoveFood(foodId: string, locationId: string | null) {
    const food = foodById.get(foodId)
    const destination = locationId === null
      ? 'Unassigned'
      : realLocations.find((location) => location.id === locationId)?.name
    if (food && destination) setAnnouncement(`Moving ${food.name} to ${destination}.`)
    moveFoodMut.mutate({
      foodId,
      locationId,
      // The destination cohort's next UNION rank, mirroring the server.
      nextPackSortOrder: nextUnionPackRankFor(listItems, packFoodItems, locationId),
    }, {
      onSuccess: () => {
        if (food && destination) setAnnouncement(`Moved ${food.name} to ${destination}.`)
      },
      onError: () => {
        if (food) setAnnouncement(`Could not move ${food.name}.`)
      },
    })
  }

  // Single page-level drag handler over four id kinds.
  //
  // Order matters. locationReorder.handleDragEnd runs FIRST and strictly
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
    handleLocationDragEnd(e)

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
      const reorderExclusions = grouping.kind === 'category'
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
        if (draggedName) setAnnouncement(`Reordering ${draggedName}.`)
        reorderPackItemsMut.mutate(plan.updates, {
          onSuccess: () => {
            if (draggedName) setAnnouncement(`Reordered ${draggedName}.`)
          },
          onError: () => {
            if (draggedName) setAnnouncement(`Could not reorder ${draggedName}.`)
          },
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
      groupingKind: grouping.kind,
      mode,
      locations: packingLocations,
      hiddenItemIds: mode === 'pack' ? packFilteredItemIds : EMPTY_HIDDEN_ITEM_IDS,
    })
    if (plan?.kind === 'pack') reorderPackItemsMut.mutate(plan.updates)
    else if (plan) reorderItemsMut.mutate(plan.updates)
  }

  // Pack/Ready reset actions live in a dedicated hook; it owns the field-scoped
  // cancel/snapshot/optimistic-clear/rollback/invalidate lifecycle on the
  // ['list-items', listId] cache (resetPacked and resetReady each restore only
  // their own field on failure, so they compose) and the failure toasts. The
  // page keeps the PackingProgress wiring, the per-item toggles, and the
  // ready-checks-enabled toggle.
  const { resetPacked, resetReady } = useListResetActions(listId)


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

  // Pack reads pack order in BOTH of its groupings - by location, and by
  // category on a list that has no locations yet. List view reads the document
  // order it is named for.
  const grouped = useGroupedListItems(
    listItems,
    grouping,
    mode === 'pack' ? 'pack' : 'document',
  )
  const orderedPackGroups = orderPackGroups(grouped, grouping.kind)
  const packingTree = useMemo(
    () => mode === 'pack' && packingLocations.length > 0
      ? buildPackingTree(listItems, packingLocations, {
          includeItem: (item) => !item.isWorn,
        })
      : null,
    [listItems, packingLocations, mode],
  )

  // ── Packing drag derivations ───────────────────────────────────────────────
  // All lifted from the retired OrganizePackPanel. Read by handleDragEnd and
  // the collision filter, both of which run after commit, so declaring them
  // below the handlers is safe.
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
  // `react()` in vite.config.ts, no babel-plugin-react-compiler in
  // package.json). So nothing memoizes these for us - they genuinely
  // recompute every render. That is affordable on its own terms: a handful of
  // linear passes over at most 30 locations and 300 items, well under a
  // millisecond. What it does cost is memo stability downstream; see
  // renderPackRowAction below for the part that actually matters.
  //
  // The expensive derivations above (packingTree, weightBreakdown) keep their
  // explicit memos - the rule accepts those, because their inputs are query
  // data the analysis can follow.

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

  // ── Food in Pack mode (0022: a bag's contents are the gear+food union) ──
  // useListFood already holds the food rows for the weight total; Pack renders
  // the same rows. Everything below is a function of PAGE state - the mode, the
  // two row filters, which locations are on screen - which is why it stayed
  // here rather than moving into the hook.
  const packFoodItems = mode === 'pack' ? listFood.items : EMPTY_FOOD_ITEMS
  const foodById = new Map(packFoodItems.map((food) => [food.id, food]))
  // Filtered food rows, mirroring packFilteredItemIds for gear: hidden rows
  // must not participate in reorder planning.
  const packFilteredFoodIds = new Set(
    packFoodItems
      .filter(
        (food) =>
          (showUnpackedOnly && food.isPacked) ||
          (showUnreadyOnly && food.isReady),
      )
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
  const foodByLocation = new Map<string | null, FoodItemResponse[]>()
  for (const food of packFoodItems) {
    const key =
      food.packingLocationId !== null && renderedLocationIds.has(food.packingLocationId)
        ? food.packingLocationId
        : null
    const bucket = foodByLocation.get(key)
    if (bucket) bucket.push(food)
    else foodByLocation.set(key, [food])
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
  // This check is deliberately NOT exhaustive. Everything it cannot see -
  // the section collapsing, the row being promoted to a container, another
  // tab moving it into a collapsed bag, its location being optimistically
  // deleted - shows up as "no usable slots are mounted any more", which
  // PlacementProvider watches directly. Adding a predicate here per case
  // would be a second, partial copy of a question the slots can answer
  // exactly.
  const placingItemId = placement?.itemId
  const placementCancel = placementActions.cancel
  const placingStillEligible =
    placingItemId === undefined ||
    (grouping.kind === 'location' &&
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
  // Food composes in at the page level so the mobile strip and the desktop
  // table are handed ONE number (useListFood's `grams`) and cannot disagree
  // about what the pack weighs.
  const weightBreakdown = useMemo(
    () => computeListWeightBreakdown({
      gear: { items: listItems, categories },
      food: { grams: foodGrams },
    }),
    [categories, listItems, foodGrams],
  )
  // Mirrors WeightSummary's own render guard.
  const showWeightSummary = listItems.length > 0 || weightBreakdown.totalPackGrams > 0

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
  // The rule (see list-item-removal.ts): remove immediately, UNLESS the row is
  // being used as a packing container - that also removes the container and
  // moves its contents to Unassigned, which is intended but is a bigger change
  // than the row that was clicked, so it gets named first.
  //
  // The decision resolves the locations query rather than reading the
  // render's array, and that is load-bearing: the locations query is NOT part
  // of detailDataLoading, so rows render - and are removable - while it is
  // still in flight. An empty array in that window would answer "not a
  // container" for an item that is one, and remove the container with no
  // dialog. resolveRemovalPlan owns that (see it for why it fetches); this
  // keeps only the page-level parts, the duplicate guard and the dialog
  // state. It never rejects - a failed lookup becomes a confirm - so nothing
  // escapes this discarded IIFE as an unhandled rejection.
  const requestRemoveListItem = useCallback(
    (li: ListItemWithGear, returnDialog?: DialogState) => {
      // Awaiting a lookup leaves the row on screen and clickable, so the same
      // item can be queued for removal twice - two DELETEs, the second a 404.
      // The synchronous path this replaced was self-limiting because the
      // optimistic delete removed the row before a second click could land.
      if (removalPreflightRef.current.has(li.id)) return
      // Click-to-place is a persistent mode: its insertion slots stay mounted
      // and the rows around them stay clickable, so a removal started from a
      // pack kebab can otherwise open a confirm dialog on top of live slots -
      // and if the removed row is the one being placed, the mode is left
      // pointing at something that no longer exists. Placement is about where
      // a row sits; removing it makes that question moot, so the mode loses.
      //
      // returnFocus is false because the kebab that started this is inside the
      // row about to disappear. PlacementProvider's restore already declines
      // to focus a disconnected origin, but asking for it at all would be
      // stating an intent this call cannot honor.
      placementActions.cancel({ returnFocus: false })
      removalPreflightRef.current.add(li.id)
      void (async () => {
        try {
          const plan = await resolveRemovalPlan(qc, listId, li.id)
          // Again, after the await. The lookup is a real round trip - the
          // duplicate guard above exists because it is long enough for a
          // second click - so placement can be started DURING it, after the
          // cancel above has already run. Canceling once on entry would leave
          // the confirm dialog opening over live slots in exactly that window.
          // cancel() is idempotent, so the common path pays nothing.
          placementActions.cancel({ returnFocus: false })
          if (plan.kind === 'confirm') {
            setDialog({
              type: 'remove-container-item',
              item: li,
              location: plan.location,
              returnDialog,
            })
            return
          }
          deleteItem.mutate(li.id)
        } finally {
          removalPreflightRef.current.delete(li.id)
        }
      })()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- qc and setDialog are stable; deleteItem is a TanStack mutation result (.mutate is stable, the wrapper is not); refs are stable; placementActions is a useMemo over an empty dep array (see placement-context); listId is fixed for this component instance (keyed by list)
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
    <div className="flex-1 min-h-0 overflow-hidden">
      <LibraryPanel
        gearItems={gearItems}
        categories={categories}
        listItemGearIds={listItemGearIds}
        // This pane mounts in the desktop aside and the mobile drawer, both
        // OUTSIDE the detail gate below - so it is on screen and interactive
        // during exactly the failure that empties listItemGearIds.
        membershipUnknown={listItemsQuery.data === undefined}
        weightUnit={weightUnit}
        onAdd={onLibraryAdd}
        onRemove={onLibraryRemove}
        // null category: the item lands Uncategorized in Category view, and
        // in Pack it lands Uncategorized too while the list has no bags
        // (Pack falls back to category grouping there) or Unassigned once it
        // does. Worn items go to the Worn section either way.
        onCreateNew={(data) => {
          // Close the drawer too, not just the modal. Below lg this panel
          // lives inside the sidebar drawer, whose 88vw content is z-50 -
          // the same layer as the toast, and painted after it. A failed
          // create would report into a toast the drawer covers, which is the
          // same class of bug as reporting behind an open <dialog>.
          setDrawerOpen(false)
          onAddNewItem(null, data)
        }}
        // The panel sits outside the detail gate below, so it stays
        // interactive during exactly the failure that would hide the result.
        // Creating is what must not proceed blind - adding EXISTING gear is
        // separately protected by membershipUnknown.
        createDisabledReason={
          detailDataError
            ? "Couldn't load this list, so a new item can't be confirmed."
            : detailDataLoading
              ? 'Still loading this list.'
              : undefined
        }
      />
    </div>
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

  // Opens the gear editor for one item. Hoisted out of sharedGroupProps
  // because Pack reaches it from three places the category sections never
  // touch - the packing kebab, a container's section header, and the worn
  // row's own button - and duplicating the ref lookups at each would be four
  // copies of one rule about which dialog to open.
  //
  // Refs, not state, so this is stable for the life of the page: rebuilding
  // it would rebuild sharedGroupProps and re-render every section on each
  // checkbox tick.
  const openGearEditor = useCallback((gearId: string) => {
    const g = gearItemsRef.current.find((x) => x.id === gearId)
    const li = listItemsRef.current.find((l) => l.gearItem.id === gearId)
    if (g) setDialog({ type: 'edit-gear', gear: g, listItem: li ?? null, saveError: null })
    // Both are useRef objects and setDialog is a useState setter, so all three
    // identities are stable for the life of the page - listing the refs keeps
    // the lint rule satisfied without changing when this rebuilds (never).
  }, [gearItemsRef, listItemsRef])

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
      // Ready checks are unconditional. They were once a per-list opt-in
      // toggled from PackingProgress; the toggle was pure friction - a
      // checklist either has a prep step or you ignore the column - so the
      // feature became unconditional, the flag was pinned true here, and the
      // prop is now gone from every consumer.
      //
      // The lists.ready_checks_enabled COLUMN is GONE, dropped by migration
      // 0027. This comment used to say it had to stay because dropping it
      // meant a SQLite table rebuild that would cascade-delete list_items -
      // true of a rebuild, and never true of `ALTER TABLE ... DROP COLUMN`,
      // which rewrites rows in place and issues no DROP TABLE. is_ready on
      // each item was always persisted independently of the flag, so a list
      // that had ready checks on, collected some ticks, then turned them off
      // gets those ticks back rather than a reset - the honest outcome, since
      // the data was never deleted, only hidden.
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
      onUpdateFood: (foodId: string, patch: { isPacked?: boolean; isReady?: boolean }) =>
        foodPackPatchMut.mutate({ foodId, patch }),
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
      onEditGearItem: openGearEditor,
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
  // packing derivations above, so a memo could never hit and the dependency
  // array would only mislead.
  //
  // KNOWN TRADE, stated plainly because the surrounding architecture works
  // hard at the opposite: passing a fresh function here defeats
  // CategoryGroup's React.memo for pack sections, so a checkbox tick
  // re-renders every location section rather than the one that changed. That
  // is the render cost CategoryGroup's prop-stability comments were written
  // to avoid, and the Organize view this replaced was equally unstable - but
  // Organize was not the view you tick 300 checkboxes in, and Pack is.
  //
  // Not fixed here because the fix is not small: the menu needs locations,
  // in-flight mutation state, container exclusions and the breakpoint, so
  // making it stable means either a context or per-row query subscriptions,
  // each with its own cost. Worth profiling a 300-item / 30-location list
  // before choosing. Filed as a follow-up rather than guessed at.
  const renderPackRowAction = (
    item: ListItemWithGear,
    cohort: ListItemWithGear[],
    section: SectionIdentity,
    unionRowCount?: number,
  ) => (
    <MoveToLocationMenu
      itemId={item.id}
      itemName={item.gearItem.name}
      currentLocationId={item.packingLocationId}
      locations={realLocations}
      mobile={isBelowLg}
      disabled={itemDragPending}
      locationsUnavailable={!packingLocationsResolved}
      containerCreationDisabled={
        packingLocations.length >= PACKING_LOCATION_CAP || locationCreationPending
      }
      isContainer={false}
      excludedLocationIds={containerMoveExclusions.get(item.id)}
      onMove={(locationId) => requestMove(item.id, locationId)}
      // Click-to-place, the non-drag path for reorder. Withheld while a
      // reorder is already in flight, and withheld entirely in category
      // grouping - the insertion slots only render for packing rows, so the
      // action would open a mode with nothing in it.
      //
      // Also withheld when this section rendered fewer than two rows. Every
      // insertion point in a one-row section is a no-op, so the mode would
      // open with no slots and no way out but Escape. `cohort` is post-filter,
      // which is the right test: a bag of ten rows showing one is just as
      // unreorderable as a bag holding one.
      onStartReorder={
        grouping.kind === 'location' &&
        !anyItemReorderPending &&
        (unionRowCount ?? cohort.length) > 1
          ? (origin: HTMLElement | null) =>
              placementActions.start({ kind: 'gear', gear: item }, section, origin)
          : undefined
      }
      // Membership: this drops the row from the list and leaves the gear item
      // in the library. requestRemoveListItem owns the container-backing
      // case, which needs a confirm because it destroys more than the row.
      //
      // Authoring now lives here too (onEdit below). Pack used to be
      // membership-only on the grounds that gear is authored in the library;
      // a real trip showed that a wrong weight noticed while packing then
      // cost a round trip through two other views.
      onRemoveFromList={() => requestRemoveListItem(item)}
      onEdit={() => openGearEditor(item.gearItem.id)}
      onUseAsContainer={() => createItemContainer.mutate({
        itemId: item.id,
        name: item.gearItem.name,
      })}
    />
  )

  // The food row's menu: move between bags, click-to-place within one. No
  // container promotion (food cannot back a container) and no removal - food
  // membership is authored in the Food view, and a checklist row losing its
  // delete is the same rule worn gear rows follow for structure actions.
  const renderFoodRowAction = (
    food: FoodItemResponse,
    unionRowCount: number,
    section: SectionIdentity,
  ) => (
    <MoveToLocationMenu
      itemId={food.id}
      itemName={food.name}
      currentLocationId={food.packingLocationId}
      locations={realLocations}
      mobile={isBelowLg}
      disabled={itemDragPending}
      locationsUnavailable={!packingLocationsResolved}
      containerCreationDisabled
      isContainer={false}
      onMove={(locationId) => requestMoveFood(food.id, locationId)}
      onStartReorder={
        grouping.kind === 'location' && !anyItemReorderPending && unionRowCount > 1
          ? (origin: HTMLElement | null) =>
              placementActions.start({ kind: 'food', food }, section, origin)
          : undefined
      }
    />
  )
  const packFoodRowAction = mode === 'pack' ? renderFoodRowAction : undefined

  // The same action, for the category-grouped sections. Those sections are
  // NOT pack-only - they are what List view renders too - so the mode test is
  // the whole point of this binding.
  //
  // Pack falls back to category grouping until a list has its first packing
  // location (selectPackGrouping), which is every list on its first visit to
  // this view. Without this the feature would be missing exactly where a new
  // user meets it, and present only after they had built a bag - the kind of
  // partial coverage that reads as "it does not work".
  //
  // The menu degrades correctly here on its own: click-to-place is already
  // withheld outside location grouping, and with no locations the move list
  // holds only the current one, disabled.
  const packRowAction = mode === 'pack' ? renderPackRowAction : undefined

  // Worn rows, which sit outside the packing tree by design: they are not in
  // a bag, so move, reorder and containerize do not apply to them. Removal
  // does - deciding you are not taking something is as likely for a worn item
  // as any other - and pack mode suppresses ItemRow's ordinary kebab, so
  // without this the Worn section is the one place in Pack you cannot drop an
  // item from.
  //
  // Buttons rather than a kebab. Editing joined removal here so that "you can
  // edit an item from Pack" is true of the Worn section too - it has no
  // packing kebab to hang a menu entry on. Two direct controls beat a menu:
  // hiding Remove behind an extra click costs more than the ~28px.
  const renderWornPackRowAction = (item: ListItemWithGear) => (
    <>
      <RowIconButton
        touchSafe
        onClick={() => openGearEditor(item.gearItem.id)}
        ariaLabel={`Edit ${item.gearItem.name}`}
        title="Edit item"
        icon={<Pencil size={14} />}
      />
      <RowIconButton
        touchSafe
        disabled={itemDragPending}
        onClick={() => requestRemoveListItem(item)}
        ariaLabel={`Remove ${item.gearItem.name} from list`}
        title="Remove from list"
        icon={<Trash2 size={14} />}
      />
    </>
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
        renderRowAction={renderPackRowAction}
        packFoodRows={foodByLocation.get(location.id) ?? EMPTY_FOOD_ITEMS}
        renderFoodRowAction={packFoodRowAction}
        containerAction={containerItem ? (
          <MoveToLocationMenu
            itemId={containerItem.id}
            itemName={containerItem.gearItem.name}
            currentLocationId={containerItem.packingLocationId}
            locations={realLocations}
            mobile={isBelowLg}
            disabled={itemDragPending}
            locationsUnavailable={!packingLocationsResolved}
            containerCreationDisabled={
              packingLocations.length >= PACKING_LOCATION_CAP || locationCreationPending
            }
            isContainer
            excludedLocationIds={containerMoveExclusions.get(containerItem.id)}
            onMove={(locationId) => requestMove(containerItem.id, locationId)}
            // The container's own row. Removing it necessarily takes the
            // location with it (container_list_item_id cascades) and drops its
            // contents to Unassigned - requestRemoveListItem routes exactly
            // this case through a confirm that names both consequences.
            onRemoveFromList={() => requestRemoveListItem(containerItem)}
            // A container's own row lives in the section header, so the
            // ordinary row kebab never renders for it. Without this, the one
            // item you cannot edit from Pack would be the bag itself.
            onEdit={() => openGearEditor(containerItem.gearItem.id)}
            onStopUsingAsContainer={() => setDeleteLocationTarget(location)}
          />
        ) : undefined}
        itemReorderPending={anyItemReorderPending}
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
            auto-shift computes against the wrong neighbors, and a nested
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
  // All three branches below are guarded on `!list`, so a resolved list is
  // never replaced by a status screen. That is what keeps a failed background
  // refetch (which in v5 sets status to 'error' while retaining the cached
  // collection) from blanking out a page the user is working in.
  //
  // Ordered from least to most authoritative: still working on it, gave up,
  // and only then genuinely absent.
  if (listsIndeterminate && !list) {
    return <StatusPanel title="Loading list..." busy />
  }

  // Settled in error, and the list is not in whatever we have. Distinct from
  // the not-found branch below, and checked BEFORE it: both leave `list`
  // undefined, but only one of them means the list is gone. Merging them
  // showed "This list may have been deleted" to anyone whose connection
  // dropped, and gave them a Back-to-lists link into a page that was about to
  // fail the same way. A stale cached collection that predates the deletion
  // (or the sharing) of this list lands here too, which is right: an errored
  // query is not evidence of absence.
  //
  // DesktopListsPanel needs no equivalent guard: it renders inside the list
  // document below, which this branch replaces wholesale, so it never mounts
  // against a lists fetch that failed with nothing to show.
  if (listsIsError && !list) {
    return (
      <StatusPanel
        title="Couldn't load your lists"
        body="Check your connection and try again."
        onRetry={onRetryLists}
      />
    )
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
      {/* Two-column grid. The aside serves BOTH gear arrangements now
          (Organize returned through its exclusive branch above; Food keeps
          its own left rail and is excluded here). */}
      <div className="flex gap-4 items-start">
        {/* LEFT column — Lists switcher above the gear library picker.
            DesktopListsPanel is the primary desktop workflow for list
            switching/management; /lists remains the mobile management page
            and a desktop fallback (e.g. when no lists exist).

            Pack used to hide this entirely so packing got the focus. A real
            trip retired that argument: adding or reweighing one item meant
            leaving the view and coming back. See docs/one-page-list-design.md.

            But Pack's aside starts at xl, not lg. At 1024px the shell's 32px
            padding leaves 992px; minus a 320px aside and the 16px gap the
            document is 656px, and a pack row (grip, two checkboxes, name,
            description, two icon slots, quantity, weight, menu) does not
            overflow there - every flexible cell is min-w-0 truncate, so the
            name silently shrinks to ~113px instead. Information disappearing
            quietly is worse than a missing panel, and between lg and xl Pack
            still reaches the picker through the Add gear drawer button below.
            Category rows are far less dense and stay on lg. */}
        {(mode === 'edit' || mode === 'pack') && (
          <aside
            data-testid="list-side-panel"
            className={`hidden ${mode === 'pack' ? 'xl:flex' : 'lg:flex'} w-80 xl:w-96 shrink-0 flex-col gap-3 sticky self-start print:hidden`}
            style={{ top: '1rem', height: 'calc(100vh - 2rem)' }}
          >
            {/* Category only. Nobody switches lists mid-pack, and max-h-72 is
                vertical room the picker wants back.
                shrink-0 + max-h-72 keeps the lists switcher compact even
                with many lists: the panel scrolls internally beyond that
                cap and the gear picker below always has room. */}
            {mode === 'edit' && (
              <DesktopListsPanel
                lists={lists}
                currentListId={listId}
                className="shrink-0 max-h-72"
              />
            )}

            <div className={`flex flex-col min-h-0 flex-1 ${FLAT_TABLE_SURFACE}`}>
              {libraryPane}
            </div>
          </aside>
        )}

        {/* RIGHT column — list document. Title toolbar + weight table +
            items (always visible; packing checkbox column appears in pack
            mode).

            Pack used to narrow from 7xl (AppShell main) to 3xl + mx-auto so
            the sparser layout read as focused rather than stretched across
            the width the missing sidebar left behind. The sidebar is back at
            xl, so on screen that compensation is now wrong.

            It survives for PRINT, and not by inertia: max-w-3xl is an
            unprefixed utility, so it always governed paper too. Dropping it
            outright would widen the printed checklist on any print config
            whose content area exceeds 768px - a silent regression in the one
            output nobody re-checks. */}
        <div
          data-testid="list-document-column"
          className={`flex-1 min-w-0 space-y-4 ${mode === 'pack' ? 'print:max-w-3xl print:mx-auto' : ''}`}
        >
          <ListDocumentToolbar
            list={list}
            mode={mode}
          />

          {mode === 'food' ? (
            // Food owns its own query gates (see FoodView), branched here
            // ABOVE the detail-data composite below: a gear/categories/items
            // failure must not block the food route, and a food failure must
            // reach FoodView's own retry, not the generic "Couldn't load
            // list details" this page shows for the other two modes.
            <FoodView listId={listId} />
          ) : detailDataError ? (
            <StatusPanel
              title="Couldn't load list details"
              body="Check your connection and try again."
              onRetry={retryDetailData}
              showBackToLists
            />
          ) : detailDataLoading ? (
            <StatusPanel title="Loading list details..." busy />
          ) : (
            <>
              {mode === 'pack' && listItems.length + packFoodItems.length > 0 && (
                <div className="print:hidden">
                  {/* Union counts (0022): the pack is gear plus food, and a
                      progress bar that ignored food would read 100% with the
                      tortillas still on the counter. */}
                  <PackingProgress
                    total={listItems.length + packFoodItems.length}
                    packed={
                      listItems.filter((i) => i.isPacked).length +
                      packFoodItems.filter((f) => f.isPacked).length
                    }
                    onReset={resetPacked}
                    showUnpackedOnly={showUnpackedOnly}
                    onToggleShowUnpackedOnly={() => setShowUnpackedOnly((v) => !v)}
                    showUnreadyOnly={showUnreadyOnly}
                    onToggleShowUnreadyOnly={() => setShowUnreadyOnly((v) => !v)}
                    readyChecks={{
                      ready:
                        listItems.filter((i) => i.isReady).length +
                        packFoodItems.filter((f) => f.isReady).length,
                      total: listItems.length + packFoodItems.length,
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
                  />
                </div>
              )}

              {/* Pack's way back to the gear library, for the ONE width band
                  that has no other path to it: lg to xl.

                  Below lg the bottom action bar already carries Add, so
                  rendering this there would be a second button for one action
                  on the surface with the least room for it. At xl and up the
                  picker aside is on screen permanently, so this would be a
                  drawer trigger for a panel the user can already see.

                  It opens the same library panel the aside shows, so adding
                  gear behaves identically either way - only the container
                  differs. */}
              {mode === 'pack' && !isBelowLg && isBelowXl && (
                <div className="print:hidden flex justify-end">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Plus size={15} /> Add gear
                  </button>
                </div>
              )}

              {/* Packing-location admin, lifted from the retired Organize
                  view. Pack mode is the organizer now, so building the
                  structure and filling it happen in one place instead of
                  across two tabs. Edit mode never shows this: locations are a
                  packing concern. */}
              {mode === 'pack' && (
                <PackLocationControls
                  locations={packingLocations}
                  // The empty-state nudge must not fire on a guess. An empty
                  // locations array is ALSO what a pending or failed query
                  // looks like (useReorderable defaults items to []), so
                  // without this a list that already has locations would be
                  // told it has none - and its three starter buttons would
                  // cheerfully create a duplicate.
                  //
                  // Scope, honestly: this covers the cold-load and
                  // first-load-failure cases. It does NOT cover a stale
                  // cached [] - status stays 'success' through a background
                  // refetch - so a tab holding a stale empty result while
                  // another device added a location can still show the nudge
                  // until the refetch lands. Left as-is because the outcome
                  // there is one extra, visible, deletable location, not the
                  // irreversible cascade the removal path guards against.
                  locationsResolved={packingLocationsResolved}
                  loadFailed={packingGroupingState.showErrorNotice}
                  onRetry={retryPackingLocations}
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
              {listItems.length === 0 &&
              (mode !== 'pack' || packFoodItems.length === 0) ? (
                <EmptyListCell onMobileAdd={() => setDrawerOpen(true)} />
              ) : (() => {
                const activeParsed = activeId ? parseDnDId(activeId) : null
                const activeItem =
                  activeParsed?.kind === 'item' ? (listItemsById.get(activeParsed.id) ?? null) : null
                const activePackingItem =
                  activeParsed?.kind === 'packing-item'
                    ? (listItemsById.get(activeParsed.id) ?? null)
                    : null
                const activePackingFood =
                  activeParsed?.kind === 'packing-food-item'
                    ? (foodById.get(activeParsed.id) ?? null)
                    : null
                return (
                  <div className="flex flex-col gap-3">
                    <PlacementProvider placement={placement} actions={placementActions}>
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
                              items={packingTree.unassignedItems}
                              {...sharedGroupProps}
                              renderRowAction={renderPackRowAction}
                              packFoodRows={foodByLocation.get(null) ?? EMPTY_FOOD_ITEMS}
                              renderFoodRowAction={packFoodRowAction}
                              reorderPending={anyItemReorderPending}
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
                      ) : (
                        <>
                        {orderedPackGroups.map((group) => {
                          const definition = group.group
                          if (definition) {
                            return (
                              <CategoryGroup
                                key={definition.id}
                                name={definition.name}
                                categoryId={definition.id}
                                items={group.items}
                                {...sharedGroupProps}
                                renderRowAction={packRowAction}
                                reorderPending={anyItemReorderPending}
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
                              renderRowAction={packRowAction}
                              reorderPending={anyItemReorderPending}
                              baseSubtotalGrams={baseGramsForCategory(weightBreakdown, null)}
                              consumableSubtotalGrams={consumableGramsForCategory(weightBreakdown, null)}
                              onAddItem={onAddNewItem}
                            />
                          )
                        })}
                        {/* Pack's no-locations fallback groups gear by
                            category; food gets its own section so the
                            checklist still covers the whole pack. Rows check
                            off and drag-reorder among themselves (the union
                            planner handles `packing-food-item:` ids in any
                            grouping); bag assignment starts existing once
                            the first location does. */}
                        {mode === 'pack' && packFoodItems.length > 0 && (
                          <CategoryGroup
                            key="__pack_food__"
                            name="Food"
                            regionKey="packing-food-fallback"
                            items={EMPTY_LIST_ITEMS}
                            {...sharedGroupProps}
                            packFoodRows={packFoodItems}
                            renderFoodRowAction={packFoodRowAction}
                            reorderPending={anyItemReorderPending}
                          />
                        )}
                        </>
                      )}
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
                        ) : activePackingFood ? (
                          // Same chip treatment as a gear packing drag.
                          <div className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm shadow-lg">
                            {activePackingFood.name}
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
                    </PlacementProvider>

                    {/* Worn section — visible in both normal and pack mode when
                        at least one worn item exists.
                        Sits outside the DndContext: it isn't a reorder target
                        (no renderRows), and worn items don't render inside
                        their original category or location sections.
                        Spreads the
                        same sharedGroupProps every in-category section uses so
                        row chrome stays consistent — onSetGearStatus,
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
                        // Unlabeled on purpose: the section title already says
                        // Worn, and this is the canonical list-level worn total.
                        // It must NOT look itself up by category - it has no
                        // categoryId, and a null lookup would hand it
                        // Uncategorized's base figure.
                        //
                        // Caveat, deliberately accepted: the weight breakdown
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
                        renderRowAction={
                          mode === 'pack' ? renderWornPackRowAction : undefined
                        }
                      />
                    )}
                  </div>
                )
              })()}

              {/* Food in the Category arrangement, as its own trailing
                  section of rows.

                  It used to be a single summary line linking to the Food
                  view, on the theory that food was a private planning aid
                  that would clutter a shared list. That theory did not
                  survive contact with how these lists are actually read -
                  food you carry is part of the pack - and it cost a
                  permanent asymmetry: the same list showed items in Pack and
                  one number in Category, and the share showed neither.
                  Category, Pack and the share now all show the rows.

                  INSIDE the loaded branch, OUTSIDE the listItems.length === 0
                  one. Inside, because a document half-rendered under a
                  "couldn't load" banner is worse than none - the same reason
                  every other section sits there. (The empty-food fallback the
                  page uses while the query is in flight cannot leak a section
                  through on its own; the items.length gate below stops that
                  independently.) Outside the empty-gear branch, because a
                  list with food and no gear yet is a real, usable list.

                  Category only: in Pack, food rows are part of each bag's
                  union cohort and are rendered by the location sections
                  above. Rendering them here as well would show every one
                  twice. */}
              {mode === 'edit' && listFood.items.length > 0 && (
                <CategoryGroup
                  name="Food"
                  items={EMPTY_LIST_ITEMS}
                  regionKey="food"
                  foodRows={listFood.items}
                  weightUnit={weightUnit}
                  isBelowLg={isBelowLg}
                  // CONSUMABLE, not the bare subtotal. `subtotalGrams` is the
                  // Worn section's channel and CategoryFooterWeights labels it
                  // "Worn" - passing food through it would print "Worn 470 g"
                  // under the food. Food is consumable by definition, which is
                  // the same bucket its grams already land in upstream.
                  consumableSubtotalGrams={foodGrams}
                  // An explicit "Edit" alongside the section name, both
                  // inside the title slot.
                  //
                  // Inside the title slot because the non-pack header ends in
                  // fixed Qty/Weight column stubs that line up with the cells
                  // beneath them, and the title absorbs the slack - so
                  // anything appended AFTER the stubs shifts both labels off
                  // their columns. Visible rather than a hover state on the
                  // title, because hover does not exist on touch: an
                  // affordance only a mouse can find is not an affordance
                  // here. `name` still supplies every accessible label
                  // ("Collapse Food").
                  //
                  // It leads out to the Food view rather than editing in
                  // place: a food item is authored where its schedule lives,
                  // and a second authoring path for one thing is how the two
                  // drift.
                  titleContent={
                    <span className="flex min-w-0 flex-1 items-center gap-1">
                      <span className={`truncate ${FLAT_TABLE_HEADER_TITLE}`}>Food</span>
                      {/* aria-label, because "Edit" alone is the whole
                          accessible name: the section title beside it is
                          separate text, so a screen reader listing links
                          would announce a destination-less "Edit".

                          Sized to the 40px control target the density
                          system uses for chevrons and kebabs, not the 44px
                          ROW floor: the header's own 44px includes its 1px
                          bottom border, so a 44px child would push it to
                          45px on mobile. Desktop relaxes to the 28px row
                          height. Both dimensions, not just height: "Edit" at
                          this size is only ~36px wide, so a height-only floor
                          would leave the target short in the axis nobody
                          checks. Negative inline margin keeps the padded box
                          from pushing the title without shrinking the target
                          itself. */}
                      <Link
                        to={`/lists/${listId}/food`}
                        aria-label="Edit food"
                        className={`shrink-0 inline-flex items-center justify-center min-h-10 min-w-10 lg:min-h-7 lg:min-w-0 px-2 -mx-1 ${FLAT_TABLE_META_TEXT} text-gray-500 hover:text-blue-600`}
                      >
                        Edit
                      </Link>
                    </span>
                  }
                />
              )}
            </>
          )}

        </div>
      </div>

      {/* Mobile gear-library drawer — mirrors the desktop left aside.
          Slides in from the LEFT, dismissed by overlay tap, the close
          button, or Escape. Stays open across multiple add/remove
          actions so the user can build up a list quickly.

          JS-gated so a surface that has another way to reach the library
          doesn't mount the drawer at all; React.lazy on the wrapper means
          those surfaces also never fetch the Radix Dialog chunk.

          Below lg: edit and pack, since there is no room for the aside there.
          At lg+: pack only. Desktop Pack hides the left aside on purpose (see
          the aside's comment - packing wants the focus), which also removed
          the only way to put a forgotten item on the list without leaving the
          view. The drawer restores that without giving the aside back.

          Food is excluded at every width: it has no drawer registration (see
          useRegisterSidebarDrawer above, gated the same `edit || pack` way)
          and MobileListActionBar pushes no Add there, so mounting this would
          only fetch the Radix Dialog chunk for a sheet that can never open. */}
      {((isBelowLg && mode !== 'food') || mode === 'pack') && (
        <div className="print:hidden">
          <Suspense fallback={null}>
            <ListSidebarDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              title="Add from gear"
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
          Save runs sequentially: gear first, then the per-list patch, and a
          failed gear write short-circuits the list one. Three reachable
          outcomes, not four - "both failed" cannot happen, because stage two
          never starts.

          The messages say UNCONFIRMED rather than "not applied", and the
          distinction is not pedantry. A rejected mutateAsync does not prove
          the server did not commit: the connection can drop after the PATCH
          lands, and apiFetch also rejects when a 200 fails DTO validation.
          Telling the user "no changes were applied" - as this did - invites
          them to close the dialog believing a change to their SHARED gear
          item did not persist when it did.

          What we can honestly offer is that retrying is safe, because both
          stages are PATCHes and repeating one converges on the same row, and
          that a REFRESH shows the truth. Not "reopen the dialog": the
          settled invalidation is fired unawaited, so a quick reopen reads
          whatever is in the cache right now - possibly the rollback
          snapshot - and if that refetch failed, it stays there.

          updateGearItem's fan-out invalidates the affected per-list caches
          it snapshotted, so other open lists pick the change up; it is not
          a broad ['list-items'] prefix invalidation. */}
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
          // Per-attempt, NOT `updateGearItem.isPending || updateItem.isPending`. Both
          // mutations also serve inline row writes behind this dialog, so the shared
          // flags would report a row edit as this dialog saving - and now that
          // `saving` freezes the form, that would disable a dialog the user is
          // typing in for a write that has nothing to do with it.
          saving={savingGearAttempt === dialog}
          saveError={dialog.saveError}
          onClose={() => setDialog(null)}
          onCreateCategory={(categoryName) => addCategory.mutateAsync(categoryName)}
          onSave={(gearPatch, listPatch) => {
            // `attempt` is the exact DialogState this save was submitted from, and
            // every completion below is applied only if it is STILL the open dialog.
            // The dialog stays dismissable while saving (deliberately - abandoning a
            // slow save is legitimate), and without the guard a late failure would
            // re-open a dismissed dialog, remounted and therefore blank, while a late
            // success would close whichever dialog the user opened in the meantime.
            const attempt: DialogState = { ...dialog, saveError: null }
            const gearTarget = dialog.gear
            const listTarget = dialog.listItem
            // Installing `attempt` also clears the previous try's error.
            setDialog(attempt)
            setSavingGearAttempt(attempt)
            const settle = (next: (prev: DialogState) => DialogState | null) =>
              setDialog((prev) => (prev === attempt ? next(prev) : prev))
            void (async () => {
              try {
                try {
                  await updateGearItem.mutateAsync({ id: gearTarget.id, patch: gearPatch })
                } catch {
                  settle((prev) => ({
                    ...prev,
                    saveError:
                      "Couldn't confirm those gear changes saved. Try again, or refresh to check.",
                  }))
                  return
                }
                if (listPatch && listTarget) {
                  try {
                    await updateItem.mutateAsync({ itemId: listTarget.id, patch: listPatch })
                  } catch {
                    settle((prev) => ({
                      ...prev,
                      saveError:
                        "Saved the gear changes, but couldn't confirm the update to this list item. Try again, or refresh to check.",
                    }))
                    return
                  }
                }
                settle(() => null)
              } finally {
                setSavingGearAttempt((prev) => (prev === attempt ? null : prev))
              }
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
          without a dialog; this row is being USED AS a packing container, so
          removing it also removes that container and moves its contents to
          Unassigned. That is intended behavior - gear-backed containers
          cannot outlive their gear - but it changes more than the row that
          was clicked, so it gets named first rather than happening
          silently. See list-item-removal.ts for the rule. */}
      {dialog?.type === 'remove-container-item' && (
        <ConfirmDialog
          title={dialog.location ? 'Remove container from list' : 'Remove from list'}
          // Descriptive, not alarming. Losing the container along with the
          // gear is the intended outcome - a container that IS a piece of
          // gear cannot outlive it - and its contents going to Unassigned is
          // where they belong. The dialog exists because that is a bigger
          // change than the row the user clicked, not because it is a
          // mistake.
          message={dialog.location
            ? `"${dialog.item.gearItem.name}" is being used as a packing container. Removing it from this list also removes the "${dialog.location.name}" container, and anything packed inside it moves to Unassigned. The gear item stays in your library.`
            // Fail-safe wording: we could not load this list's packing
            // locations, so we cannot say whether this row is a container.
            // Claiming it is would be a guess; saying nothing would spring
            // the container removal on the user unannounced.
            : `Couldn't check whether "${dialog.item.gearItem.name}" is being used as a packing container. If it is, removing it also removes that container and moves its contents to Unassigned. The gear item stays in your library.`}
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
  locationsResolved,
  loadFailed,
  onRetry,
  creationPending,
  draft,
  onDraftChange,
  onCreate,
}: {
  locations: PackingLocation[]
  /** Has the locations query actually answered? An empty array alone cannot
   *  tell "this list has no locations" from "we haven't loaded them yet". */
  locationsResolved: boolean
  /** The query settled in error. Distinct from !locationsResolved, which is
   *  also true while it is merely in flight - only a settled failure has
   *  something to tell the user and something to retry. */
  loadFailed: boolean
  onRetry: () => void
  creationPending: boolean
  draft: string
  onDraftChange: (value: string) => void
  onCreate: (name: string) => void
}) {
  const trimmed = draft.trim()
  const atCap = locations.length >= PACKING_LOCATION_CAP
  // noValidate makes maxLength inert for SUBMIT purposes (AGENTS.md), so the
  // length check is manual here and the server is the real gate.
  //
  // locationsResolved is part of this, not just of the nudge below: an
  // unresolved query means `locations` is [] because we do not know, which
  // makes the cap check above vacuous and hands the optimistic insert a slot
  // computed against no locations at all.
  const canSubmit =
    locationsResolved && Boolean(trimmed) && trimmed.length <= 60 && !atCap && !creationPending

  return (
    <div className="space-y-3 print:hidden">
      {/* Sits with the control it explains, and OUTSIDE the items branch this
          notice used to live in - an empty list whose locations failed showed a
          disabled Add with no reason given and no way to recover. */}
      {loadFailed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>Couldn&apos;t load packing locations. Showing the last available grouping.</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}
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

      {locationsResolved && locations.length === 0 ? (
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
