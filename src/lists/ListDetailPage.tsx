import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
const ListSidebarDrawer = lazy(() => import('./ListSidebarDrawer'))
import {
  queryKeys,
  fetchLists,
  fetchListItems,
  fetchGearItems,
  fetchCategories,
  fetchPackingLocations,
  updateList,
  reorderPackingLocations,
  makeOptimisticUpdate,
  type ListItemPatch,
} from '../lib/queries'
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
import { parseDnDId } from '../lib/dnd-ids'
import { useGroupedListItems } from '../lib/use-grouped-list-items'
import { useStableWornItems } from '../lib/use-stable-worn-items'
import {
  baseGramsForCategory,
  computeListWeightBreakdown,
  consumableGramsForCategory,
  wornGramsForCategory,
} from '../lib/weight-breakdown'

import WeightSummary from './WeightSummary'
import FoodView from './FoodView'
import type { FoodItemResponse } from '../../shared/food'
import LibraryPanel from './LibraryPanel'
import DesktopListsPanel from './DesktopListsPanel'
import { FLAT_TABLE_SURFACE } from '../components/flat-table-styles'
import MobileListActionBar from './MobileListActionBar'
import ListDocumentToolbar from './ListDocumentToolbar'
import EmptyListCell from './EmptyListCell'
import AddCategoryControl from './AddCategoryControl'
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
import QuickEditItemModal from './QuickEditItemModal'
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
import { selectPackGroupingState } from './packing-grouping'
import { buildPackingTree } from './packing-tree'
import { usePackingLocationActions } from './use-packing-location-actions'
import { useListDnd, EMPTY_FOOD_ITEMS } from './use-list-dnd'
import MoveToLocationMenu from './MoveToLocationMenu'
import PackLocationControls from './PackLocationControls'
import PackingLocationTree from './PackingLocationTree'
import PrintListHeader from './PrintListHeader'
import { PlacementProvider } from './placement-context'
import { DroppableUnassignedSection } from './SortablePackSection'
import { PACKING_LOCATION_CAP } from '../lib/caps'
import { useIsPrinting } from '../lib/use-is-printing'
import { runGuardedSave } from '../lib/guarded-save'

// PrintListHeader (the print-only document header this note used to promise
// "returns with the CSV/print slice") is back, above the toolbar in pack
// mode. The print:* classes scattered through the row components were never
// inert, as that note claimed - Tailwind emitted them and they worked; what
// they lacked was a density tier and a document header to sit under.
// docs/ui-density.md "The print tier" is the current account of how printing
// works, including the parts that are NOT CSS.
// TRANSPLANT NOTE (tabs): the old page rendered ListWorkspaceTabs (a
// Gear/Pack two-tab remnant) above ListDocumentToolbar. The toolbar now owns
// direct List / Organize / Pack navigation; the old workspace tab strip returns

const EMPTY_LIST_ITEMS: ListItemWithGear[] = []
const EMPTY_GEAR_ITEMS: GearItem[] = []
const EMPTY_CATEGORIES: Category[] = []

// Every transient dialog/modal/inline-form on this page lives in one
// discriminated union, set/cleared atomically. `null` is the closed state
// (matching the pattern in src/gear/GearLibraryPage.tsx). edit-gear folds
// the optional list-item context AND the partial-save error message into
// one variant so they can never drift apart.
type DialogState =
  | { type: 'edit-gear'; gear: GearItem; listItem: ListItemWithGear | null; saveError: string | null }
  // The phone editor: name, weight, quantity, flags. Same shape as
  // edit-gear so More details can switch between them without losing the
  // target. Opened by the mobile row tap (sharedGroupProps picks it below
  // lg); the full form stays the desktop Edit and the Gear page's editor.
  | { type: 'quick-edit-item'; gear: GearItem; listItem: ListItemWithGear | null; saveError: string | null }
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

export default function ListDetailPage() {
  // Mounted only at /lists/:id, so params.id is guaranteed by the route.
  // Asserting here narrows routeId to string for ListDetailInner's listId prop.
  const { id } = useParams<{ id: string }>()
  const routeId = id!

  // key={routeId} forces a fresh ListDetailInner instance per list, so local
  // state (open dialogs, draft inputs, etc.) doesn't leak when the user
  // switches lists. That key is this wrapper's whole job: everything else,
  // including the lists query, lives in the instance it remounts.
  return <ListDetailInner key={routeId} listId={routeId} />
}

function ListDetailInner({ listId }: { listId: string }) {
  // The lists collection, subscribed here rather than in the wrapper:
  // TanStack dedupes subscriptions on the key, so this is the same fetch
  // DesktopListsPanel and the wrapper would share anyway, and the flags are
  // needed HERE - "is this list actually missing, or do we just not know?"
  // needs `list`, which only this component resolves.
  //
  // isPending captures the "no data yet" window for first load, so the
  // not-found branch can wait for the query to settle before declaring the
  // list missing — without this, the default empty-array fallback would
  // render "List not found" on every cold load for ~1 paint. The session
  // cookie scopes the fetch server-side; there is no client-side userId
  // filter.
  //
  // isError and isFetching matter more: the `= []` default made a FAILED
  // lists fetch indistinguishable from a successful empty one, so a dropped
  // connection rendered the terminal "List not found" state - copy that
  // tells the user their list was deleted - with no retry. In TanStack Query
  // v5 a failed background refetch sets status to 'error' while KEEPING the
  // cached collection, so `isError` alone cannot be used as a terminal
  // failure signal - see the status branches below.
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
  const onRetryLists = useCallback(() => {
    void refetchLists()
  }, [refetchLists])

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
  // refresh-stable, and back/forward navigable. The retired spellings - the
  // two /organize paths from before Organize merged into Pack - derive to
  // Pack AND get rewritten to /pack below, so old bookmarks and home-screen
  // shortcuts land in the view that replaced them rather than on a dead
  // route. Both facts come from the same predicate in list-detail-mode.ts:
  // this page used to keep exact-match copies of the checks, and
  // /lists/<id>/organize/ then rendered Pack without the rewrite.
  const location = useLocation()
  const navigate = useNavigate()
  const isLegacyPath = isLegacyOrganizePath(location.pathname, listId)
  const mode: ListDetailMode = deriveListMode(location.pathname, listId)
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
  const [showUnpackedOnlySetting, setShowUnpackedOnly] = useState(false)
  // Peer of showUnpackedOnly for the ready column: "what still needs prepping".
  // Independent, not a mode switch - with both on you see only the rows that
  // are neither packed nor ready. Deliberately NOT persisted, same as its
  // sibling: a filter that survives a reload hides items from a user who has
  // forgotten they turned it on.
  const [showUnreadyOnlySetting, setShowUnreadyOnly] = useState(false)
  // Printing renders the FULL list, whatever the filters are set to.
  //
  // These filters drop rows from the rendered arrays (CategoryGroup does the
  // filtering in JS), so unlike ordinary chrome they cannot be undone by a
  // print stylesheet - a sheet printed with a filter on is silently missing
  // gear, and the filter switches themselves do not print, so nothing on the
  // paper explains the gap. A printed checklist is only useful if it is the
  // whole list. The switches keep their own state and snap back afterwards;
  // see useIsPrinting for why the re-render has to be flushed synchronously.
  const isPrinting = useIsPrinting()
  const showUnpackedOnly = isPrinting ? false : showUnpackedOnlySetting
  const showUnreadyOnly = isPrinting ? false : showUnreadyOnlySetting
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
  // Categories created from THIS page this session, so their sections can
  // render while still empty. The list view hides empty categories on
  // purpose (your 30 gear categories must not all appear in every list), so
  // without this a category created here would be invisible until its first
  // item - a dead end. Session-local by design: an abandoned empty category
  // disappears from the list on reload and stays available on /gear.
  // Whole Category objects, not ids: the server row arrives before the
  // ['categories'] refetch lands, and a section that flashes out of
  // existence during that gap reads as the create failing.
  const [starterCategories, setStarterCategories] = useState<Category[]>([])
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
  // The list name once it resolves; "Lists" while the lists query is pending
  // so the title doesn't briefly drop to the bare app name.
  useDocumentTitle(list ? listDocumentTitle(list.name, mode) : 'Lists')

  // Only the path changes. The search string and hash travel with the URL
  // unchanged.
  useEffect(() => {
    if (isLegacyPath) {
      void navigate(
        {
          pathname: persistedListPath(listId, 'pack'),
          search: location.search,
          hash: location.hash,
        },
        { replace: true },
      )
    }
  }, [isLegacyPath, listId, location.hash, location.search, navigate])

  // Last-list cache write: stash the list path only AFTER the list resolves
  // to a real, server-permitted row. Writing on mount unconditionally would
  // make a stale cache sticky — the nav shortcut would send the user to a
  // dead list and the unconditional write would refresh the bad path,
  // locking the loop in. The reactive dep `list?.id` is undefined while
  // the lists query is in-flight or the route is invalid, so no write
  // fires on those paths. The `mode` dep tracks peer-mode toggling so the
  // stored path stays in sync with List, Pack, or Food - the three shapes
  // persistedListPath produces and last-list-path's validator accepts.
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
  const { addItem, updateItem, deleteItem, addNewItem, moveItem } = useListItemActions(listId, {
    listItems,
    foodItems: listFood.items,
  })

  // Packing-location admin (create / rename / delete / promote an item to a
  // container), lifted from the retired OrganizePackPanel unchanged.
  const { createLocation, createItemContainer, renameLocation, removeLocation } =
    usePackingLocationActions(listId, packingLocations)
  const locationCreationPending =
    createLocation.isPending || createItemContainer.isPending

  // A pending optimistic bag delete makes cached locations lie about what
  // is rendered; structural writes wait for it to settle (round-7).
  // useListDnd folds this, with location creation, into itemDragPending.
  const structuralWritePending = locationCreationPending || removeLocation.isPending

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
  const packingTree = useMemo(
    () => mode === 'pack' && packingLocations.length > 0
      ? buildPackingTree(listItems, packingLocations, {
          includeItem: (item) => !item.isWorn,
        })
      : null,
    [listItems, packingLocations, mode],
  )

  // Drag, drop and click-to-place orchestration - the handlers, narration,
  // placement lifecycle, the two reorder mutations and the packing
  // derivations they consume - lives in useListDnd. The destructured names
  // are unchanged, so every consumer below reads as before the move.
  const {
    sensors,
    activeId,
    announcement,
    collisionDetection: packingCollisionDetection,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
    placement,
    placementActions,
    requestMove,
    requestMoveFood,
    anyItemReorderPending,
    itemDragPending,
    realLocations,
    containerMoveExclusions,
    packFoodItems,
    foodById,
    foodByLocation,
  } = useListDnd({
    listId,
    mode,
    groupingKind: grouping.kind,
    listItems,
    listItemsById,
    listFoodItems: listFood.items,
    packingLocations,
    packingTree,
    packingLocationsResolved,
    showUnpackedOnly,
    showUnreadyOnly,
    locationDrag: {
      onDragStart: handleLocationDragStart,
      onDragEnd: handleLocationDragEnd,
      onDragCancel: handleLocationDragCancel,
    },
    moveItem,
    moveFood: moveFoodMut,
    structuralWritePending,
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
  const wornItems = useStableWornItems(grouped)

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
        // The modal asks for the category (this caller has no section
        // context); null means the user kept Uncategorized. In Pack the item
        // lands Unassigned once the list has bags, or by category while it
        // falls back to category grouping.
        onCreateNew={(data, categoryId) => {
          // Close the drawer too, not just the modal. Below lg this panel
          // lives inside the sidebar drawer, whose 88vw content is z-50 -
          // the same layer as the toast, and painted after it. A failed
          // create would report into a toast the drawer covers - the class of
          // bug toasts had behind an open modal before they rendered inside it.
          setDrawerOpen(false)
          onAddNewItem(categoryId, data)
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
    // The refs and the useState setter are all stable for the life of the
    // page, so this never rebuilds. All three are listed because the two
    // hook lint rules track different subsets: exhaustive-deps wants the
    // refs, the compiler rule wants the setter.
  }, [gearItemsRef, listItemsRef, setDialog])

  // The phone row tap's editor: the compact form instead of the full
  // inventory dialog (UX audit 2026-10 - tapping a row to change one weight
  // opened cost, purchase date, status and a delete button). Same stability
  // story as openGearEditor above.
  const openQuickEditor = useCallback((gearId: string) => {
    const g = gearItemsRef.current.find((x) => x.id === gearId)
    const li = listItemsRef.current.find((l) => l.gearItem.id === gearId)
    if (g) setDialog({ type: 'quick-edit-item', gear: g, listItem: li ?? null, saveError: null })
  }, [gearItemsRef, listItemsRef, setDialog])

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
      // ''->null: the row's description cell emits '' on clear (allowEmpty),
      // and the write contract takes null, never ''.
      onSaveGearDescription: (gearId: string, d: string) =>
        updateGearItem.mutate({ id: gearId, patch: { description: d || null } }),
      onSaveGearWeight: (gearId: string, w: number) =>
        updateGearItem.mutate({ id: gearId, patch: { weightGrams: w } }),
      // Below lg this handler is the mobile row TAP (no kebab renders
      // there), so it opens the compact editor; at lg+ it is the kebab's
      // Edit, which keeps the full form.
      onEditGearItem: isBelowLg ? openQuickEditor : openGearEditor,
      // No onDeleteGearItem: the row menu deliberately offers no inventory
      // delete (ItemRow's RowKebab says why). GearItemDialog's own delete
      // path below still works from Edit.
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
  // re-renders every location section rather than the one that changed.
  //
  // PROFILED AND ACCEPTED (2026-10, jsdom at 1280px): a tick at the worst
  // case the caps allow (300 items across 30 locations) commits in ~140ms
  // jsdom / roughly 15-45ms in a browser, scaling linearly down to ~8ms
  // jsdom for one section of ten - inside the 100ms interaction budget even
  // at the extreme. Making this menu stable would NOT restore the memo hits
  // on a tick anyway: every list-items write rebuilds packingTree, which
  // hands every section a fresh `items` array, so the real fix is stable
  // callbacks PLUS identity-preserving tree builds - complexity well above
  // the measured cost. The stability discipline stays where it already
  // pays: edit mode and the library panel, whose arrays survive unrelated
  // page-state changes. Re-profile before adding cost to this path (more
  // per-row work, higher caps), not before ticking checkboxes.
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

  // The container header's menu, built here beside the row menus because it
  // shares their orchestration (requestMove, requestRemoveListItem,
  // openGearEditor). PackingLocationTree calls back into this per node.
  const renderContainerAction = (
    containerItem: ListItemWithGear,
    location: PackingLocation,
  ) => (
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
  )

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
      {/* Full width, above the columns, in every mode. The columns below
          differ by mode (List has the aside from lg, Pack only from xl
          and centers a capped document, Food has no aside), so a toolbar
          inside the document column moved sideways on every view switch. */}
      <ListDocumentToolbar list={list} mode={mode} />

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
            leaving the view and coming back.

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

            Pack is capped at the Food view's measure (max-w-3xl, centered in
            the leftover flex space by mx-auto). The cap was dropped once on
            the argument that the xl aside fills the width, but the aside only
            exists at xl - everywhere below that the document stretched across
            the whole shell and pack rows read as a ribbon. Paper lifts the
            cap (print:max-w-none) and uses the full printable width for two
            columns of sections instead (see the section wrapper below). */}
        <div
          data-testid="list-document-column"
          className={`flex-1 min-w-0 space-y-4 ${mode === 'pack' ? 'max-w-3xl mx-auto print:max-w-none' : ''}`}
        >
          {/* Paper's only document header. The screen toolbar below is
              print:hidden, so without this nothing on the sheet says which
              list it is. Pack only: the other modes are not checklists and
              have not been designed for paper. */}
          {mode === 'pack' && (
            <PrintListHeader name={list.name} />
          )}

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
                    showUnpackedOnly={showUnpackedOnlySetting}
                    onToggleShowUnpackedOnly={() => setShowUnpackedOnly((v) => !v)}
                    showUnreadyOnly={showUnreadyOnlySetting}
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
                        // Waits for a save the user canceled mid-flight: a
                        // second save would take over its callbacks, and its
                        // failure would go unreported.
                        <button
                          type="button"
                          onClick={() => setNotesEditing(true)}
                          disabled={notesMut.isPending}
                          aria-label="Edit notes"
                          title="Edit notes"
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                        >
                          <Pencil size={13} />
                        </button>
                      )
                    }
                  >
                    <NotesEditor
                      key={list.id}
                      initial={list.description ?? ''}
                      onSave={(v, callbacks) => notesMut.mutate(v, callbacks)}
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

              {/* Items grouped by category. A starter category (created from
                  this page, still empty) counts as content in CATEGORY view
                  only - its section renders there so the user can type the
                  first item in. Pack never renders starter sections, so
                  counting them there would blank Pack's empty-state guidance
                  while showing nothing in its place (Codex review). */}
              {listItems.length === 0 &&
              (mode === 'pack' || starterCategories.length === 0) &&
              (mode !== 'pack' || packFoodItems.length === 0) ? (
                <div className="flex flex-col gap-3">
                  <EmptyListCell onMobileAdd={() => setDrawerOpen(true)} />
                  {mode !== 'pack' && (
                    <AddCategoryControl
                      onCreate={(name) => addCategory.mutateAsync(name)}
                      onCreated={(category) =>
                        setStarterCategories((prev) => [...prev, category])
                      }
                    />
                  )}
                </div>
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
                  // Paper gets two columns in Pack: a checklist row is
                  // narrow, so one column wasted half of every sheet. Rows
                  // and section headers already refuse to split from what
                  // follows them (PRINT_KEEP_TOGETHER / PRINT_KEEP_WITH_NEXT),
                  // so a section may continue into the next column but never
                  // leaves a header or half a row behind. Block layout drops
                  // the flex gap, so each card carries its own margin there.
                  <div
                    data-testid={mode === 'pack' ? 'pack-print-columns' : undefined}
                    className={`flex flex-col gap-3 ${mode === 'pack' ? 'print:block print:columns-2 print:gap-4 print:*:mb-2' : ''}`}
                  >
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
                          <PackingLocationTree
                            roots={packingTree.roots}
                            groupProps={sharedGroupProps}
                            renderRowAction={renderPackRowAction}
                            renderFoodRowAction={packFoodRowAction}
                            renderContainerAction={renderContainerAction}
                            foodByLocation={foodByLocation}
                            itemReorderPending={anyItemReorderPending}
                            locationReorderPending={locationReorderPending || locationCreationPending}
                            movePending={itemDragPending}
                            renamingLocationId={renamingLocationId}
                            onStartRename={setRenamingLocationId}
                            onCancelRename={() => setRenamingLocationId(null)}
                            onRename={(id, name) => renameLocation.mutate({ id, name })}
                            onDeleteLocation={setDeleteLocationTarget}
                          />
                        </>
                      ) : (
                        <>
                        {grouped.map((group) => {
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
                                wornSubtotalGrams={wornGramsForCategory(weightBreakdown, definition.id)}
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
                              wornSubtotalGrams={wornGramsForCategory(weightBreakdown, null)}
                              onAddItem={onAddNewItem}
                            />
                          )
                        })}
                        {/* Starter sections: categories created from this
                            page that have no items yet (grouped hides empty
                            categories), rendered with the add-item row
                            already open - the whole point of making one is
                            typing an item into it next. Skipped once the
                            category has items (grouped covers it then). */}
                        {mode !== 'pack' &&
                          starterCategories
                            .filter((starter) => !grouped.some((group) => group.group?.id === starter.id))
                            // Prefer the cached row (it follows a rename on
                            // /gear); the stored object covers the gap before
                            // the refetch lands.
                            .map((starter) => categories.find((category) => category.id === starter.id) ?? starter)
                            .map((category) => (
                              <CategoryGroup
                                key={`starter-${category.id}`}
                                name={category.name}
                                categoryId={category.id}
                                items={EMPTY_LIST_ITEMS}
                                {...sharedGroupProps}
                                reorderPending={anyItemReorderPending}
                                onAddItem={onAddNewItem}
                                startAdding
                              />
                            ))}
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
                      {/* className reaches the overlay's own portaled
                          wrapper; the chips below are not descendants of
                          anything already print-hidden. */}
                      <DragOverlay dropAnimation={null} className="print:hidden">
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

                    {/* Worn section — PACK MODE ONLY: worn gear is a separate
                        pile when packing (you lay it out to wear, you do not
                        pack it). In the Category arrangement worn rows stay
                        inside their category - worn is a weight flag, not an
                        organizing principle, and flipping it must not move
                        the row (section-rows.ts owns the mode-scoped rule).
                        Sits outside the DndContext: it isn't a reorder target
                        (no renderRows), and in pack mode worn items don't
                        render inside their location sections. Spreads the
                        same sharedGroupProps every in-category section uses so
                        row chrome stays consistent — onSetGearStatus,
                        edit/delete handlers, weight unit, and breakpoint.
                        Worn-specific overrides come after the spread
                        so they win: section name "Worn", the stable wornItems
                        list, and renderRows={undefined} (no drag). The items
                        array is in document order (use-stable-worn-items
                        sorts it), not category order. regionKey is explicit
                        because this section passes no categoryId: without it
                        the collapsible region derives the same
                        'cat-region-uncategorized' id as the real Uncategorized
                        section above, duplicating the id in the document and
                        pointing both chevrons' aria-controls at one target.
                        No footer: pack mode renders none, and the list-level
                        worn total lives in the weight summary. */}
                    {mode === 'pack' && wornItems.length > 0 && (
                      <CategoryGroup
                        {...sharedGroupProps}
                        name="Worn"
                        items={wornItems}
                        regionKey="worn"
                        wornSection
                        renderRows={undefined}
                        renderRowAction={renderWornPackRowAction}
                      />
                    )}
                    {/* In-list category creation (List view only; pack
                        organizes by location, and category ORDER is still
                        authored on /gear). Every 2026-10 UX audit run went
                        hunting for this. */}
                    {mode !== 'pack' && (
                      <AddCategoryControl
                        onCreate={(name) => addCategory.mutateAsync(name)}
                        onCreated={(category) =>
                          setStarterCategories((prev) => [...prev, category])
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
                  one number in List, and the share showed neither.
                  List, Pack and the share now all show the rows.

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
                  // No "Edit" link, no kebab, no grip here: the rows are a
                  // read-out, authored in the Food view (ListViewNav's Food
                  // tab is the route), and one authoring path per thing.
                  // The gear rows above carry a leading grip and a trailing
                  // kebab; reserve both boxes empty so this table's cells
                  // and footer sit on the same rails as theirs.
                  reserveControlColumns
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
            // The dialog stays dismissable while saving (deliberately -
            // abandoning a slow save is legitimate), so the two-stage
            // completion goes through runGuardedSave's identity guard (see
            // src/lib/guarded-save.ts). Installing `attempt` also clears the
            // previous try's error.
            const attempt: DialogState = { ...dialog, saveError: null }
            const gearTarget = dialog.gear
            const listTarget = dialog.listItem
            runGuardedSave<DialogState>({
              attempt,
              setState: setDialog,
              setSaving: setSavingGearAttempt,
              run: async (settle) => {
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
              },
            })
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

      {/* The phone row tap's compact editor. Same two-stage guarded save as
          the full dialog above: gear fields first, then the list-item patch,
          each failure reported inline with copy that claims only what it can
          prove. More details switches to the full GearItemDialog with the
          same target, so nothing is re-looked-up. */}
      {dialog?.type === 'quick-edit-item' && (
        <QuickEditItemModal
          key={dialog.gear.id}
          gear={dialog.gear}
          listItem={dialog.listItem}
          saving={savingGearAttempt === dialog}
          saveError={dialog.saveError}
          onClose={() => setDialog(null)}
          // The drafts travel into the full form by overlaying the snapshots
          // it initializes from. GearItemDialog computes its save from its
          // own form values, so a draft-seeded baseline changes what the
          // form SHOWS, never what a save would write on its own.
          onMoreDetails={(gearDraft, listDraft) =>
            setDialog({
              type: 'edit-gear',
              gear: { ...dialog.gear, ...gearDraft },
              listItem:
                dialog.listItem && listDraft
                  ? { ...dialog.listItem, ...listDraft }
                  : dialog.listItem,
              saveError: null,
            })
          }
          onSave={(gearPatch, listPatch) => {
            const attempt: DialogState = { ...dialog, saveError: null }
            const gearTarget = dialog.gear
            const listTarget = dialog.listItem
            runGuardedSave<DialogState>({
              attempt,
              setState: setDialog,
              setSaving: setSavingGearAttempt,
              run: async (settle) => {
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
              },
            })
          }}
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
          in normal mode; the Options slot is an edit-mode shortcut only,
          since the document toolbar's List options button renders in every
          mode (see MobileListActionBar). The view navigation above stays
          available independently. lg:hidden inside the bar
          itself, so desktop never renders it. */}
      <MobileListActionBar list={list} mode={mode} />

    </div>
  )
}
