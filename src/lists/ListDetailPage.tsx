import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
import { Backpack, ChevronRight, Plus, Upload, X } from 'lucide-react'
import { Drawer } from 'vaul'
import { useAuth } from '../auth/AuthProvider'
import {
  queryKeys,
  fetchLists,
  fetchListItems,
  fetchGearItems,
  fetchCategories,
  addGearItemToList,
  updateListItem,
  deleteListItem,
  resetPackedForList,
  updateList,
  reorderListItems,
  updateGearItem,
  createGearItem,
  deleteGearItem,
  importCsvRowsToList,
  makeOptimisticReorder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  type ListItemPatch,
} from '../lib/queries'
import type { GearItem, ListItemWithGear, List } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import { parseDnDId } from '../lib/dnd-ids'
import { assignSortOrderSlots, groupListItemsByCategory } from '../lib/grouping'
import { parseListCsv, type ListImportRow } from '../lib/csv'
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
  const { session } = useAuth()
  const qc = useQueryClient()

  // userId pre-declared before the query so the owner-scoped fetchLists has
  // it. Empty-string fallback covers the brief in-flight-signout window
  // (PrivateRoute redirects the moment session is null; the early-return
  // below handles the same case post-render). The owner-scoped query passes
  // userId as the user_id filter — empty string returns empty results
  // rather than the unfiltered union.
  const userIdForQuery = session?.user.id ?? ''
  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userIdForQuery),
  })

  // PrivateRoute usually keeps session non-null here, but if it goes null
  // mid-render (logout), bail out cleanly instead of throwing.
  if (!session) return null
  const userId = session.user.id

  // key={routeId} forces a fresh ListDetailInner instance per list, so local
  // state (open dialogs, draft inputs, etc.) doesn't leak when the user
  // switches lists.
  return <ListDetailInner key={routeId} listId={routeId} lists={lists} userId={userId} qc={qc} />
}

function ListDetailInner({
  listId,
  lists,
  userId,
  qc,
}: {
  listId: string
  lists: List[]
  userId: string
  qc: ReturnType<typeof useQueryClient>
}) {
  // Pack mode is URL-represented as ?mode=pack so it's bookmarkable,
  // refresh-stable, and back/forward navigable. Anything other than the
  // exact string 'pack' (missing, garbage, typo) falls back to edit mode
  // silently. The toggle UI lives in the top bar (NavBar's
  // ListContextControls / ListActionsKebab); this page reads the URL
  // only. Public share view at /r/:slug is a different page and never
  // sees this parameter.
  const [searchParams] = useSearchParams()
  const mode: Mode = searchParams.get('mode') === 'pack' ? 'pack' : 'edit'
  const { weightUnit } = useWeightUnit()
  // Pack-mode filter: when true, hide already-packed items from each
  // category. Header counts and the "complete" affordance still reflect the
  // full items array. Lifted here because both PackingProgress (the toggle)
  // and CategoryGroup (the filter consumer) live as children of this page.
  const [showUnpackedOnly, setShowUnpackedOnly] = useState(false)
  // Pack-mode "Group worn" toggle — when true, is_worn items are pulled out
  // of their categories and rendered in a flat Worn section at the bottom,
  // mirroring how worn gear sits by the door rather than in the pack. State
  // is per-instance (resets on list switch via key=routeId) and pack-mode
  // only; edit mode ignores it.
  const [groupWorn, setGroupWorn] = useState(false)
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

  const { data: listItems = [] } = useQuery({
    queryKey: queryKeys.listItems(listId),
    queryFn: () => fetchListItems(listId, userId),
  })

  const { data: gearItems = [] } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: () => fetchGearItems(userId),
  })

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => fetchCategories(userId),
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

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
          // crypto.randomUUID() prefix avoids any collision with real ids.
          id: `temp-${crypto.randomUUID()}`,
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
    mutationFn: (itemId: string) => deleteListItem(itemId),
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
      apply: (item, description) => ({ ...item, description: description || null }),
    }),
  })

  // Editing an item's name/description from the list view writes to
  // gear_items so it propagates to the gear library and any other list
  // that uses the same item. Optimistic write goes to ['gear-items'];
  // ['list-items'] (broad) refetches on settled to refresh embedded gear
  // data in any open list view. The current list's embedded gear shows
  // stale values briefly until that refetch — same compromise as
  // GearLibraryPage's editItem.
  const updateGearItemMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
      updateGearItem(id, patch),
    ...makeOptimisticUpdate<GearItem, { id: string; patch: Parameters<typeof updateGearItem>[1] }>({
      qc,
      queryKey: queryKeys.gearItems(),
      invalidateKeys: [['list-items']],
      id: ({ id }) => id,
      apply: (item, { patch }) => ({ ...item, ...patch }),
    }),
  })

  // Delete a gear item entirely (from the gear library and every list that uses it).
  // gear_items.id is referenced by list_items with ON DELETE CASCADE on gear_item_id,
  // so deleting a gear item also removes every list_item that references it.
  const deleteGearItemMut = useMutation({
    mutationFn: (id: string) => deleteGearItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: ['list-items'] })
    },
  })

  // "+ Add new item" inside a category — creates a gear_item (so it lives in the
  // gear library too), then adds it to this list under the same category. The
  // draft row in CategoryGroup collects all the fields up front.
  const addNewItemMut = useMutation({
    mutationFn: async ({ categoryId, data }: { categoryId: string | null; data: AddItemData }) => {
      const newGear = await createGearItem(
        userId,
        { name: data.name, description: data.description, weight_grams: data.weight_grams, category_id: categoryId },
        gearItems.length,
      )
      await addGearItemToList(listId, userId, newGear.id, listItems.length, {
        quantity: data.quantity,
        is_worn: data.is_worn,
        is_consumable: data.is_consumable,
      })
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
    const activeItem = listItems.find((i) => i.id === activeParsed.id)
    if (!activeItem) return
    const overItem = listItems.find((i) => i.id === overParsed.id)
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

  const listItemGearIds = useMemo(
    () => new Set(listItems.map((i) => i.gear_item_id)),
    [listItems],
  )

  const grouped = useMemo(
    () => groupListItemsByCategory(listItems, categories),
    [listItems, categories],
  )

  // Pack-mode + Group Worn: split the grouped items into "regular" (rendered
  // in their categories with worn items hidden) and "worn" (flattened in
  // walk-categories order — categories in display order, items in
  // sort_order within each — and rendered in the trailing Worn section).
  // When the toggle is off, displayedGrouped === grouped and wornItems is
  // empty so the existing render path is preserved exactly.
  const showWornGroup = mode === 'pack' && groupWorn
  const displayedGrouped = useMemo(
    () =>
      showWornGroup
        ? grouped.map((g) => ({ ...g, items: g.items.filter((i) => !i.is_worn) }))
        : grouped,
    [grouped, showWornGroup],
  )
  const wornItems = useMemo(
    () => (showWornGroup ? grouped.flatMap((g) => g.items.filter((i) => i.is_worn)) : []),
    [grouped, showWornGroup],
  )

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
  const sharedGroupProps = useMemo(
    () => ({
      packMode: mode === 'pack',
      weightUnit,
      sortable: true,
      showUnpackedOnly,
      onUpdate: (itemId: string, patch: ListItemPatch) =>
        updateMut.mutate({ itemId, patch }),
      onDelete: (itemId: string) => deleteMut.mutate(itemId),
      onSaveGearName: (gearId: string, n: string) =>
        updateGearItemMut.mutate({ id: gearId, patch: { name: n } }),
      onSaveGearDescription: (gearId: string, d: string) =>
        updateGearItemMut.mutate({ id: gearId, patch: { description: d } }),
      onSaveGearWeight: (gearId: string, w: number) =>
        updateGearItemMut.mutate({ id: gearId, patch: { weight_grams: w } }),
      onEditGearItem: (gearId: string) => {
        const g = gearItems.find((x) => x.id === gearId)
        const li = listItems.find((l) => l.gear_item.id === gearId)
        if (g) setDialog({ type: 'edit-gear', gear: g, listItem: li ?? null, saveError: null })
      },
      onDeleteGearItem: (gearId: string) => {
        const g = gearItems.find((x) => x.id === gearId)
        if (g) setDialog({ type: 'delete-gear', candidate: g })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above re: mutation refs
    [mode, weightUnit, showUnpackedOnly, gearItems, listItems],
  )

  // ── Not found ──────────────────────────────────────────────────────────────

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
                  onAdd={(item) => addMut.mutate(item)}
                  onRemove={(item) => {
                    const li = listItems.find((l) => l.gear_item_id === item.id)
                    if (li) deleteMut.mutate(li.id)
                  }}
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
              groupWorn={groupWorn}
              onToggleGroupWorn={() => setGroupWorn((v) => !v)}
            />
          )}

          {/* Notes + Weight summary — side by side, equal halves. Both
              hidden in pack mode: neither is active-use information while
              packing (PackingProgress above is the only summary the
              packer needs). The entire grid renders nothing in pack mode. */}
          {mode !== 'pack' && (
            <div className={`grid gap-4 ${listItems.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
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
                Pick a starting point — the empty state goes away as soon as you add something.
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
              activeParsed?.kind === 'item' ? listItems.find((i) => i.id === activeParsed.id) : null
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
                  {displayedGrouped
                    .filter((g) => g.category !== null)
                    .map((group) => (
                      <CategoryGroup
                        key={group.category!.id}
                        name={group.category!.name}
                        categoryId={group.category!.id}
                        items={group.items}
                        {...sharedGroupProps}
                        reorderPending={reorderItemsMut.isPending}
                        onAddItem={(data) => addNewItemMut.mutate({ categoryId: group.category!.id, data })}
                      />
                    ))}
                  {displayedGrouped
                    .filter((g) => g.category === null)
                    .map((group) => (
                      <CategoryGroup
                        key="__uncategorized__"
                        name="Uncategorized"
                        categoryId={null}
                        items={group.items}
                        {...sharedGroupProps}
                        reorderPending={reorderItemsMut.isPending}
                        onAddItem={(data) => addNewItemMut.mutate({ categoryId: null, data })}
                      />
                    ))}
                  <DragOverlay>
                    {activeItem ? (
                      <ItemRow item={activeItem} weightUnit={weightUnit} />
                    ) : null}
                  </DragOverlay>
                </DndContext>

                {/* Worn section — pack-mode only, only when toggle is on and
                    there's at least one worn item. Sits outside the DndContext
                    (drag is disabled in pack mode anyway, and the section
                    isn't a drop target). sortable=false so rows render as
                    plain ItemRow without engaging dnd-kit. The items array
                    walks categories in display order so the in-section
                    order is stable and predictable. */}
                {showWornGroup && wornItems.length > 0 && (
                  <CategoryGroup
                    name="Worn"
                    items={wornItems}
                    weightUnit={weightUnit}
                    packMode
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
          actions so the user can build up a list quickly. The flex chain
          inside Drawer.Content uses min-h-0 on each flex-1 wrapper so
          LibraryPanel's inner overflow-y-auto can engage; otherwise the
          panel grows to its content height and the bounded drawer never
          delegates scroll to the inner list. */}
      <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen} direction="left">
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <Drawer.Content className="fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-sm flex-col bg-gray-50 lg:hidden">
            <Drawer.Title className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
              <span className="text-sm font-semibold text-gray-900">Gear Library</span>
              {/* Same forward affordance as the desktop aside; tapping
                  closes the drawer first so the user sees its exit
                  animation rather than an abrupt unmount on route change. */}
              <Link
                to={`/gear?from=${listId}`}
                onClick={() => setDrawerOpen(false)}
                className="inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
              >
                Manage <ChevronRight size={12} />
              </Link>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close gear library"
                className="ml-auto rounded p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </Drawer.Title>
            <div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
              <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 flex-1">
                <div className="flex-1 min-h-0 overflow-hidden">
                  <LibraryPanel
                    gearItems={gearItems}
                    categories={categories}
                    listItemGearIds={listItemGearIds}
                    weightUnit={weightUnit}
                    onAdd={(item) => addMut.mutate(item)}
                    onRemove={(item) => {
                      const li = listItems.find((l) => l.gear_item_id === item.id)
                      if (li) deleteMut.mutate(li.id)
                    }}
                  />
                </div>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

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

