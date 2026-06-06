import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
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
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
const ListSidebarDrawer = lazy(() => import('./ListSidebarDrawer'))
import { useRequireSession } from '../auth/use-require-session'
import {
  queryKeys,
  fetchLists,
  fetchListItems,
  fetchGearItems,
  fetchCategories,
  createCategory,
  nextCategorySortOrder,
  nextGearItemSortOrder,
  nextListItemSortOrder,
  addGearItemToList,
  updateListItem,
  deleteListItem,
  resetPackedForList,
  resetReadyForList,
  updateList,
  reorderListItems,
  updateGearItem,
  deleteGearItem,
  makeOptimisticReorder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  type ListItemPatch,
} from '../lib/queries'
import { supabase } from '../lib/supabase'
import type { Category, GearItem, ListItemWithGear, List } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useOnline } from '../lib/use-online'
import { useLatestRef } from '../lib/use-latest-ref'
import {
  writeLastListPath,
  readLastListPath,
  clearLastListPath,
  getListIdFromListPath,
} from '../lib/last-list-path'
import { parseDnDId } from '../lib/dnd-ids'
import { showToast } from '../lib/toast'
import { assignSortOrderSlots } from '../lib/grouping'
import { useGroupedListItems } from '../lib/use-grouped-list-items'
import { useStableWornItems } from '../lib/use-stable-worn-items'
import { applyPendingPackedStates, applyPendingReadyStates } from '../lib/offline-packed-queue'
import { useOfflinePackedSync } from './use-offline-packed-sync'
import {
  fanOutGearListItemsCaches,
  rollbackListItemsCaches,
  invalidateListItemsCaches,
  patchAffectsListItemsView,
} from './list-items-fan-out'
import { randomTempId } from '../lib/random-temp-id'
import WeightSummary from './WeightSummary'
import LibraryPanel from './LibraryPanel'
import DesktopListsPanel from './DesktopListsPanel'
import { FLAT_TABLE_EYEBROW, FLAT_TABLE_SURFACE } from '../components/flat-table-styles'
import MobileListActionBar from './MobileListActionBar'
import MobilePackToggle from './MobilePackToggle'
import ListDocumentToolbar from './ListDocumentToolbar'
import EmptyListCell from './EmptyListCell'
import PrintListHeader from './PrintListHeader'
import PackingProgress from './PackingProgress'
import NotesEditor from './NotesEditor'
import { type AddItemData } from './use-quick-add-form'
import CategoryGroup from './CategoryGroup'
import PanelCard from './PanelCard'
import ItemRow from './ItemRow'
import GearItemDialog from '../gear/GearItemDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import { useDocumentTitle } from '../lib/use-document-title'
import { useRegisterSidebarDrawer } from '../layout/sidebar-drawer-context'

type Mode = 'edit' | 'pack'

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

export default function ListDetailPage() {
  // Default title for the wrapper; ListDetailInner overrides with the list
  // name once it mounts and the list resolves. Stays as "Lists" briefly while
  // the lists query is pending.
  useDocumentTitle('Lists')
  // Mounted only at /lists/:id, so params.id is guaranteed by the route.
  // Asserting here narrows routeId to string for ListDetailInner's listId prop.
  const { id } = useParams<{ id: string }>()
  const routeId = id!
  const auth = useRequireSession()
  const qc = useQueryClient()

  // userId pre-declared before the query so the owner-scoped fetchLists has
  // it. Empty-string fallback covers the brief in-flight-signout window
  // (PrivateRoute redirects the moment session is null; the early-return
  // below handles the same case post-render). The owner-scoped query passes
  // userId as the user_id filter — empty string returns empty results
  // rather than the unfiltered union.
  const userIdForQuery = auth?.userId ?? ''
  // isPending captures the "no data yet" window for first load. Passing it
  // through to the inner lets the not-found branch wait for the query to
  // settle before declaring the list missing — without this, the default
  // empty-array fallback would render "List not found" on every cold load
  // for ~1 paint before the query resolves.
  const { data: lists = [], isPending: listsLoading } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userIdForQuery),
  })

  // PrivateRoute usually keeps session non-null here, but if it goes null
  // mid-render (logout), bail out cleanly instead of throwing.
  if (!auth) return null
  const userId = auth.userId

  // key={routeId} forces a fresh ListDetailInner instance per list, so local
  // state (open dialogs, draft inputs, etc.) doesn't leak when the user
  // switches lists.
  return (
    <ListDetailInner
      key={routeId}
      listId={routeId}
      lists={lists}
      listsLoading={listsLoading}
      userId={userId}
      qc={qc}
    />
  )
}

function ListDetailInner({
  listId,
  lists,
  listsLoading,
  userId,
  qc,
}: {
  listId: string
  lists: List[]
  listsLoading: boolean
  userId: string
  qc: ReturnType<typeof useQueryClient>
}) {
  // Pack mode is URL-represented as ?mode=pack so it's bookmarkable,
  // refresh-stable, and back/forward navigable. Anything other than the
  // exact string 'pack' (missing, garbage, typo) falls back to edit mode
  // silently. The toggle UI lives in ListDocumentToolbar at md+ and in
  // MobilePackToggle at <lg (a list-page control, not bottom-bar nav);
  // this hook owns both the read and the write. Public share view at
  // /r/:slug is a different page and never sees this parameter.
  const [searchParams, setSearchParams] = useSearchParams()
  const mode: Mode = searchParams.get('mode') === 'pack' ? 'pack' : 'edit'
  function togglePackMode() {
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev)
        if (mode === 'pack') np.delete('mode')
        else np.set('mode', 'pack')
        return np
      },
      { replace: false },
    )
  }
  const { weightUnit } = useWeightUnit()
  // Page-level breakpoint, prop-drilled into rows via sharedGroupProps so a
  // long list registers ONE matchMedia subscription instead of one per row.
  const isBelowLg = useIsBelowLg()
  // Page-level online state. Pack-mode checkmarks queue locally while
  // offline; Reset packed remains online-only because it is a bulk server
  // mutation with no per-row intent to replay.
  const online = useOnline()
  // Pack-mode filter: when true, hide already-packed items from each
  // category. Header counts and the "complete" affordance still reflect the
  // full items array. Lifted here because both PackingProgress (the toggle)
  // and CategoryGroup (the filter consumer) live as children of this page.
  const [showUnpackedOnly, setShowUnpackedOnly] = useState(false)
  // Notes panel edit mode. Lifted here so PanelCard.headerAction can
  // render the pencil button conditionally (read mode only) without
  // exposing NotesEditor's internal state up through a callback.
  const [notesEditing, setNotesEditing] = useState(false)
  // "Group worn" is per-list and persisted on lists.group_worn — derived
  // below from the resolved list row, not local state. Applies in both
  // normal and pack mode, and is honored on /r/<slug>.
  // Mobile sidebar drawer — open/setOpen are owned by SidebarDrawerContext
  // so the trigger button in NavBar (a sibling subtree under AppShell) can
  // toggle the same state. The hook also sets `available` so NavBar knows
  // to render the trigger only on this page.
  const { open: drawerOpen, setOpen: setDrawerOpen } = useRegisterSidebarDrawer()
  // Single discriminated union for every transient dialog/modal/inline-form
  // on this page. Mirrors the pattern in src/gear/GearLibraryPage.tsx —
  // `type` discriminator, `null` for the closed state. Folding the partial-
  // save error into the edit-gear variant means closing the dialog or
  // switching gear items naturally discards the error: no separate state to
  // keep in sync.
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const {
    pendingCheckStates,
    pendingPackedStates,
    pendingReadyStates,
    packingSyncing,
    packingSyncBlocked,
    queueOfflinePackedState,
    queueOfflineReadyState,
    retrySync: onRetrySync,
    clearPackedForReset: clearPackedQueueForReset,
    clearReadyForReset: clearReadyQueueForReset,
  } = useOfflinePackedSync({
    userId,
    listId,
    online,
    updateListItem,
    // Immediate cache feedback per-item so a partial-failure scenario
    // doesn't leave the cache showing pre-sync state for items that
    // already synced (we don't invalidate in the error path). Apply
    // whichever fields the patch carried — Ready and Packed can sync in
    // one PATCH if both were toggled offline for the same item.
    onItemSynced: (itemId, patch) => {
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr
          ? curr.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
          : curr,
      )
    },
    onSyncComplete: () => {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
    onSyncError: () => {
      showToast("Couldn't sync packing checkmarks. Try Retry, or we'll try again next time you reconnect.", { type: 'error' })
    },
    onItemsDropped: (count) => {
      const msg = count === 1
        ? "Couldn't sync 1 packing change. Refresh to see the latest state."
        : `Couldn't sync ${count} packing changes. Refresh to see the latest state.`
      showToast(msg, { type: 'error' })
    },
  })

  const list = lists.find((l) => l.id === listId)
  // Inner overrides the wrapper's "Lists" default with the list name once
  // it resolves; falls back to "Lists" while the lists query is pending so
  // the title doesn't briefly drop to the bare app name.
  useDocumentTitle(list?.name ?? 'Lists')

  // M4 cache write: stash the list path only AFTER the list resolves to
  // a real, RLS-permitted row. Writing on mount unconditionally would
  // make a stale cache sticky — RootRedirect would send user B to user
  // A's list and the unconditional write would refresh the bad path,
  // locking the loop in. The reactive dep `list?.id` is undefined while
  // the lists query is in-flight or the route is invalid, so no write
  // fires on those paths. The `mode` dep tracks pack-mode toggling so
  // the stored path stays in sync: enters pack mode -> stored path
  // gains ?mode=pack; exits -> stored path drops it.
  useEffect(() => {
    if (list?.id) {
      const path = mode === 'pack' ? `/lists/${list.id}?mode=pack` : `/lists/${list.id}`
      writeLastListPath(path)
    }
  }, [list?.id, mode])

  // M4 cache self-heal: if the route's listId is the cached one but the
  // list isn't in the user's `lists` collection (deleted, different user
  // under stale cache), clear the cache so the next `/` visit takes the
  // slow path instead of looping back here. Compare the cached path's
  // extracted UUID against listId so an unrelated missing-list deep-link
  // doesn't wipe a valid cache. Gated on !listsLoading so the in-flight
  // window — where `list` is undefined for a different reason — doesn't
  // wipe a perfectly valid cache during cold load.
  useEffect(() => {
    if (listsLoading) return
    if (!list && listId) {
      const cachedPath = readLastListPath()
      if (cachedPath && getListIdFromListPath(cachedPath) === listId) {
        clearLastListPath()
      }
    }
  }, [list, listId, listsLoading])

  const { data: serverListItems = [] } = useQuery({
    queryKey: queryKeys.listItems(listId),
    queryFn: () => fetchListItems(listId, userId),
  })
  const listItems = useMemo(
    () => applyPendingReadyStates(
      applyPendingPackedStates(serverListItems, pendingPackedStates),
      pendingReadyStates,
    ),
    [serverListItems, pendingPackedStates, pendingReadyStates],
  )

  const { data: gearItems = [] } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: () => fetchGearItems(userId),
  })

  // O(1) id lookups for DnD callbacks and DragOverlay rendering. Linear
  // scan would be fine at typical N (~50 list_items per list); the Map
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

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => fetchCategories(userId),
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const addCategoryMut = useMutation({
    mutationFn: (name: string) => createCategory(userId, name, nextCategorySortOrder(categories)),
    ...makeOptimisticInsert<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      optimistic: (name) => ({
        id: `temp-${randomTempId()}`,
        user_id: userId,
        name,
        sort_order: nextCategorySortOrder(categories),
        is_default: false,
        created_at: new Date().toISOString(),
      }),
    }),
  })

  const addMut = useMutation({
    mutationFn: (item: GearItem) =>
      addGearItemToList(listId, userId, item.id, nextListItemSortOrder(listItems)),
    ...makeOptimisticInsert<ListItemWithGear, GearItem>({
      qc,
      queryKey: queryKeys.listItems(listId),
      optimistic: (item) => {
        const now = new Date().toISOString()
        return {
          // Temp id replaced by the server row on settled refetch. The
          // randomTempId() suffix avoids any collision with real ids.
          id: `temp-${randomTempId()}`,
          list_id: listId,
          user_id: userId,
          gear_item_id: item.id,
          gear_item: {
            id: item.id,
            name: item.name,
            description: item.description,
            weight_grams: item.weight_grams,
            category_id: item.category_id,
            status: item.status,
          },
          quantity: 1,
          is_worn: false,
          is_consumable: false,
          is_packed: false,
          is_ready: false,
          sort_order: nextListItemSortOrder(listItems),
          created_at: now,
          updated_at: now,
        }
      },
    }),
  })

  // mutationKey is used by the onSettled override below to detect sibling
  // updates still in flight. Two parallel updateMut calls (e.g. tapping
  // Packed then Ready in quick succession) each carry their own PATCH; the
  // first to settle fires invalidateQueries, which races the second PATCH
  // and can overwrite its optimistic value with stale server data. Gating
  // the invalidate on "no other update-list-item mutations are pending"
  // makes only the LAST settled call refetch — by then both server writes
  // are durable.
  const updateMutKey = ['update-list-item', listId] as const
  const updateMutOptimistic = makeOptimisticUpdate<
    ListItemWithGear,
    { itemId: string; patch: ListItemPatch }
  >({
    qc,
    queryKey: queryKeys.listItems(listId),
    id: ({ itemId }) => itemId,
    apply: (item, { patch }) => ({ ...item, ...patch }),
  })
  const updateMut = useMutation({
    mutationKey: updateMutKey,
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ListItemPatch }) =>
      updateListItem(itemId, patch),
    ...updateMutOptimistic,
    onSettled: () => {
      // qc.isMutating excludes mutations that have already entered settled
      // state (success/error) by the time their own onSettled runs, so a
      // non-zero count means at least one sibling is still pending.
      if (qc.isMutating({ mutationKey: updateMutKey }) > 0) return
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteListItem,
    ...makeOptimisticDelete<ListItemWithGear, string>({
      qc,
      queryKey: queryKeys.listItems(listId),
      id: (itemId) => itemId,
    }),
  })

  const reorderItemsMut = useMutation({
    mutationFn: reorderListItems,
    ...makeOptimisticReorder<ListItemWithGear>(qc, queryKeys.listItems(listId)),
  })

  const notesMut = useMutation({
    mutationFn: (description: string) => updateList(listId, { description: description || null }),
    ...makeOptimisticUpdate<List, string>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => listId,
      apply: (item, description) => ({
        ...item,
        description: description || null,
        updated_at: new Date().toISOString(),
      }),
    }),
  })

  // Toggling the per-list "Add ready checks" flag. The control lives inline
  // at the top of PackingProgress now that List options is hidden in pack
  // mode; ListSettingsPanel used to own this mutation but the panel itself
  // never renders in pack mode, so the mutation moves up here next to
  // notesMut / reorder paths. Optimistic flip mirrors the prior shape
  // exactly so the ToggleSwitch reflects the change immediately.
  const readyChecksMut = useMutation({
    mutationFn: () => updateList(listId, { ready_checks_enabled: !(list?.ready_checks_enabled ?? false) }),
    ...makeOptimisticUpdate<List, void>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => listId,
      apply: (item) => ({ ...item, ready_checks_enabled: !item.ready_checks_enabled }),
    }),
  })

  // Editing gear from a list writes to gear_items so the change propagates
  // to the gear library and every list that uses the same item. The
  // ['list-items', *] fan-out is what closes B-2: without it, an immediate
  // reorder after a category change reads stale embedded category_id and
  // writes corrupted sort_order.
  const updateGearItemMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
      updateGearItem(id, patch),
    onMutate: ({ id, patch }) => {
      qc.cancelQueries({ queryKey: queryKeys.gearItems() })
      const previousGear = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
      qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
        curr ? curr.map((g) => (g.id === id ? { ...g, ...patch } : g)) : curr,
      )
      // Skip the cross-cache fan-out when the patch doesn't touch any
      // gear field that list_items projects via its embedded gear_item
      // join (name, description, weight_grams, category_id). A
      // sort_order- or cost-only edit can't change anything the list
      // view renders; the gear-items cache update above is enough.
      const listSnapshots = patchAffectsListItemsView(patch)
        ? fanOutGearListItemsCaches(qc, id, (items) =>
            items.map((item) =>
              item.gear_item_id === id
                ? { ...item, gear_item: { ...item.gear_item, ...patch } }
                : item,
            ),
          )
        : []
      return { previousGear, listSnapshots }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previousGear) qc.setQueryData(queryKeys.gearItems(), ctx.previousGear)
      if (ctx?.listSnapshots) rollbackListItemsCaches(qc, ctx.listSnapshots)
    },
    onSettled: (_data, _err, _vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      if (ctx?.listSnapshots) invalidateListItemsCaches(qc, ctx.listSnapshots)
    },
  })

  // Delete a gear item entirely (gear library and every list that uses it).
  // gear_items.id is referenced by list_items with ON DELETE CASCADE on
  // gear_item_id, so deleting a gear_item also removes every list_item that
  // references it. makeOptimisticDelete only touches the ['gear-items']
  // cache; the ['list-items', *] fan-out is what makes the row vanish on
  // /lists/:id immediately instead of waiting for the settled refetch.
  const deleteHelper = makeOptimisticDelete<GearItem, string>({
    qc,
    queryKey: queryKeys.gearItems(),
    id: (id) => id,
  })
  const deleteGearItemMut = useMutation({
    mutationFn: deleteGearItem,
    onMutate: (id: string) => {
      const helperCtx = deleteHelper.onMutate(id)
      const listSnapshots = fanOutGearListItemsCaches(qc, id, (items) =>
        items.filter((item) => item.gear_item_id !== id),
      )
      return { ...helperCtx, listSnapshots }
    },
    onError: (err, vars, ctx) => {
      deleteHelper.onError(err, vars, ctx)
      if (ctx?.listSnapshots) rollbackListItemsCaches(qc, ctx.listSnapshots)
      showToast("Couldn't delete that item. Please try again.", { type: 'error' })
    },
    onSettled: (_data, _err, _vars, ctx) => {
      // Dual invalidation: ON DELETE CASCADE on list_items.gear_item_id
      // means the gear-item delete also removes its list_items rows, so
      // both caches need to refetch (gear library + every list it was on).
      deleteHelper.onSettled()
      if (ctx?.listSnapshots) invalidateListItemsCaches(qc, ctx.listSnapshots)
    },
  })

  // List Detail "Quick Add" is the per-category "Add new item" affordance
  // (desktop inline AddItemRow or mobile QuickAddItemModal, both driven by
  // useQuickAddForm). It creates a gear_item (so the item also lands in the
  // gear library) and the matching list_item together, under the category
  // whose section the user added from.
  //
  // Quick Add intentionally collects only the fields needed to put a new
  // item on this list: name, description, weight, quantity, worn,
  // consumable. Full inventory details like cost and purchase date live in
  // GearItemDialog, not here. They are deliberately out of scope for Quick
  // Add, not missing by accident.
  //
  // The add_gear_item_with_list_item RPC matches that contract exactly: one
  // round-trip that inserts both rows atomically, with cost/purchase_date
  // fixed at null. SECURITY INVOKER as of 20260514202025_reduce_security_definer
  // (was DEFINER when introduced); ownership is enforced by the inline
  // auth.uid() check on p_user_id plus RLS on gear_items/list_items running
  // under the invoker. Pure cache-invalidate on success; the RPC return value
  // (gear_item_id, list_item_id) is unused because the invalidate refetches
  // both queries.
  const addNewItemMut = useMutation({
    mutationFn: async ({ categoryId, data }: { categoryId: string | null; data: AddItemData }) => {
      const { error } = await supabase.rpc('add_gear_item_with_list_item', {
        p_user_id: userId,
        p_name: data.name,
        p_description: data.description,
        p_weight_grams: data.weight_grams,
        p_category_id: categoryId,
        p_gear_sort_order: nextGearItemSortOrder(gearItems),
        p_list_id: listId,
        p_list_item_sort_order: nextListItemSortOrder(listItems),
        p_quantity: data.quantity,
        p_is_worn: data.is_worn,
        p_is_consumable: data.is_consumable,
      })
      if (error) throw error
    },
    meta: { errorToast: "Couldn't add that item. Please try again." },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  // Guards against the inline Quick Add row firing twice when the user
  // commits the same draft rapidly (Enter then blur, or two Enter presses).
  // Each press fires a fresh add_gear_item_with_list_item RPC; without a
  // gate the second succeeds and creates a duplicate gear_item +
  // list_item. addNewItemMut.isPending lives on a fresh useMutation result
  // each render, so reading it through a [] -deps useCallback closure is
  // stale; a ref is the stable handle.
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

  // Active drag id (always an item id on this page — categories are not
  // reorderable here; that's /gear-only). The DragOverlay below uses it to
  // render an item-row clone during item drag.
  const [activeId, setActiveId] = useState<string | null>(null)

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  // Single page-level drag handler. Within-category item reorder only —
  // category-level DnD is /gear-only (categories on this page render in
  // their global order but cannot be reordered here). Cross-category drops
  // are deliberately rejected: moving an item between categories happens
  // exclusively via the item edit modal. A drop whose destination differs
  // from the source category is ignored (item snaps back).
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    if (active.id === over.id) return

    const activeParsed = parseDnDId(String(active.id))
    const overParsed = parseDnDId(String(over.id))
    if (!activeParsed || !overParsed) return
    if (activeParsed.kind !== 'item' || overParsed.kind !== 'item') return

    // Within-category item reorder. The drop target must be another item
    // AND in the same category as the dragged item. Anything else
    // (cross-category drop, drop on empty space) is ignored.
    const activeItem = listItemsById.get(activeParsed.id)
    if (!activeItem) return
    const overItem = listItemsById.get(overParsed.id)
    if (!overItem) return
    const activeCat = activeItem.gear_item.category_id
    if (overItem.gear_item.category_id !== activeCat) return

    const itemsInCat = listItems.filter((i) => i.gear_item.category_id === activeCat)
    const oldIndex = itemsInCat.findIndex((i) => i.id === activeParsed.id)
    const newIndex = itemsInCat.findIndex((i) => i.id === overParsed.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(itemsInCat, oldIndex, newIndex)
    reorderItemsMut.mutate(assignSortOrderSlots(reordered))
  }

  // Field-scoped snapshot + rollback. resetPacked and resetReady are
  // genuinely independent (different fields, different RPCs), so they
  // must be safe to interleave. The earlier whole-row `previous`
  // snapshot wasn't: a rollback restored every field on the row, so a
  // failing reset would stomp the other reset's optimistic clear (or
  // its already-server-committed clear before invalidate refetched).
  //
  // The fix: each reset only snapshots the ids whose own field was
  // true at the moment of clear, and on failure flips ONLY that field
  // back. The other reset's writes pass through untouched. No mutex
  // needed; the operations compose.
  async function resetPacked() {
    // Defense-in-depth offline guard. The PackingProgress button is also
    // disabled when offline so this path shouldn't be reachable, but a
    // bypassed UI state (e.g. a stale render between offline event and
    // re-render) shouldn't fire a doomed mutation.
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    // Invalidate any in-flight sync loop AND drop the pending queue
    // before clearing the server. clearPackedQueueForReset bumps the
    // hook's sync generation so the loop's pre/post-await aborted()
    // checks trip and the loop won't re-introduce packed=true values
    // into the cache after this point.
    clearPackedQueueForReset()
    // Optimistic clear — flip is_packed=false on every cached item so the UI
    // updates immediately, then issue a single PATCH and invalidate to settle.
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const snapshot = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    const wasPackedIds = snapshot
      ? new Set(snapshot.filter((i) => i.is_packed).map((i) => i.id))
      : new Set<string>()
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.is_packed ? { ...i, is_packed: false } : i)) : curr,
    )
    try {
      await resetPackedForList(listId)
    } catch (err) {
      // Restore only is_packed=true on the ids we cleared. Any concurrent
      // resetReady write on those same rows survives because we never
      // touch is_ready here.
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr ? curr.map((i) => (wasPackedIds.has(i.id) ? { ...i, is_packed: true } : i)) : curr,
      )
      throw err
    } finally {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    }
  }

  // Mirror of resetPacked for Ready Checks. Reset Ready and Reset Packed
  // are independent: clearing one MUST NOT clear the other on the cache
  // or in the offline queue. clearReadyQueueForReset drops only the
  // is_ready field from each pending entry (keeping any pending is_packed
  // intact) and bumps the same syncGeneration so an in-flight loop's
  // post-await aborted() check trips before its next per-item callback.
  async function resetReady() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    clearReadyQueueForReset()
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const snapshot = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    const wasReadyIds = snapshot
      ? new Set(snapshot.filter((i) => i.is_ready).map((i) => i.id))
      : new Set<string>()
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.is_ready ? { ...i, is_ready: false } : i)) : curr,
    )
    try {
      await resetReadyForList(listId)
    } catch (err) {
      qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
        curr ? curr.map((i) => (wasReadyIds.has(i.id) ? { ...i, is_ready: true } : i)) : curr,
      )
      throw err
    } finally {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    }
  }


  // ── Derived data ───────────────────────────────────────────────────────────

  // Stable across pack-mode toggles. The naive `useMemo([listItems])` shape
  // mints a fresh Set on every list-items mutation — including is_packed
  // toggles where membership did not change — which busts LibraryPanel's
  // React.memo barrier on the inner CategoryGroup.
  //
  // Fix: derive a primitive membership signature during render (a sorted
  // join of gear_item_ids) and key the Set's useMemo on that signature, not
  // on the listItems array reference. When pack-mode flips an item's
  // is_packed but membership is unchanged, gearIdsKey is identical and the
  // Set keeps its prior reference. When the user adds or removes gear,
  // gearIdsKey changes and the Set rebuilds — same behavior as before, but
  // only when it actually matters.
  //
  // The sort is order-independent intentionally: list-item reorder
  // shouldn't invalidate the membership Set. Cost is O(n log n) on the
  // id strings per render, negligible at our row counts.
  const gearIdsKey = listItems
    .map((i) => i.gear_item_id)
    .sort()
    .join('|')
  const listItemGearIds = useMemo(
    () => new Set(listItems.map((i) => i.gear_item_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gearIdsKey is the membership signature; depending on listItems would defeat the stability we're after
    [gearIdsKey],
  )

  const grouped = useGroupedListItems(listItems, categories)

  // Group Worn: hide is_worn items inside each category and render them in
  // a trailing Worn section. Phase 5 follow-up: worn-hiding is done at the
  // leaf via CategoryGroup's `hideWorn` prop (same shape as the existing
  // `showUnpackedOnly`), so unchanged categories keep their stable items
  // reference from useGroupedListItems. The trailing Worn section gets its
  // items from useStableWornItems, which holds the prior result and reuses
  // it when worn membership + worn-item references are unchanged. Sourced
  // from list.group_worn (per-list, persisted) and active in both normal
  // and pack mode.
  const showWornGroup = list?.group_worn ?? false
  const wornItems = useStableWornItems(grouped, showWornGroup)

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
  // on the inner CategoryGroup. addMut / deleteMut follow the same
  // mutation-ref convention as sharedGroupProps below — `.mutate` is read
  // through the live binding at call time, never depended on directly.
  const onLibraryAdd = useCallback(
    (item: GearItem) => addMut.mutate(item),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addMut is a TanStack mutation result; .mutate is stable, the wrapper is not
    [],
  )
  const onLibraryRemove = useCallback(
    (item: GearItem) => {
      const li = listItemsRef.current.find((l) => l.gear_item_id === item.id)
      if (li) deleteMut.mutate(li.id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deleteMut see addMut note; listItemsRef is a ref (always-stable)
    [],
  )

  // Stable callback for CategoryGroup's "+ Add new item" affordance.
  // Phase 5 widened CategoryGroup's onAddItem signature from
  // (data) => void to (categoryId, data) => void so we can pass ONE
  // memoized handler to both the categorized and uncategorized call
  // sites instead of two fresh inline arrows. addNewItemMut see prior
  // mutation-ref convention.
  const onAddNewItem = useCallback(
    (categoryId: string | null, data: AddItemData) => {
      if (addingNewItemRef.current) return
      addingNewItemRef.current = true
      addNewItemMut.mutate(
        { categoryId, data },
        { onSettled: () => { addingNewItemRef.current = false } },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addNewItemMut: see addMut note
    [],
  )

  // Per-row handler bag passed to every CategoryGroup. Memoized so each
  // category section doesn't re-render on every parent state change.
  //
  // Mutation refs are intentionally NOT in deps. TanStack Query rebuilds the
  // useMutation result object on every render (the wrapper is fresh; only
  // the internal `.mutate` callback is stable), so depending on `updateMut`
  // etc. would defeat the memo and re-create this bag every render. Calling
  // `.mutate` through the live binding is safe: the closure resolves
  // `updateMut.mutate` at call time, which is always the current stable ref.
  // setDialog (the React useState setter) is React-guaranteed stable.
  const sharedGroupProps = useMemo(
    () => ({
      packMode: mode === 'pack',
      readyChecksEnabled: list?.ready_checks_enabled ?? false,
      weightUnit,
      isBelowLg,
      sortable: true,
      showUnpackedOnly,
      // Pack-mode checkboxes stay active offline. Only reset remains
      // online-only; individual ticks queue locally and sync on reconnect.
      packActionsDisabled: false,
      onUpdate: (itemId: string, patch: ListItemPatch) => {
        // Pack-mode checks (is_packed and is_ready) queue locally when
        // offline; everything else routes through the server mutation
        // (and will fail offline by design — see help.md "Mobile and
        // offline use"). When BOTH pack-fields are present in one patch
        // we queue each independently so the merged storage entry can
        // sync as a single PATCH on reconnect.
        if (!online) {
          const offlinePackedValue = patch.is_packed
          const offlineReadyValue = patch.is_ready
          const queuedPacked = typeof offlinePackedValue === 'boolean'
          const queuedReady = typeof offlineReadyValue === 'boolean'
          if (queuedPacked || queuedReady) {
            if (queuedPacked) queueOfflinePackedState(itemId, offlinePackedValue)
            if (queuedReady) queueOfflineReadyState(itemId, offlineReadyValue)
            // Optimistic cache update for whichever fields toggled. We
            // build the next item by spreading both fields so a future
            // batched patch (packed + ready in one click) lands atomically.
            qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
              curr
                ? curr.map((item) => {
                    if (item.id !== itemId) return item
                    const next = { ...item }
                    if (queuedPacked) next.is_packed = offlinePackedValue
                    if (queuedReady) next.is_ready = offlineReadyValue
                    return next
                  })
                : curr,
            )
            return
          }
        }
        updateMut.mutate({ itemId, patch })
      },
      onDelete: (itemId: string) => deleteMut.mutate(itemId),
      onSaveGearName: (gearId: string, n: string) =>
        updateGearItemMut.mutate({ id: gearId, patch: { name: n } }),
      onSaveGearDescription: (gearId: string, d: string) =>
        updateGearItemMut.mutate({ id: gearId, patch: { description: d } }),
      onSaveGearWeight: (gearId: string, w: number) =>
        updateGearItemMut.mutate({ id: gearId, patch: { weight_grams: w } }),
      onEditGearItem: (gearId: string) => {
        const g = gearItemsRef.current.find((x) => x.id === gearId)
        const li = listItemsRef.current.find((l) => l.gear_item.id === gearId)
        if (g) setDialog({ type: 'edit-gear', gear: g, listItem: li ?? null, saveError: null })
      },
      onDeleteGearItem: (gearId: string) => {
        const g = gearItemsRef.current.find((x) => x.id === gearId)
        if (g) setDialog({ type: 'delete-gear', candidate: g })
      },
      // Quick status — same updateGearItemMut path the dialog uses, so the
      // existing list-items fan-out (gear_item.status is in the embedded
      // projection) keeps open list views consistent.
      onSetGearStatus: (gearId: string, status: GearItem['status']) =>
        updateGearItemMut.mutate({ id: gearId, patch: { status } }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above re: mutation refs
    [mode, list?.ready_checks_enabled, weightUnit, isBelowLg, showUnpackedOnly, online],
  )

  // ── Loading / not found ────────────────────────────────────────────────────

  // Cold-load window: lists query in-flight, no resolved list yet. Render a
  // neutral skeleton instead of "List not found" — the latter is reserved
  // for the genuinely-missing case (deleted list, stale deep link, RLS
  // miss). Without this gate, every cold load on /lists/:id flashed
  // "List not found" for ~1 paint before the query resolved.
  if (listsLoading && !list) {
    return <div className="h-64" aria-busy="true" />
  }

  if (!list) {
    // Terminal "missing list" state: deleted list, stale deep link, or RLS
    // miss. MobilePrimaryNav suppresses itself on /lists/:id (the page is
    // expected to render its own richer bar), and the mobile top-nav menu
    // only exposes Help/Settings/Sign out. Without an in-content action
    // here, a mobile user lands in a navigation dead-end. Render an empty
    // state with a Back-to-lists link so there's always a way out.
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
      <PrintListHeader list={list} listItems={listItems} categories={categories} />

      {/* Mobile pack-mode toggle. Pack is a mode of THIS list, not a
          global destination, so it lives on the list page rather than in
          the mobile bottom bar (which now stays uniform Gear/Lists/Add/
          Options across every page). Desktop's equivalent toggle is in
          ListDocumentToolbar below. */}
      <MobilePackToggle packMode={mode === 'pack'} onTogglePackMode={togglePackMode} />

      {/* Two-column grid (sidebar collapses in pack mode). The visibility
          condition is `mode !== 'pack'` — derived directly, not stored. */}
      <div className="flex gap-4 items-start">
        {/* LEFT column — Lists switcher above the gear library picker.
            Hidden in pack mode on desktop so the user can focus on packing.
            DesktopListsPanel is the primary desktop workflow for list
            switching/management; /lists remains the mobile management page
            and a desktop fallback (e.g. when no lists exist). */}
        {mode !== 'pack' && (
          <aside
            className="hidden lg:flex w-80 shrink-0 flex-col gap-3 sticky self-start print:hidden"
            style={{ top: '1rem', height: 'calc(100vh - 2rem)' }}
          >
            {/* shrink-0 + max-h-72 keeps the lists switcher compact even
                with many lists: the panel scrolls internally beyond that
                cap and the gear picker below always has room. */}
            <DesktopListsPanel
              userId={userId}
              lists={lists}
              currentListId={listId}
              className="shrink-0 max-h-72"
            />

            <div className={`flex flex-col min-h-0 flex-1 ${FLAT_TABLE_SURFACE}`}>
              {/* Quiet section header — labels the panel as the picker for
                  pulling existing gear into this list. The Gear destination
                  is reached via the primary nav (top bar + mobile bottom bar). */}
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
                <span className={FLAT_TABLE_EYEBROW}>
                  Add from gear
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                <LibraryPanel
                  gearItems={gearItems}
                  categories={categories}
                  listItemGearIds={listItemGearIds}
                  weightUnit={weightUnit}
                  onAdd={onLibraryAdd}
                  onRemove={onLibraryRemove}
                />
              </div>
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
            packMode={mode === 'pack'}
            onTogglePackMode={togglePackMode}
          />

          {/* Pack-mode progress bar */}
          {mode === 'pack' && listItems.length > 0 && (
            <div className="print:hidden">
              <PackingProgress
                total={listItems.length}
                packed={listItems.filter((i) => i.is_packed).length}
                onReset={resetPacked}
                showUnpackedOnly={showUnpackedOnly}
                onToggleShowUnpackedOnly={() => setShowUnpackedOnly((v) => !v)}
                offline={!online}
                pendingSyncCount={pendingCheckStates.length}
                syncing={packingSyncing}
                syncBlocked={packingSyncBlocked}
                onRetrySync={onRetrySync}
                readyChecks={{
                  ready: listItems.filter((i) => i.is_ready).length,
                  enabled: list.ready_checks_enabled,
                  onResetReady: resetReady,
                  onToggleEnabled: () => readyChecksMut.mutate(),
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
          {mode !== 'pack' && (
            <div className={`print:hidden grid gap-4 ${listItems.length > 0 ? 'grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]' : 'grid-cols-1'}`}>
              <PanelCard
                title="Notes"
                headerAction={
                  !notesEditing && (
                    <button
                      type="button"
                      onClick={() => setNotesEditing(true)}
                      aria-label="Edit notes"
                      title="Edit notes"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
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
              <WeightSummary items={listItems} categories={categories} />
            </div>
          )}

          {/* Items grouped by category */}
          {listItems.length === 0 ? (
            <EmptyListCell onMobileAdd={() => setDrawerOpen(true)} />
          ) : (() => {
            const activeParsed = activeId ? parseDnDId(activeId) : null
            const activeItem =
              activeParsed?.kind === 'item' ? (listItemsById.get(activeParsed.id) ?? null) : null
            return (
              <div className="flex flex-col gap-3">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  {/* Categories render in their global sort_order but are not
                      reorderable here — category-level DnD is /gear-only. Each
                      CategoryGroup still renders a per-category SortableContext
                      internally so items reorder within their category. */}
                  {grouped
                    .filter((g) => g.category !== null)
                    .map((group) => {
                      // group.category is narrowed by the filter above; destructure
                      // to capture it as a non-null local so JSX below doesn't need
                      // a non-null assertion. The `if (!category) return null` is
                      // unreachable in practice — filter already excluded nulls —
                      // but keeps TS happy without resorting to a typeguard.
                      const { category } = group
                      if (!category) return null
                      return (
                        <CategoryGroup
                          key={category.id}
                          name={category.name}
                          categoryId={category.id}
                          items={group.items}
                          {...sharedGroupProps}
                          reorderPending={reorderItemsMut.isPending}
                          hideWorn={showWornGroup}
                          onAddItem={onAddNewItem}
                        />
                      )
                    })}
                  {grouped
                    .filter((g) => g.category === null)
                    .map((group) => (
                      <CategoryGroup
                        key="__uncategorized__"
                        name="Uncategorized"
                        categoryId={null}
                        items={group.items}
                        {...sharedGroupProps}
                        reorderPending={reorderItemsMut.isPending}
                        hideWorn={showWornGroup}
                        onAddItem={onAddNewItem}
                      />
                    ))}
                  <DragOverlay dropAnimation={null}>
                    {activeItem ? (
                      <ItemRow item={activeItem} weightUnit={weightUnit} isBelowLg={isBelowLg} />
                    ) : null}
                  </DragOverlay>
                </DndContext>

                {/* Worn section — visible in both normal and pack mode when
                    list.group_worn is on and at least one worn item exists.
                    Sits outside the DndContext: it isn't a reorder target
                    (sortable=false), and worn items don't render inside
                    their original category sections while grouping is on
                    (CategoryGroup's hideWorn handles that). Spreads the
                    same sharedGroupProps every in-category section uses so
                    row chrome stays consistent — including readyChecksEnabled
                    (Ready checkbox column in Pack mode), packActionsDisabled,
                    onSetGearStatus, edit/delete handlers, weight unit, and
                    breakpoint. Worn-specific overrides come after the spread
                    so they win: section name "Worn", the stable wornItems
                    list, and sortable={false}. The items array walks
                    categories in display order so in-section order is
                    stable and predictable. */}
                {showWornGroup && wornItems.length > 0 && (
                  <CategoryGroup
                    {...sharedGroupProps}
                    name="Worn"
                    items={wornItems}
                    sortable={false}
                  />
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Mobile gear-library drawer — mirrors the desktop left aside.
          Slides in from the LEFT, dismissed by overlay tap, the close
          button, or Escape. Stays open across multiple add/remove
          actions so the user can build up a list quickly.

          JS-gated by isBelowLg so desktop genuinely doesn't mount the
          drawer; React.lazy on the wrapper means desktop also never
          fetches the Radix Dialog chunk. Combined with the H5 Phase-3
          carry-over, this is what actually moves the drawer code out
          of the main bundle. */}
      {isBelowLg && (
        <div className="print:hidden">
          <Suspense fallback={null}>
            <ListSidebarDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
            >
              <LibraryPanel
                gearItems={gearItems}
                categories={categories}
                listItemGearIds={listItemGearIds}
                weightUnit={weightUnit}
                onAdd={onLibraryAdd}
                onRemove={onLibraryRemove}
              />
            </ListSidebarDrawer>
          </Suspense>
        </div>
      )}

      {/* Gear-item edit (reached from the row tap on mobile or the kebab →
          Edit on any viewport). Reuses GearItemDialog and, when a list_item
          accompanies the gear item, renders an "On this list" section with
          quantity / worn / consumable controls.
          Save runs sequentially: gear first, then the per-list patch. If
          the gear write fails, nothing is applied. If the gear write
          succeeds but the list write fails, the gear changes are committed
          but the list_item is unchanged — surfaced via dialog.saveError so
          the user can retry (PATCH is idempotent on the gear side) or
          close to keep the partial result intentionally.
          updateGearItemMut already invalidates ['list-items'] (broad) so
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
                  is_worn: editDialogListItem.is_worn,
                  is_consumable: editDialogListItem.is_consumable,
                }
              : undefined
          }
          saving={updateGearItemMut.isPending || updateMut.isPending}
          saveError={dialog.saveError}
          onClose={() => setDialog(null)}
          onCreateCategory={(categoryName) => addCategoryMut.mutateAsync(categoryName)}
          onSave={async (gearPatch, listPatch) => {
            const gearTarget = dialog.gear
            const listTarget = dialog.listItem
            // Reset prior error so the user sees fresh state for this attempt.
            // Spread the variant so we keep the targets while clearing saveError.
            setDialog({ ...dialog, saveError: null })
            try {
              await updateGearItemMut.mutateAsync({ id: gearTarget.id, patch: gearPatch })
            } catch {
              setDialog({ ...dialog, saveError: "Couldn't save gear changes. No changes were applied." })
              return
            }
            if (listPatch && listTarget) {
              try {
                await updateMut.mutateAsync({ itemId: listTarget.id, patch: listPatch })
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
          }}
          onRemoveFromList={
            editDialogListItem
              ? () => {
                  setDialog(null)
                  deleteMut.mutate(editDialogListItem.id)
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


      {/* Delete-from-inventory confirm (reached from the kebab). Removes the
          gear item from the library and cascades to every list_item that
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
            deleteGearItemMut.mutate(target.id)
          }}
        />
      )}

      {/* Mobile-only bottom action bar. Gear / Lists / Add / Options
          in normal mode; Options is dropped in pack mode (pack-mode
          controls live inline in PackingProgress, and List options is
          list-admin not needed mid-pack). MobilePackToggle above
          carries the Pack toggle itself. lg:hidden inside the bar
          itself, so desktop never renders it. */}
      <MobileListActionBar list={list} packMode={mode === 'pack'} />

    </div>
  )
}
