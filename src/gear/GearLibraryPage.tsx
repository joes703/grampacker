import { useState, useMemo } from 'react'
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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Plus, Search, X } from 'lucide-react'
import { useRequireSession } from '../auth/use-require-session'
import {
  queryKeys,
  fetchCategories,
  fetchGearItems,
  fetchLists,
  createCategory,
  nextCategorySortOrder,
  nextGearItemSortOrder,
  updateCategory,
  deleteCategory,
  reorderCategories,
  createGearItem,
  updateGearItem,
  deleteGearItem,
  bulkDeleteGearItems,
  bulkMoveToCategoryGearItems,
  reorderGearItems,
  createListFromSelection,
  nextListSortOrder,
  importGearItems,
  makeOptimisticReorder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticUpdateWithFanout,
  makeOptimisticDelete,
  makeOptimisticBulkDelete,
  makeOptimisticBulkMove,
} from '../lib/queries'
import type { Category, GearItem, ListItemWithGear } from '../lib/types'
import { gearItemsToCsv, downloadCsv, parseGearCsv, type GearCsvRow } from '../lib/csv'
import { randomTempId } from '../lib/random-temp-id'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useToggleSet } from '../lib/use-toggle-set'
import { groupGearItemsByCategory, assignSortOrderSlots } from '../lib/grouping'
import { useReorderable } from '../lib/use-reorderable'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import { showToast } from '../lib/toast'
import { SortableCategorySection, StaticCategorySection } from './CategorySection'
import GearItemRow from './GearItemRow'
import GearItemDialog from './GearItemDialog'
import CreateListFromSelectionDialog from './CreateListFromSelectionDialog'
import GearImportPreviewDialog from './GearImportPreviewDialog'
import BulkMoveCategoryDialog from './BulkMoveCategoryDialog'
import BulkActionsToolbar from './BulkActionsToolbar'
import MobileGearActionBar from './MobileGearActionBar'
import GearOptionsButton from './GearOptionsButton'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { useDocumentTitle } from '../lib/use-document-title'

type DialogState =
  | { type: 'create-item'; categoryId?: string | null }
  | { type: 'edit-item'; item: GearItem }
  // `returnDialog` lets the confirm dialog restore the prior dialog on
  // cancel — set when the delete is launched from inside GearItemDialog
  // so the user lands back in the edit form. Omitted (undefined) for
  // deletes launched directly from the row kebab or trash icon.
  | { type: 'delete-item'; item: GearItem; returnDialog?: DialogState }
  | { type: 'delete-category'; category: Category }
  | { type: 'add-category' }
  | { type: 'bulk-move' }
  | { type: 'import-explainer' }
  | { type: 'import-preview'; rows: GearCsvRow[] }
  | { type: 'import-error'; message: string }
  | { type: 'create-list-from-selection' }


export default function GearLibraryPage() {
  useDocumentTitle('Gear')
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''
  const qc = useQueryClient()
  const navigate = useNavigate()

  // ── Queries ──────────────────────────────────────────────────────────────────
  // Categories: subscription + reorder state machine in one hook. The page-
  // level handleDragEnd delegates the `kind === 'category'` branch to
  // catDragEnd; the hook self-gates so the call is safe regardless of which
  // kind actually dropped. The buildUpdates override preserves this
  // surface's historical full-renumber payload shape (0..N-1) rather than
  // permuting existing slots. See src/lib/use-reorderable.ts for the
  // same-tick-subscription rationale.
  const {
    items: categories,
    reorderPending: catReorderPending,
    handleDragStart: catDragStart,
    handleDragCancel: catDragCancel,
    handleDragEnd: catDragEnd,
  } = useReorderable<Category>({
    queryKey: queryKeys.categories(),
    queryFn: () => fetchCategories(userId),
    mutationFn: reorderCategories,
    dndKind: 'category',
    buildUpdates: (reordered) => reordered.map((c, i) => ({ id: c.id, sort_order: i })),
  })
  const { data: allItems = [], isLoading } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: () => fetchGearItems(userId),
  })
  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
  })

  // O(1) id lookups for DnD callbacks and DragOverlay rendering. See
  // ListDetailPage's listItemsById comment for the rationale.
  const allItemsById = useMemo(
    () => new Map(allItems.map((i) => [i.id, i])),
    [allItems],
  )

  // ── Local state ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const { set: selectedIds, toggle: toggleSelect, clear: clearSelected, reset: resetSelected } = useToggleSet<string>()
  const { set: collapsed, toggle: toggleCollapse, clear: expandAll, reset: resetCollapsed } = useToggleSet<string>()
  const { weightUnit } = useWeightUnit()
  const isBelowLg = useIsBelowLg()
  const [newCategoryName, setNewCategoryName] = useState('')

  function exitSelectMode() {
    setSelectMode(false)
    clearSelected()
  }

  function commitNewCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    addCategory.mutate(name)
    setNewCategoryName('')
    setDialog(null)
  }

  // ── CSV import/export ─────────────────────────────────────────────────────────
  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<GearCsvRow>(
    parseGearCsv,
    {
      onParsed: (rows) => setDialog({ type: 'import-preview', rows }),
      onError: (message) => setDialog({ type: 'import-error', message }),
    },
  )

  function handleExport() {
    const csv = gearItemsToCsv(allItems, categories)
    downloadCsv('gear-library.csv', csv)
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const invalidateBoth = () => {
    qc.invalidateQueries({ queryKey: queryKeys.categories() })
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
  }
  const addCategory = useMutation({
    mutationFn: (name: string) =>
      createCategory(userId, name, nextCategorySortOrder(categories)),
    ...makeOptimisticInsert<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      // Server assigns is_default=false for user-created categories
      // (defaults are seeded). Placeholder mirrors that.
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

  const renameCategory = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCategory(id, { name }),
    ...makeOptimisticUpdate<Category, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.categories(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({ ...item, name }),
    }),
  })

  const removeCategory = useMutation({
    mutationFn: deleteCategory,
    // Deleting a category cascades to gear_items.category_id (SET NULL),
    // which is embedded in list_items via the gear join — invalidate both
    // side caches so open gear / list views reflect the new uncategorized
    // state once the round-trip settles.
    ...makeOptimisticDelete<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      invalidateKeys: [queryKeys.gearItems(), ['list-items']],
      id: (id) => id,
    }),
  })

  const addItem = useMutation({
    mutationFn: (data: Parameters<typeof createGearItem>[1]) =>
      createGearItem(userId, data, nextGearItemSortOrder(allItems)),
    ...makeOptimisticInsert<GearItem, Parameters<typeof createGearItem>[1]>({
      qc,
      queryKey: queryKeys.gearItems(),
      optimistic: (data) => {
        const now = new Date().toISOString()
        return {
          id: `temp-${randomTempId()}`,
          user_id: userId,
          category_id: data.category_id,
          name: data.name,
          description: data.description,
          weight_grams: data.weight_grams,
          cost: data.cost,
          purchase_date: data.purchase_date,
          status: data.status,
          sort_order: nextGearItemSortOrder(allItems),
          created_at: now,
          updated_at: now,
        }
      },
    }),
  })

  // Gear edits fan out into every active list-items cache that embeds the
  // patched gear via the gear_item join — without the fan-out, an immediate
  // reorder after a category change would read stale embedded category_id
  // and write corrupted sort_order. The fields that need fan-out are the
  // ones embedded by GEAR_ITEM_AUTH_SELECT (name, description, weight_grams,
  // category_id, status). makeOptimisticUpdateWithFanout owns the
  // cancel-snapshot-write-rollback-settle lifecycle across both caches; the
  // join shape (FK match, embed property) stays here as the caller-authored
  // matchJoined / applyJoined.
  const editItem = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
      updateGearItem(id, patch),
    ...makeOptimisticUpdateWithFanout<
      GearItem,
      ListItemWithGear,
      { id: string; patch: Parameters<typeof updateGearItem>[1] }
    >({
      qc,
      queryKey: queryKeys.gearItems(),
      fanoutQueryKeyPrefix: ['list-items'],
      id: ({ id }) => id,
      applyPrimary: (gear, { patch }) => ({ ...gear, ...patch }),
      matchJoined: (item, { id }) => item.gear_item_id === id,
      applyJoined: (item, { patch }) => ({
        ...item,
        gear_item: { ...item.gear_item, ...patch },
      }),
    }),
  })

  const removeItem = useMutation({
    mutationFn: deleteGearItem,
    // CASCADE removes the matching list_items rows in the DB; invalidate
    // ['list-items'] so any open list view refetches and drops them.
    ...makeOptimisticDelete<GearItem, string>({
      qc,
      queryKey: queryKeys.gearItems(),
      invalidateKeys: [['list-items']],
      id: (id) => id,
    }),
  })

  // Bulk gear-items delete. The helper handles snapshot/optimistic-filter/
  // rollback against ['gear-items']. List-items invalidation is narrowed to
  // only the caches that actually contained one of the deleted ids (their
  // server-side rows cascade away). exitSelectMode runs only on success so
  // a failed bulk leaves the user's selection intact for retry.
  const bulkDeleteHelper = makeOptimisticBulkDelete<GearItem, string[]>({
    qc,
    queryKey: queryKeys.gearItems(),
    ids: (ids) => ids,
  })
  const bulkDelete = useMutation({
    mutationFn: bulkDeleteGearItems,
    onMutate: bulkDeleteHelper.onMutate,
    onError: (err, vars, ctx) => {
      bulkDeleteHelper.onError(err, vars, ctx)
      showToast("Couldn't delete the selected items. Please try again.", { type: 'error' })
    },
    onSuccess: () => exitSelectMode(),
    onSettled: (_data, _err, ids) => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      if (!ids) return
      const idSet = new Set(ids)
      const affected = qc.getQueryCache()
        .findAll({ queryKey: ['list-items'] })
        .filter((q) =>
          (q.state.data as ListItemWithGear[] | undefined)?.some((i) => idSet.has(i.gear_item_id)),
        )
      for (const q of affected) qc.invalidateQueries({ queryKey: q.queryKey })
    },
  })

  // Bulk gear-items category move. Helper handles ['gear-items'] snapshot/
  // optimistic-apply/rollback. The list-items fan-out below is the B-2-at-
  // scale fix: without it, an immediate reorder in the destination category
  // after a bulk move corrupts sort_order the same way single edits did.
  const bulkMoveHelper = makeOptimisticBulkMove<GearItem, { ids: string[]; categoryId: string | null }>({
    qc,
    queryKey: queryKeys.gearItems(),
    ids: (input) => input.ids,
    apply: (item, input) => ({ ...item, category_id: input.categoryId }),
  })
  const bulkMove = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string | null }) =>
      bulkMoveToCategoryGearItems(ids, categoryId),
    onMutate: (input) => {
      const gearCtx = bulkMoveHelper.onMutate(input)
      const idSet = new Set(input.ids)
      const affected = qc.getQueryCache()
        .findAll({ queryKey: ['list-items'] })
        .filter((q) =>
          (q.state.data as ListItemWithGear[] | undefined)?.some((i) => idSet.has(i.gear_item_id)),
        )
      const listSnapshots: { key: QueryKey; data: ListItemWithGear[] | undefined }[] = []
      for (const q of affected) {
        const key = q.queryKey
        qc.cancelQueries({ queryKey: key })
        listSnapshots.push({ key, data: qc.getQueryData<ListItemWithGear[]>(key) })
        qc.setQueryData<ListItemWithGear[]>(key, (curr) =>
          curr?.map((item) =>
            idSet.has(item.gear_item_id)
              ? { ...item, gear_item: { ...item.gear_item, category_id: input.categoryId } }
              : item,
          ),
        )
      }
      return { ...gearCtx, listSnapshots }
    },
    onError: (err, vars, ctx) => {
      bulkMoveHelper.onError(err, vars, ctx)
      if (ctx?.listSnapshots) {
        for (const { key, data } of ctx.listSnapshots) {
          qc.setQueryData(key, data)
        }
      }
      showToast("Couldn't move the selected items. Please try again.", { type: 'error' })
    },
    onSuccess: () => exitSelectMode(),
    onSettled: (_data, _err, _vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      if (ctx?.listSnapshots) {
        for (const { key } of ctx.listSnapshots) {
          qc.invalidateQueries({ queryKey: key })
        }
      }
    },
  })

  const createListFromSelectionMut = useMutation({
    mutationFn: ({ name, description, ids }: { name: string; description: string | null; ids: string[] }) =>
      createListFromSelection(userId, name, description, ids, nextListSortOrder(lists)),
    meta: { errorToast: "Couldn't create the list. Please try again." },
    onSuccess: (newList) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.listItems(newList.id) })
      setDialog(null)
      exitSelectMode()
      navigate(`/lists/${newList.id}`)
    },
  })

  const importItems = useMutation({
    mutationFn: (rows: GearCsvRow[]) => importGearItems(userId, rows, categories, allItems),
    onSuccess: () => { invalidateBoth(); setDialog(null) },
    // Surface failures (e.g. the inventory-cap preflight) in the existing
    // import-error dialog instead of leaving the preview open with no
    // feedback. Without this only the global console.warn handler fires.
    onError: (err) =>
      setDialog({
        type: 'import-error',
        message: err instanceof Error ? err.message : 'Could not import CSV. Try again.',
      }),
  })

  // ── Drag and drop ─────────────────────────────────────────────────────────────
  // See ListDetailPage for the rationale. MouseSensor drives the desktop
  // hover grip (gear item rows) and the always-visible category-header grip;
  // TouchSensor's press-and-hold drives touch reorder without stealing taps
  // (open edit dialog) or vertical scroll. Category headers keep their
  // dedicated visible grip on mobile, so long-press on that grip reorders
  // categories; gear item rows use the row itself as the touch activator.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // When dragging a category, the dragged wrapper carries its items along
  // (they're DOM children). closestCenter measures from the active's center,
  // and the dragged category's own item rects are physically closest — so
  // `over` resolves to one of the dragged category's own items, the handler
  // resolves dest to the same category, and the drop snaps back. Filter the
  // collision search to category droppables when the active is a category;
  // item drags use closestCenter unchanged. The kind tag in the typed id
  // (see src/lib/dnd-ids.ts) is what tells us which case we're in.
  const collisionDetection = useMemo<CollisionDetection>(
    () => (args) => {
      const activeKind = parseDnDId(String(args.active.id))?.kind
      if (activeKind === 'category') {
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (c) => parseDnDId(String(c.id))?.kind === 'category',
          ),
        })
      }
      return closestCenter(args)
    },
    [],
  )

  // Active drag id (item id OR category id). The DragOverlay renders an
  // item-row clone for item drags; category drag falls back to dnd-kit's
  // default (original element follows the cursor) since the active id
  // isn't in the inner items SortableContext.
  const [activeId, setActiveId] = useState<string | null>(null)

  // Within-category sort drag for gear items. Updates gear_items.sort_order
  // for the affected category via the bulk_update_sort_order RPC — single
  // round-trip, atomic on the server, same write path as categories and
  // list_items. Optimistic via makeOptimisticReorder on ['gear-items'].
  // No ['list-items'] invalidation — list views order by list_items.sort_order
  // and group by categories.sort_order, and the gear_item join projection
  // doesn't include sort_order. A change here is invisible to every list
  // consumer.
  const reorderGearItemsMut = useMutation({
    mutationFn: reorderGearItems,
    ...makeOptimisticReorder<GearItem>(qc, queryKeys.gearItems()),
  })

  // The page tracks its OWN activeId for the gear-item DragOverlay clone
  // (the DragOverlay below only renders gear-item rows; categories don't
  // have a clone). The categories useReorderable hook tracks an independent
  // activeId internally for its own state machine; we forward the lifecycle
  // events to it so it stays in sync even though its activeItem isn't
  // consumed at this surface.
  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
    catDragStart(e)
  }

  function handleDragCancel() {
    setActiveId(null)
    catDragCancel()
  }

  // Page-level drag handler. Two cases:
  //   1. Reorder categories themselves — delegated to the categories
  //      useReorderable hook (`catDragEnd`). The hook owns parse/validate/
  //      arrayMove/buildUpdates/mutate. We early-return on kind=='category'
  //      so the gear-item branch below doesn't also fire against a
  //      category id.
  //   2. Reorder items within their existing category — stays page-level
  //      because the algebra is slice-based (filter to category, then
  //      arrayMove). The useReorderable hook is flat-only by design; a
  //      future second-pass extraction may take a groupBy option, but the
  //      shape isn't proven yet (see CLAUDE.md / DECISIONS.md ADR 11).
  //
  // Cross-category gear-item drops are deliberately rejected (item snaps
  // back); recategorizing happens via the edit modal or the multi-select
  // bulk-move toolbar (per ADR 1).
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    if (active.id === over.id) return

    const activeParsed = parseDnDId(String(active.id))
    const overParsed = parseDnDId(String(over.id))
    if (!activeParsed || !overParsed) return

    // Case 1 — category reorder.
    if (activeParsed.kind === 'category') {
      catDragEnd(e)
      return
    }

    // Case 2 — within-category gear-item reorder. The drop target must be
    // another gear-item AND in the same category as the dragged item.
    if (activeParsed.kind !== 'gear-item' || overParsed.kind !== 'gear-item') return
    const activeItem = allItemsById.get(activeParsed.id)
    if (!activeItem) return
    const overItem = allItemsById.get(overParsed.id)
    if (!overItem) return
    const activeCat = activeItem.category_id ?? null
    const overCat = overItem.category_id ?? null
    if (overCat !== activeCat) return

    const itemsInCat = allItems.filter((i) => (i.category_id ?? null) === activeCat)
    const oldIndex = itemsInCat.findIndex((i) => i.id === activeParsed.id)
    const newIndex = itemsInCat.findIndex((i) => i.id === overParsed.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(itemsInCat, oldIndex, newIndex)
    reorderGearItemsMut.mutate(assignSortOrderSlots(reordered))
  }

  // ── Derived data ──────────────────────────────────────────────────────────────
  const searchFiltered = useMemo(() => {
    if (!search) return allItems
    const q = search.toLowerCase()
    return allItems.filter((i) => i.name.toLowerCase().includes(q))
  }, [allItems, search])

  // After removing category chips, search is the only narrowing filter on
  // the page. Empty categories still render as section headers so the user
  // can use them as drop targets / "+ Add item" affordances.
  const groups = useMemo(
    () => groupGearItemsByCategory(searchFiltered, categories),
    [searchFiltered, categories],
  )

  const itemCountByCategoryId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of allItems) {
      if (item.category_id === null) continue
      counts.set(item.category_id, (counts.get(item.category_id) ?? 0) + 1)
    }
    return counts
  }, [allItems])

  // Stable list of every collapsible key currently rendered — real category
  // ids plus '__uncategorized__' when that bucket is non-empty. Mirrors the
  // key derivation the per-category collapse trigger uses, so the bulk
  // collapse/expand affordances target exactly what's on screen.
  const collapsibleKeys = useMemo(
    () => groups.map((g) => g.category?.id ?? '__uncategorized__'),
    [groups],
  )

  // ── Render ────────────────────────────────────────────────────────────────────
  // Bail out cleanly if the session went null mid-render. PrivateRoute
  // normally keeps it non-null here; this is defensive in the brief
  // sign-out window. Hooks above already ran, so this is safe.
  if (!auth) return null

  return (
    <div className="print:pb-0">
      {/* Hidden file input for CSV import. Mounted at the page level so
          it's always reachable via importInputRef.current.click(), even
          when its old neighbor (the desktop utility cluster) is
          display:none on mobile. */}
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Page header. NavBar renders "Gear" as the route heading, so the
          in-content title is dropped. Both viewports expose only the
          frequent actions (search + New item + Select + Options);
          rare/utility actions (New category, Import, Export, Collapse /
          Expand all) live behind the Options surface — a desktop popover
          (GearOptionsButton) and a mobile modal (MobileGearActionBar).
          The two surfaces consume the same GearOptionsContent so the
          row list stays in lockstep. */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          {/* Item count metadata — kept on every viewport now that the
              page h1 is gone; sits to the left of search. */}
          <p className="text-sm text-gray-500 shrink-0">{allItems.length} items</p>

          {/* Search — fills the remaining mobile-row width (flex-1
              min-w-0) so it isn't squeezed; locks to a comfortable
              fixed width at md+ so the right-side cluster has room. */}
          <div className="relative flex-1 min-w-0 md:flex-none md:w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Inline "New category" input — only present while the
              add-category dialog state is active. Triggered from
              either the desktop Options popover or the mobile Options
              modal. Hidden by default on every viewport; visible
              full-width on mobile, inline on desktop when active. The
              shared input here keeps a single source of truth instead
              of duplicating the inline editor per surface. */}
          {dialog?.type === 'add-category' && (
            <div className="flex w-full md:w-auto items-center gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Category name"
                maxLength={128}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitNewCategory()
                  if (e.key === 'Escape') {
                    setNewCategoryName('')
                    setDialog(null)
                  }
                }}
                className="w-44 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <PrimaryButton
                onClick={commitNewCategory}
                disabled={!newCategoryName.trim()}
                size="sm"
                disabledOpacity="40"
              >
                Add
              </PrimaryButton>
              <button
                onClick={() => { setNewCategoryName(''); setDialog(null) }}
                className="rounded p-1.5 text-gray-400 hover:text-gray-600"
                aria-label="Cancel new category"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Select pill — visible on every viewport. Frequent enough on
              mobile (bulk Move / Delete / Create List From Selection) that
              hiding it behind the Options modal would degrade discovery;
              also doesn't belong on the universal mobile bottom bar since
              it's gear-specific. md:ml-auto pushes it (and the desktop
              cluster) to the right edge of the header row; on mobile it
              sits inline next to search. */}
          {selectMode ? (
            <button
              onClick={exitSelectMode}
              className="md:ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              className="md:ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Select
            </button>
          )}

          {/* Right cluster — New item + Options. Desktop-only; mobile
              reaches the same actions from MobileGearActionBar's Add slot
              and Options modal. Select is lifted out so it stays
              discoverable on every viewport. */}
          <div className="hidden md:flex items-center gap-2">
            <button
              onClick={() => setDialog({ type: 'create-item' })}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus size={14} />
              New item
            </button>
            <GearOptionsButton
              onNewCategory={() => setDialog({ type: 'add-category' })}
              onImport={() => setDialog({ type: 'import-explainer' })}
              onExport={handleExport}
              canExport={allItems.length > 0}
              onCollapseAll={() => resetCollapsed(collapsibleKeys)}
              onExpandAll={expandAll}
              canCollapseExpand={collapsibleKeys.length > 0}
            />
          </div>
        </div>

      </div>

      {/* Sticky bulk-action bar — shown only in selection mode. Sits between
          the page header and the category list so it sticks to the top of the
          gear list area as the user scrolls. */}
      {selectMode && (
        <BulkActionsToolbar
          selectedCount={selectedIds.size}
          selectableTotal={searchFiltered.length}
          onClose={exitSelectMode}
          onSelectAll={() => resetSelected(searchFiltered.map((i) => i.id))}
          onDeselectAll={clearSelected}
          onCreateList={() => setDialog({ type: 'create-list-from-selection' })}
          onMoveToCategory={() => setDialog({ type: 'bulk-move' })}
          onDelete={() => bulkDelete.mutate(Array.from(selectedIds))}
        />
      )}

      {/* Category list */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (() => {
        const activeParsed = activeId ? parseDnDId(activeId) : null
        const activeItem =
          activeParsed?.kind === 'gear-item' ? (allItemsById.get(activeParsed.id) ?? null) : null
        return (
          <div className="flex flex-col gap-3">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {/* Categories SortableContext at the page level — its items list
                is the category ids, so SortableCategorySection's useSortable
                resolves to it. Each CategorySection renders a per-category
                SortableContext internally for its items. */}
            <SortableContext
              items={categories.map((c) => makeDnDId('category', c.id))}
              strategy={verticalListSortingStrategy}
            >
              {groups.map((group) => {
                const commonProps = {
                  items: group.items,
                  weightUnit,
                  isBelowLg,
                  collapsed: collapsed.has(group.category?.id ?? '__uncategorized__'),
                  onToggleCollapse: () =>
                    toggleCollapse(group.category?.id ?? '__uncategorized__'),
                  selectMode,
                  selectedIds,
                  onToggleSelect: toggleSelect,
                  onInlineSave: (id: string, patch: Partial<Pick<GearItem, 'name' | 'description'>>) =>
                    editItem.mutate({ id, patch }),
                  onEditItem: (item: GearItem) => setDialog({ type: 'edit-item', item }),
                  onDeleteItem: (item: GearItem) => setDialog({ type: 'delete-item', item }),
                  // Quick status change from the row kebab. Shares the
                  // editItem mutation so optimistic fan-out into open
                  // ['list-items'] caches stays consistent with the dialog
                  // path. The menu component already skips re-selecting the
                  // current status, so this never fires a no-op PATCH.
                  onSetItemStatus: (id: string, status: GearItem['status']) =>
                    editItem.mutate({ id, patch: { status } }),
                  onRenameCategory: (id: string, name: string) =>
                    renameCategory.mutate({ id, name }),
                  onDeleteCategory: (cat: Category) => {
                    if ((itemCountByCategoryId.get(cat.id) ?? 0) === 0) {
                      removeCategory.mutate(cat.id)
                    } else {
                      setDialog({ type: 'delete-category', category: cat })
                    }
                  },
                  itemReorderPending: reorderGearItemsMut.isPending,
                }

                if (group.category === null) {
                  return (
                    <StaticCategorySection key="__uncategorized__" category={null} {...commonProps} />
                  )
                }
                return (
                  <SortableCategorySection
                    key={group.category.id}
                    id={group.category.id}
                    category={group.category}
                    reorderPending={catReorderPending}
                    {...commonProps}
                  />
                )
              })}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeItem ? (
                <GearItemRow
                  item={activeItem}
                  weightUnit={weightUnit}
                  isBelowLg={isBelowLg}
                  selectMode={false}
                  selected={false}
                  onToggleSelect={() => {}}
                  onInlineSave={() => {}}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  onSetStatus={() => {}}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
          </div>
        )
      })()}

      {/* Dialogs */}
      {(dialog?.type === 'create-item' || dialog?.type === 'edit-item') && (
        <GearItemDialog
          key={dialog.type === 'edit-item' ? dialog.item.id : 'new'}
          categories={categories}
          item={dialog.type === 'edit-item' ? dialog.item : undefined}
          defaultCategoryId={dialog.type === 'create-item' ? dialog.categoryId : undefined}
          saving={addItem.isPending || editItem.isPending}
          onClose={() => setDialog(null)}
          onCreateCategory={(categoryName) => addCategory.mutateAsync(categoryName)}
          onSave={(gearPatch) => {
            // Gear library page never opens the dialog with a list context,
            // so listPatch is always null here and is ignored.
            if (dialog.type === 'edit-item') {
              editItem.mutate({ id: dialog.item.id, patch: gearPatch }, { onSuccess: () => setDialog(null) })
            } else {
              addItem.mutate(gearPatch, { onSuccess: () => setDialog(null) })
            }
          }}
          // Mobile-only Delete from inventory action inside the dialog.
          // Replaces the trash icon that used to sit in the row on desktop
          // (still present on lg+ via the inline RowIconButton). Hands off
          // to the same delete-item ConfirmDialog flow as the desktop
          // trash button by transitioning dialog state.
          onDeleteFromInventory={
            dialog.type === 'edit-item'
              ? () => setDialog({ type: 'delete-item', item: dialog.item, returnDialog: dialog })
              : undefined
          }
        />
      )}

      {dialog?.type === 'delete-item' && (
        <ConfirmDialog
          title="Delete from inventory"
          message={`This will remove "${dialog.item.name}" from your inventory and from any list it appears on. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          // Cancel restores the prior dialog when one was captured (the
          // user launched delete from inside GearItemDialog). Otherwise
          // close to the page.
          onCancel={() => setDialog(dialog.returnDialog ?? null)}
          onConfirm={() => {
            removeItem.mutate(dialog.item.id, { onSuccess: () => setDialog(null) })
          }}
        />
      )}

      {dialog?.type === 'delete-category' && (
        <ConfirmDialog
          title="Delete category"
          message={`Delete "${dialog.category.name}"? Items in this category will become uncategorized.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            removeCategory.mutate(dialog.category.id, { onSuccess: () => setDialog(null) })
          }}
        />
      )}

      {dialog?.type === 'bulk-move' && (
        <BulkMoveCategoryDialog
          categories={categories}
          count={selectedIds.size}
          onMove={(categoryId) =>
            bulkMove.mutate({ ids: Array.from(selectedIds), categoryId }, {
              onSuccess: () => setDialog(null),
            })
          }
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'create-list-from-selection' && (
        <CreateListFromSelectionDialog
          selectedCount={selectedIds.size}
          existingListCount={lists.length}
          saving={createListFromSelectionMut.isPending}
          onSubmit={(name, description) =>
            createListFromSelectionMut.mutate({ name, description, ids: Array.from(selectedIds) })
          }
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'import-explainer' && (
        <Modal open onClose={() => setDialog(null)} title="Import gear inventory" className="w-full max-w-md">
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Import gear inventory</h2>
            <p className="text-sm text-gray-600 mb-3">
              Adds gear directly to your library without creating a list. Useful for importing an existing inventory of gear you own.
            </p>
            <p className="text-sm text-gray-600 mb-5">
              Quantity, worn, and consumable settings from the CSV are ignored. Those apply to list items, not the inventory itself.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <PrimaryButton
                type="button"
                onClick={() => { setDialog(null); openImportPicker() }}
              >
                Continue
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      {dialog?.type === 'import-error' && (
        <Modal open onClose={() => setDialog(null)} title="Import error" className="w-full max-w-sm">
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Import error</h2>
            <p className="text-sm text-red-600 mb-4">{dialog.message}</p>
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

      {dialog?.type === 'import-preview' && (
        <GearImportPreviewDialog
          rows={dialog.rows}
          saving={importItems.isPending}
          onConfirm={(rows) => importItems.mutate(rows)}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Mobile bottom action bar — uniform Gear / Lists / Add / Options
          shape shared with every other mobile bar. Select lives on the
          page header now (visible on all viewports) so it stays
          discoverable without taking a bottom-bar slot. lg:hidden inside
          the component itself, so desktop never renders. */}
      <MobileGearActionBar
        onNewItem={() => setDialog({ type: 'create-item' })}
        onNewCategory={() => setDialog({ type: 'add-category' })}
        onImport={() => setDialog({ type: 'import-explainer' })}
        onExport={handleExport}
        canExport={allItems.length > 0}
        onCollapseAll={() => resetCollapsed(collapsibleKeys)}
        onExpandAll={expandAll}
        canCollapseExpand={collapsibleKeys.length > 0}
      />
    </div>
  )
}
