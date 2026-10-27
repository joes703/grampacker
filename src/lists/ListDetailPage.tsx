import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ListSidebarDrawer from './ListSidebarDrawer'
import {
  queryKeys,
  updateList,
  reorderPackingLocations,
  makeOptimisticUpdate,
  fetchPackingLocations,
  type ListItemPatch,
} from '../lib/queries'
import { queries } from '../lib/queries/options'
import { mutationKeys } from '../lib/queries/keys'
import type { Category, GearItem, ListItemWithGear, List, PackingLocation } from '../lib/types'
import { authClient } from '../lib/auth-client'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg, useIsBelowXl } from '../lib/use-breakpoint'
import { useReorderable } from '../lib/use-reorderable'
import {
  writeLastListPath,
  readLastListPath,
  clearLastListPath,
  getListIdFromListPath,
} from '../lib/last-list-path'
import { useGroupedListItems } from '../lib/use-grouped-list-items'
import { wornItemsInDocumentOrder } from '../lib/worn-items'
import { computeListWeightBreakdown } from '../lib/weight-breakdown'
import FoodView from './FoodView'
import LibraryPanel from './LibraryPanel'
import DesktopListsPanel from './DesktopListsPanel'
import { FLAT_TABLE_SURFACE } from '../components/flat-table-styles'
import MobileListActionBar from './MobileListActionBar'
import ListDocumentToolbar from './ListDocumentToolbar'
import { useListResetActions } from './use-list-reset-actions'
import { useListItemActions } from './use-list-item-actions'
import { useListFood } from './use-list-food'
import { resolveRemovalPlan } from './list-item-removal'
import { useListGearActions } from './use-list-gear-actions'
import { type AddItemData } from './use-quick-add-form'
import { packingSortableRows, sortableRows } from './SortableCategoryRows'
import StatusPanel from '../components/StatusPanel'
import { useDocumentTitle } from '../lib/use-document-title'
import { useRegisterSidebarDrawer } from '../layout/sidebar-drawer-context'
import {
  listDocumentTitle,
  persistedListPath,
  type ListDetailMode,
} from './list-detail-mode'
import { selectPackGroupingState } from './packing-grouping'
import { buildPackingTree } from './packing-tree'
import { usePackingLocationActions } from './use-packing-location-actions'
import { useListDnd } from './use-list-dnd'
import PrintListHeader from './PrintListHeader'
import { useIsPrinting } from '../lib/use-is-printing'
import ListDialogs, { type DialogState } from './ListDialogs'
import ListDocument from './ListDocument'
import PackDocument from './PackDocument'

const EMPTY_LIST_ITEMS: ListItemWithGear[] = []
const EMPTY_GEAR_ITEMS: GearItem[] = []
const EMPTY_CATEGORIES: Category[] = []

export default function ListDetailPage({ mode }: { mode: ListDetailMode }) {
  // Mounted only under /lists/:id, so params.id is guaranteed by the route.
  const { id } = useParams<{ id: string }>()
  const routeId = id!

  // key={routeId} forces a fresh ListDetailInner instance per list, so local
  // state (open dialogs, draft inputs, etc.) doesn't leak when the user
  // switches lists. Keyed by list only: switching views on one list keeps it.
  return <ListDetailInner key={routeId} listId={routeId} mode={mode} />
}

function ListDetailInner({ listId, mode }: { listId: string; mode: ListDetailMode }) {
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
  } = useQuery(queries.lists())
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

  const list = lists.find((l) => l.id === listId)
  // The list name once it resolves; "Lists" while the lists query is pending
  // so the title doesn't briefly drop to the bare app name.
  useDocumentTitle(list ? listDocumentTitle(list.name, mode) : 'Lists')

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

  const listItemsQuery = useQuery(queries.listItems(listId))
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

  const gearItemsQuery = useQuery(queries.gearItems())
  const gearItems = gearItemsQuery.data ?? EMPTY_GEAR_ITEMS

  // Id lookups for the drag handlers and the drag overlay, which run on
  // every drag tick. Click handlers scan the cache instead (readListItems).
  const listItemsById = useMemo(
    () => new Map(listItems.map((i) => [i.id, i])),
    [listItems],
  )

  const categoriesQuery = useQuery(queries.categories())
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
  // useReorderable rather than a bare useQuery because this page's tree
  // renders the location sections (PackingLocationTree), and the hook's own
  // useQuery subscription is what keeps the optimistic reorder write and the drop animation in one
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

  // Gear and category writes reachable from this list. The hook owns their
  // cache wiring across ['gear-items'] and every ['list-items', *] cache.
  const gearActions = useListGearActions(categories)
  const { updateGearItem, addCategory } = gearActions

  // List-item writes. The hook owns their optimistic cache wiring; the page
  // keeps the stable handlers that call `.mutate` on them.
  const { addItem, updateItem, deleteItem, addNewItemOnce, moveItem } = useListItemActions(listId, {
    listItems,
    foodItems: listFood.items,
  })

  // Packing-location admin: create, rename, delete, promote an item to a
  // container.
  const locationActions = usePackingLocationActions(listId, packingLocations)
  const { createLocation, createItemContainer, removeLocation } = locationActions
  const locationCreationPending =
    createLocation.isPending || createItemContainer.isPending

  // A pending optimistic bag delete makes cached locations lie about what
  // is rendered, so structural writes wait for it to settle.
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

  // Drag and drop: the handlers, narration, the two reorder mutations and the
  // packing derivations they consume.
  const dnd = useListDnd({
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

  // Worn rows are always extracted into one trailing section in Edit and Pack.
  const wornItems = wornItemsInDocumentOrder(grouped)

  // Handlers that run on a user gesture read gear and list items from the
  // query cache at that moment, so the callbacks below never depend on the
  // data and stay stable (rebuilding them would re-render every section on
  // each checkbox tick). The cache can be empty before the first load.
  const readGearItems = () => qc.getQueryData(queries.gearItems().queryKey) ?? EMPTY_GEAR_ITEMS
  const readListItems = () => qc.getQueryData(queries.listItems(listId).queryKey) ?? EMPTY_LIST_ITEMS

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
      removalPreflightRef.current.add(li.id)
      void (async () => {
        try {
          const plan = await resolveRemovalPlan(qc, listId, li.id)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- qc and setDialog are stable; deleteItem is a TanStack mutation result (.mutate is stable, the wrapper is not); refs are stable; listId is fixed for this component instance (keyed by list)
    [],
  )

  const onLibraryRemove = useCallback(
    (item: GearItem) => {
      const li = readListItems().find((l) => l.gearItemId === item.id)
      if (li) requestRemoveListItem(li)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the query cache at call time; requestRemoveListItem is stable
    [],
  )

  // Stable callback for CategoryGroup's "+ Add new item" affordance.
  // CategoryGroup's onAddItem signature is (categoryId, data) => void so we
  // can pass ONE memoized handler to both the categorized and uncategorized
  // call sites instead of two fresh inline arrows.
  const onAddNewItem = useCallback(
    (categoryId: string | null, data: AddItemData) => {
      addNewItemOnce(categoryId, data)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addNewItemOnce: see addItem note
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
          // Close the drawer too, so the user sees the new item land in the
          // list.
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

  // Opens the full gear editor or the phone's compact one for one item.
  // Hoisted out of sharedGroupProps because Pack also reaches it from the
  // packing kebab, a container's section header and the worn row's button.
  //
  // Reads the cache at call time, so this is stable for the life of the page:
  // rebuilding it would rebuild sharedGroupProps and re-render every section.
  const openEditor = useCallback((type: 'edit-gear' | 'quick-edit-item', gearId: string) => {
    const g = readGearItems().find((x) => x.id === gearId)
    const li = readListItems().find((l) => l.gearItem.id === gearId)
    if (g) setDialog({ type, gear: g, listItem: li ?? null, saveError: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the read helpers use only qc and listId, both fixed for this instance
  }, [setDialog])

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
        const li = readListItems().find((item) => item.id === itemId)
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
      onEditGearItem: (gearId: string) =>
        openEditor(isBelowLg ? 'quick-edit-item' : 'edit-gear', gearId),
      // No onDeleteGearItem: the row menu deliberately offers no inventory
      // delete (ItemRow's RowKebab says why). GearItemDialog's own delete
      // path (ListDialogs) still works from Edit.
      // Quick status - same updateGearItem path the dialog uses, so the
      // existing list-items fan-out (gearItem.status is in the embedded
      // projection) keeps open list views consistent.
      onSetGearStatus: (gearId: string, status: GearItem['status']) =>
        updateGearItem.mutate({ id: gearId, patch: { status } }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above re: mutation refs
    [mode, grouping.kind, weightUnit, isBelowLg, showUnpackedOnly, showUnreadyOnly],
  )

  const onDeleteLocation = (location: PackingLocation) =>
    setDialog({ type: 'delete-location', location })

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
      <StatusPanel
        title="List not found"
        body="This list may have been deleted or the link is no longer valid."
        showBackToLists
      />
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 print:pb-0">
      {/* Full width, above the columns, in every mode. The columns below
          differ by mode (List has the aside from lg, Pack only from xl
          and centers a capped document, Food has no aside), so a toolbar
          inside the document column moved sideways on every view switch. */}
      <ListDocumentToolbar list={list} mode={mode} />

      {/* Two columns: the gear picker aside (List and Pack; Food has its
          own left rail) and the list document. */}
      <div className="flex gap-4 items-start">
        {/* LEFT column — Lists switcher above the gear library picker.
            DesktopListsPanel is the primary desktop workflow for list
            switching/management; /lists remains the mobile management page
            and a desktop fallback (e.g. when no lists exist).

            Pack shows it too: adding or reweighing one item while packing
            must not mean leaving the view. But Pack's aside starts at xl,
            not lg. At 1024px the shell's 32px
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

            Pack is capped at the Food view's measure (max-w-3xl, centered by
            mx-auto): without the aside, below xl, pack rows stretched across
            the whole shell. Paper lifts the cap (print:max-w-none) and uses
            the full printable width for two columns of sections instead (see
            PackDocument). */}
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
          ) : mode === 'pack' ? (
            <PackDocument
              listItems={listItems}
              grouped={grouped}
              groupingKind={grouping.kind}
              packingTree={packingTree}
              wornItems={wornItems}
              breakdown={weightBreakdown}
              groupProps={sharedGroupProps}
              dnd={dnd}
              listItemsById={listItemsById}
              weightUnit={weightUnit}
              isBelowLg={isBelowLg}
              isBelowXl={isBelowXl}
              filters={{
                showUnpackedOnly: showUnpackedOnlySetting,
                onToggleShowUnpackedOnly: () => setShowUnpackedOnly((v) => !v),
                showUnreadyOnly: showUnreadyOnlySetting,
                onToggleShowUnreadyOnly: () => setShowUnreadyOnly((v) => !v),
              }}
              onResetPacked={resetPacked}
              onResetReady={resetReady}
              locations={{
                items: packingLocations,
                resolved: packingLocationsResolved,
                loadFailed: packingGroupingState.showErrorNotice,
                onRetry: retryPackingLocations,
                active: activeLocation,
                reorderPending: locationReorderPending,
                creationPending: locationCreationPending,
              }}
              locationActions={locationActions}
              onDeleteLocation={onDeleteLocation}
              onAddItem={onAddNewItem}
              onEditItem={(gearId) => openEditor('edit-gear', gearId)}
              onRemoveItem={requestRemoveListItem}
              onOpenDrawer={() => setDrawerOpen(true)}
            />
          ) : (
            <ListDocument
              list={list}
              notes={{
                editing: notesEditing,
                onEditingChange: setNotesEditing,
                saving: notesMut.isPending,
                onSave: (v, callbacks) => notesMut.mutate(v, callbacks),
              }}
              listItems={listItems}
              categories={categories}
              grouped={grouped}
              breakdown={weightBreakdown}
              food={listFood.items}
              foodGrams={foodGrams}
              starterCategories={starterCategories}
              onCreateCategory={(name) => addCategory.mutateAsync(name)}
              onCategoryCreated={(category) => setStarterCategories((prev) => [...prev, category])}
              onAddItem={onAddNewItem}
              onOpenDrawer={() => setDrawerOpen(true)}
              groupProps={sharedGroupProps}
              dnd={dnd}
              listItemsById={listItemsById}
              weightUnit={weightUnit}
              isBelowLg={isBelowLg}
            />
          )}
        </div>
      </div>

      {/* Gear-library drawer: mirrors the desktop left aside. Dismissed by
          backdrop tap, the close button, or Escape. Stays open across
          add/remove actions so the user can build up a list quickly.

          Below lg: edit and pack, since there is no room for the aside there.
          At lg+: pack only, for the lg-to-xl band where Pack has no aside
          (PackDocument's Add gear button opens it).

          Food is excluded at every width: it has no drawer registration (see
          useRegisterSidebarDrawer above, gated the same `edit || pack` way)
          and MobileListActionBar pushes no Add there. */}
      {((isBelowLg && mode !== 'food') || mode === 'pack') && (
        <ListSidebarDrawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Add from gear">
          <div className="flex h-full flex-col">{libraryPane}</div>
        </ListSidebarDrawer>
      )}

      <ListDialogs
        dialog={dialog}
        setDialog={setDialog}
        categories={categories}
        gearActions={gearActions}
        updateItem={updateItem}
        deleteItem={deleteItem}
        requestRemoveListItem={requestRemoveListItem}
        removeLocation={(id) => removeLocation.mutate(id)}
      />

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
