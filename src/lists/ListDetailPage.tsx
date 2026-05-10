import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { Backpack, ChevronRight, Plus, Upload } from 'lucide-react'
const ListSidebarDrawer = lazy(() => import('./ListSidebarDrawer'))
import { useRequireSession } from '../auth/use-require-session'
import {
  queryKeys,
  fetchLists,
  fetchListItems,
  fetchGearItems,
  fetchCategories,
  createCategory,
  addGearItemToList,
  updateListItem,
  deleteListItem,
  resetPackedForList,
  updateList,
  reorderListItems,
  updateGearItem,
  deleteGearItem,
  importCsvRowsToList,
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
import { parseListCsv, type ListImportRow } from '../lib/csv'
import { randomTempId } from '../lib/random-temp-id'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import WeightTable from './WeightTable'
import LibraryPanel from './LibraryPanel'
import PackingProgress from './PackingProgress'
import NotesEditor from './NotesEditor'
import { type AddItemData } from './AddItemRow'
import CategoryGroup from './CategoryGroup'
import PanelCard from './PanelCard'
import ItemRow from './ItemRow'
import ListImportPreviewDialog from './ListImportPreviewDialog'
import GearItemDialog from '../gear/GearItemDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
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
  | { type: 'delete-gear'; candidate: GearItem }
  | { type: 'import-preview'; rows: ListImportRow[]; filename: string }
  | { type: 'import-error'; message: string }

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
  // silently. The toggle UI lives in the top bar (NavBar's
  // ListContextControls / MobileMenu); this page reads the URL only.
  // Public share view at /r/:slug is a different page and never sees
  // this parameter.
  const [searchParams] = useSearchParams()
  const mode: Mode = searchParams.get('mode') === 'pack' ? 'pack' : 'edit'
  const { weightUnit } = useWeightUnit()
  // Page-level breakpoint, prop-drilled into rows via sharedGroupProps so a
  // long list registers ONE matchMedia subscription instead of one per row.
  const isBelowLg = useIsBelowLg()
  // Page-level online state. Pack-mode write actions (is_packed checkbox,
  // Reset packed) are disabled while offline by deliberate product choice
  // (no offline mutation outbox; honest capability boundary). Read-only
  // viewing of cached lists still works. Drilled through sharedGroupProps
  // so each row gets the same flag as a stable boolean rather than each
  // row subscribing to online events itself.
  const online = useOnline()
  // Pack-mode filter: when true, hide already-packed items from each
  // category. Header counts and the "complete" affordance still reflect the
  // full items array. Lifted here because both PackingProgress (the toggle)
  // and CategoryGroup (the filter consumer) live as children of this page.
  const [showUnpackedOnly, setShowUnpackedOnly] = useState(false)
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
  // `type` discriminator, `null` for the closed state. Folding gearDialogError
  // (for partial-save messaging) into the edit-gear variant means closing the
  // dialog or switching to a different gear item naturally discards the
  // error: there's no separate state to keep in sync.
  const [dialog, setDialog] = useState<DialogState | null>(null)

  // Counter that increments to programmatically focus LibraryPanel's search
  // input from the empty-state "Add from your inventory" affordance at lg+.
  // LibraryPanel watches the prop via useEffect with a skipInitialFocus ref,
  // so list-switches (which remount this whole subtree via key=routeId in
  // the wrapper) don't auto-focus.
  const [focusSearchTrigger, setFocusSearchTrigger] = useState(0)

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

  const { data: listItems = [] } = useQuery({
    queryKey: queryKeys.listItems(listId),
    queryFn: () => fetchListItems(listId, userId),
  })

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
    mutationFn: (name: string) => createCategory(userId, name, categories.length),
    ...makeOptimisticInsert<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      optimistic: (name) => ({
        id: `temp-${randomTempId()}`,
        user_id: userId,
        name,
        sort_order: categories.length,
        is_default: false,
        created_at: new Date().toISOString(),
      }),
    }),
  })

  const addMut = useMutation({
    mutationFn: (item: GearItem) =>
      addGearItemToList(listId, userId, item.id, listItems.length),
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
          },
          quantity: 1,
          is_worn: false,
          is_consumable: false,
          is_packed: false,
          sort_order: listItems.length,
          created_at: now,
          updated_at: now,
        }
      },
    }),
  })

  const updateMut = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ListItemPatch }) =>
      updateListItem(itemId, patch),
    ...makeOptimisticUpdate<ListItemWithGear, { itemId: string; patch: ListItemPatch }>({
      qc,
      queryKey: queryKeys.listItems(listId),
      id: ({ itemId }) => itemId,
      apply: (item, { patch }) => ({ ...item, ...patch }),
    }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteListItem,
    ...makeOptimisticDelete<ListItemWithGear, string>({
      qc,
      queryKey: queryKeys.listItems(listId),
      id: (itemId) => itemId,
    }),
  })

  // CSV import targeting the CURRENT list (not a new one — that path lives
  // on /lists). Reuses parseListCsv → preview → importCsvRowsToList. The
  // list itself isn't renamed, so the parsed filename is kept only for
  // display in the preview header (ListImportPreviewDialog uses it as a
  // title hint).
  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<ListImportRow>(parseListCsv, {
    onParsed: (rows, filename) => setDialog({ type: 'import-preview', rows, filename }),
    onError: (message) => setDialog({ type: 'import-error', message }),
  })

  const importMut = useMutation({
    mutationFn: (rows: ListImportRow[]) =>
      importCsvRowsToList(listId, userId, rows, gearItems, categories, listItems.length),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.categories() })
      setDialog(null)
    },
  })

  // Empty-state "Add from your inventory" handler. lg+ focuses the desktop
  // aside's LibraryPanel search input; below lg the aside is hidden so we
  // open the mobile drawer instead. The breakpoint match mirrors the
  // sidebar's `lg:flex` / `lg:hidden` rendering.
  function handleAddFromInventory() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setFocusSearchTrigger((t) => t + 1)
    } else {
      setDrawerOpen(true)
    }
  }

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

  // Editing an item's name/description/category from the list view writes
  // to gear_items so it propagates to the gear library and every list that
  // uses the same item. The list-items cache fan-out below is what closes
  // B-2: without it, an immediate reorder after a category change reads
  // stale embedded category_id and writes corrupted sort_order. Mirrors
  // GearLibraryPage.editItem; helper extraction is a future commit.
  const updateGearItemMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
      updateGearItem(id, patch),
    onMutate: ({ id, patch }) => {
      qc.cancelQueries({ queryKey: queryKeys.gearItems() })
      const previousGear = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
      qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) =>
        curr ? curr.map((g) => (g.id === id ? { ...g, ...patch } : g)) : curr,
      )

      const affected = qc.getQueryCache()
        .findAll({ queryKey: ['list-items'] })
        .filter((q) => (q.state.data as ListItemWithGear[] | undefined)?.some((i) => i.gear_item_id === id))
      const listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[] = []
      for (const q of affected) {
        const key = q.queryKey
        qc.cancelQueries({ queryKey: key })
        listSnapshots.push({ key, data: qc.getQueryData<ListItemWithGear[]>(key) })
        qc.setQueryData<ListItemWithGear[]>(key, (curr) =>
          curr?.map((item) =>
            item.gear_item_id === id
              ? { ...item, gear_item: { ...item.gear_item, ...patch } }
              : item,
          ),
        )
      }

      return { previousGear, listSnapshots }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previousGear) qc.setQueryData(queryKeys.gearItems(), ctx.previousGear)
      if (ctx?.listSnapshots) {
        for (const { key, data } of ctx.listSnapshots) {
          qc.setQueryData(key, data)
        }
      }
    },
    onSettled: (_data, _err, _vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      if (ctx?.listSnapshots) {
        for (const { key } of ctx.listSnapshots) {
          qc.invalidateQueries({ queryKey: key })
        }
      }
    },
  })

  // Delete a gear item entirely (from the gear library and every list that uses it).
  // gear_items.id is referenced by list_items with ON DELETE CASCADE on gear_item_id,
  // so deleting a gear item also removes every list_item that references it.
  //
  // The list-page entry point needs cross-cache fan-out beyond the helper:
  // makeOptimisticDelete only filters ['gear-items'], but the row the user is
  // looking at on /lists/:id is rendered from ['list-items', listId]. Without
  // a fan-out, the row stays visible on screen until the settled invalidation/
  // refetch round-trip completes — undermining the whole point of an
  // optimistic delete. Mirror updateGearItemMut's fan-out shape: snapshot
  // every affected ['list-items', _] cache, optimistically filter rows whose
  // gear_item_id matches, restore on error, invalidate per-key on settled.
  const deleteHelper = makeOptimisticDelete<GearItem, string>({
    qc,
    queryKey: queryKeys.gearItems(),
    id: (id) => id,
  })
  const deleteGearItemMut = useMutation({
    mutationFn: deleteGearItem,
    onMutate: (id: string) => {
      const helperCtx = deleteHelper.onMutate(id)
      const affected = qc.getQueryCache()
        .findAll({ queryKey: ['list-items'] })
        .filter((q) => (q.state.data as ListItemWithGear[] | undefined)?.some((i) => i.gear_item_id === id))
      const listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[] = []
      for (const q of affected) {
        const key = q.queryKey
        qc.cancelQueries({ queryKey: key })
        listSnapshots.push({ key, data: qc.getQueryData<ListItemWithGear[]>(key) })
        qc.setQueryData<ListItemWithGear[]>(key, (curr) =>
          curr?.filter((item) => item.gear_item_id !== id),
        )
      }
      return { ...helperCtx, listSnapshots }
    },
    onError: (err, vars, ctx) => {
      deleteHelper.onError(err, vars, ctx)
      if (ctx?.listSnapshots) {
        for (const { key, data } of ctx.listSnapshots) {
          qc.setQueryData(key, data)
        }
      }
      showToast("Couldn't delete that item. Please try again.", { type: 'error' })
    },
    onSettled: (_data, _err, _vars, ctx) => {
      deleteHelper.onSettled()
      if (ctx?.listSnapshots) {
        for (const { key } of ctx.listSnapshots) {
          qc.invalidateQueries({ queryKey: key })
        }
      }
    },
  })

  // "+ Add new item" inside a category — creates a gear_item (so it lives in the
  // gear library too), then adds it to this list under the same category. The
  // draft row in CategoryGroup collects all the fields up front.
  //
  // Phase 8 (M2): collapsed two PostgREST round-trips (createGearItem +
  // addGearItemToList) into one SECURITY DEFINER RPC. Pure cache-invalidate
  // on success; the RPC return value (gear_item_id, list_item_id) is unused
  // because the invalidate refetches both queries. The list-page "Add new
  // item" affordance is intentionally minimal (name/description/weight/
  // category only) — cost and purchase_date are inventory-page concerns and
  // stay null inside the RPC.
  const addNewItemMut = useMutation({
    mutationFn: async ({ categoryId, data }: { categoryId: string | null; data: AddItemData }) => {
      const { error } = await supabase.rpc('add_gear_item_with_list_item', {
        p_user_id: userId,
        p_name: data.name,
        p_description: data.description,
        p_weight_grams: data.weight_grams,
        p_category_id: categoryId,
        p_gear_sort_order: gearItems.length,
        p_list_id: listId,
        p_list_item_sort_order: listItems.length,
        p_quantity: data.quantity,
        p_is_worn: data.is_worn,
        p_is_consumable: data.is_consumable,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
    },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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

  async function resetPacked() {
    // Defense-in-depth offline guard. The PackingProgress button is also
    // disabled when offline so this path shouldn't be reachable, but a
    // bypassed UI state (e.g. a stale render between offline event and
    // re-render) shouldn't fire a doomed mutation.
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    // Optimistic clear — flip is_packed=false on every cached item so the UI
    // updates immediately, then issue a single PATCH and invalidate to settle.
    await qc.cancelQueries({ queryKey: queryKeys.listItems(listId) })
    const previous = qc.getQueryData<ListItemWithGear[]>(queryKeys.listItems(listId))
    qc.setQueryData<ListItemWithGear[]>(queryKeys.listItems(listId), (curr) =>
      curr ? curr.map((i) => (i.is_packed ? { ...i, is_packed: false } : i)) : curr,
    )
    try {
      await resetPackedForList(listId)
    } catch (err) {
      if (previous) qc.setQueryData(queryKeys.listItems(listId), previous)
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

  // Per-row handler bag passed to every CategoryGroup. Memoized so each
  // category section doesn't re-render on every parent state change.
  //
  // Mutation refs are intentionally NOT in deps. TanStack Query rebuilds the
  // useMutation result object on every render (the wrapper is fresh; only the
  // internal `.mutate` callback is stable), so depending on `updateMut` etc.
  // would defeat the memo and re-create this bag every render. Calling
  // `.mutate` through the live binding is safe: the closure resolves
  // `updateMut.mutate` at call time, which is always the current stable ref.
  // setDialog (the React useState setter) is React-guaranteed stable and
  // included for completeness.
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
      addNewItemMut.mutate({ categoryId, data })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addNewItemMut: see addMut note
    [],
  )

  const sharedGroupProps = useMemo(
    () => ({
      packMode: mode === 'pack',
      weightUnit,
      isBelowLg,
      sortable: true,
      showUnpackedOnly,
      // Pack-mode checkbox write-block when offline. Forwarded through
      // CategoryGroup → ItemRow. Only consulted when packMode is true (the
      // checkbox is the only pack-mode write affordance).
      packActionsDisabled: !online,
      onUpdate: (itemId: string, patch: ListItemPatch) => {
        // Defense-in-depth: ItemRow already disables the checkbox when
        // packActionsDisabled, but if any other code path tries to fire an
        // is_packed update offline, suppress it rather than letting the
        // mutation fail-and-rollback.
        if (typeof navigator !== 'undefined' && !navigator.onLine && 'is_packed' in patch) return
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above re: mutation refs
    [mode, weightUnit, isBelowLg, showUnpackedOnly, online],
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
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        List not found.
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* List name, g/oz, Pack toggle, and Share live in the top bar
          (NavBar's RouteHeading + ListContextControls); the page body owns
          the two-column layout below. */}

      {/* Two-column grid (sidebar collapses in pack mode). The visibility
          condition is `mode !== 'pack'` — derived directly, not stored. */}
      <div className="flex gap-4 items-start">
        {/* LEFT column — gear library picker. Hidden in pack mode on desktop
            so the user can focus on packing. List management lives on /lists. */}
        {mode !== 'pack' && (
          <aside
            className="hidden lg:flex w-80 shrink-0 flex-col sticky self-start"
            style={{ top: '1rem', height: 'calc(100vh - 2rem)' }}
          >
            <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 flex-1">
              <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Gear Library
                </span>
                {/* Forward affordance to the gear management page. ?from=
                    plumbs the originating list id so /gear's Back link
                    round-trips here rather than to the manage-lists view. */}
                <Link
                  to={`/gear?from=${listId}`}
                  className="inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                >
                  Manage <ChevronRight size={12} />
                </Link>
              </div>
              <div className="flex-1 overflow-hidden">
                <LibraryPanel
                  gearItems={gearItems}
                  categories={categories}
                  listItemGearIds={listItemGearIds}
                  weightUnit={weightUnit}
                  onAdd={onLibraryAdd}
                  onRemove={onLibraryRemove}
                  focusSearchTrigger={focusSearchTrigger}
                />
              </div>
            </div>
          </aside>
        )}

        {/* RIGHT column — weight table + items (always visible; packing
            checkbox column appears in pack mode). Pack mode narrows from
            7xl (AppShell main) to 3xl + mx-auto so the sparser layout
            reads as focused rather than stretched across the full width
            the missing sidebar leaves behind. */}
        <div className={`flex-1 min-w-0 space-y-4 ${mode === 'pack' ? 'max-w-3xl mx-auto' : ''}`}>
          {/* Pack-mode progress bar */}
          {mode === 'pack' && listItems.length > 0 && (
            <PackingProgress
              total={listItems.length}
              packed={listItems.filter((i) => i.is_packed).length}
              onReset={resetPacked}
              showUnpackedOnly={showUnpackedOnly}
              onToggleShowUnpackedOnly={() => setShowUnpackedOnly((v) => !v)}
              offline={!online}
            />
          )}

          {/* Notes + Weight summary — side by side on desktop, with Notes
              getting the wider column. Both
              hidden in pack mode: neither is active-use information while
              packing (PackingProgress above is the only summary the
              packer needs). The entire grid renders nothing in pack mode. */}
          {mode !== 'pack' && (
            <div className={`grid gap-4 ${listItems.length > 0 ? 'grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]' : 'grid-cols-1'}`}>
              <PanelCard title="Notes">
                <NotesEditor
                  key={list.id}
                  initial={list.description ?? ''}
                  onSave={(v) => notesMut.mutate(v)}
                />
              </PanelCard>
              {listItems.length > 0 && (
                <PanelCard title="Weight summary">
                  <WeightTable items={listItems} categories={categories} />
                </PanelCard>
              )}
            </div>
          )}

          {/* Items grouped by category */}
          {listItems.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
              <h2 className="text-base font-semibold text-gray-900">Add gear to this list</h2>
              <p className="mt-1 text-sm text-gray-500">
                Pick a starting point. The empty state goes away as soon as you add something.
              </p>
              {/* Three equal-weight onboarding affordances. Order is most-
                  to-least likely path; soft-blue hover tint matches the
                  Import CSV button on /lists, reinforcing creation-path
                  affordance. Card #1 dispatches differently per viewport
                  (desktop focuses the visible search input; mobile opens
                  the drawer) since the gear picker is laid out differently
                  on each. */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={handleAddFromInventory}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  <Backpack size={20} className="text-blue-600" />
                  <span className="font-medium text-gray-900">Add from your inventory</span>
                  <span className="text-xs text-gray-500">Pick from gear you've already saved.</span>
                </button>
                <button
                  type="button"
                  onClick={openImportPicker}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  <Upload size={20} className="text-blue-600" />
                  <span className="font-medium text-gray-900">Import gear from CSV</span>
                  <span className="text-xs text-gray-500">Lighterpack or any CSV with the standard fields.</span>
                </button>
                <Link
                  to={`/gear?from=${listId}`}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  <Plus size={20} className="text-blue-600" />
                  <span className="font-medium text-gray-900">Create gear directly</span>
                  <span className="text-xs text-gray-500">Build your inventory in the gear library.</span>
                </Link>
              </div>
              {/* Hidden file input for the Import CSV affordance above. */}
              <input
                ref={importInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          ) : (() => {
            const activeParsed = activeId ? parseDnDId(activeId) : null
            const activeItem =
              activeParsed?.kind === 'item' ? (listItemsById.get(activeParsed.id) ?? null) : null
            return (
              <div className="space-y-4">
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
                  <DragOverlay>
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
                    (CategoryGroup's hideWorn handles that). packMode follows
                    the page mode so the section's row chrome (packed
                    checkbox column, packed-count header) matches the rest
                    of the page. The items array walks categories in display
                    order so the in-section order is stable and predictable. */}
                {showWornGroup && wornItems.length > 0 && (
                  <CategoryGroup
                    name="Worn"
                    items={wornItems}
                    weightUnit={weightUnit}
                    isBelowLg={isBelowLg}
                    packMode={mode === 'pack'}
                    packActionsDisabled={!online}
                    sortable={false}
                    showUnpackedOnly={showUnpackedOnly}
                    onUpdate={sharedGroupProps.onUpdate}
                  />
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Mobile gear-library drawer — mirrors the desktop left aside.
          Slides in from the LEFT, dismissed by overlay tap, the close
          button, or a left-drag. Stays open across multiple add/remove
          actions so the user can build up a list quickly.

          JS-gated by isBelowLg so desktop genuinely doesn't mount the
          drawer; React.lazy on the wrapper means desktop also never
          fetches the vaul chunk. Combined with the H5 Phase-3 carry-over,
          this is what actually moves vaul out of the main bundle. */}
      {isBelowLg && (
        <Suspense fallback={null}>
          <ListSidebarDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            manageHref={`/gear?from=${listId}`}
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
            dialog.listItem
              ? {
                  quantity: dialog.listItem.quantity,
                  is_worn: dialog.listItem.is_worn,
                  is_consumable: dialog.listItem.is_consumable,
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
            dialog.listItem
              ? () => {
                  const target = dialog.listItem!
                  setDialog(null)
                  deleteMut.mutate(target.id)
                }
              : undefined
          }
          onDeleteFromInventory={
            dialog.listItem
              ? () => {
                  const target = dialog.gear
                  setDialog({ type: 'delete-gear', candidate: target })
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
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const target = dialog.candidate
            setDialog(null)
            deleteGearItemMut.mutate(target.id)
          }}
        />
      )}

      {/* CSV import preview — populates the current list (does not create
          a new one). On confirm, importMut writes the rows and clears the
          dialog; the empty state below disappears as listItems repopulates. */}
      {dialog?.type === 'import-preview' && (
        <ListImportPreviewDialog
          rows={dialog.rows}
          saving={importMut.isPending}
          onConfirm={() => importMut.mutate(dialog.rows)}
          onClose={() => setDialog(null)}
        />
      )}

      {/* CSV import error — dismissable via Close button or backdrop click
          (Modal's default closeOnBackdropClick). */}
      {dialog?.type === 'import-error' && (
        <Modal open onClose={() => setDialog(null)} title="Import error" className="w-full max-w-sm">
          <div className="p-6">
            <h2 className="mb-2 text-base font-semibold text-gray-900">Import error</h2>
            <p className="mb-4 text-sm text-red-600">{dialog.message}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}
