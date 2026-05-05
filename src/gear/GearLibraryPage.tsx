import { useState, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ChevronsDownUp, ChevronsUpDown, Download, Plus, Search, Upload, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import {
  queryKeys,
  fetchCategories,
  fetchGearItems,
  fetchLists,
  createCategory,
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
  importGearItems,
  makeOptimisticReorder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  makeOptimisticBulkDelete,
  makeOptimisticBulkMove,
} from '../lib/queries'
import type { Category, GearItem, ListItemWithGear } from '../lib/types'
import { gearItemsToCsv, downloadCsv, parseGearCsv, type GearCsvRow } from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useToggleSet } from '../lib/use-toggle-set'
import { groupGearItemsByCategory, assignSortOrderSlots } from '../lib/grouping'
import { makeDnDId, parseDnDId } from '../lib/dnd-ids'
import { showToast } from '../lib/toast'
import { SortableCategorySection, StaticCategorySection } from './CategorySection'
import GearItemRow from './GearItemRow'
import GearItemDialog from './GearItemDialog'
import CreateListFromSelectionDialog from './CreateListFromSelectionDialog'
import GearImportPreviewDialog from './GearImportPreviewDialog'
import BulkMoveCategoryDialog from './BulkMoveCategoryDialog'
import BulkActionsToolbar from './BulkActionsToolbar'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import { useDocumentTitle } from '../lib/use-document-title'

type DialogState =
  | { type: 'create-item'; categoryId?: string | null }
  | { type: 'edit-item'; item: GearItem }
  | { type: 'delete-item'; item: GearItem }
  | { type: 'delete-category'; category: Category }
  | { type: 'add-category' }
  | { type: 'bulk-move' }
  | { type: 'import-explainer' }
  | { type: 'import-preview'; rows: GearCsvRow[] }
  | { type: 'import-error'; message: string }
  | { type: 'create-list-from-selection' }


export default function GearLibraryPage() {
  useDocumentTitle('Gear')
  const { session } = useAuth()
  const userId = session!.user.id
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromListId = searchParams.get('from')
  const backTarget = fromListId ? `/lists/${fromListId}` : '/lists'

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => fetchCategories(userId),
  })
  const { data: allItems = [], isLoading } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: () => fetchGearItems(userId),
  })
  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
  })

  // ── Local state ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const { set: selectedIds, toggle: toggleSelect, clear: clearSelected, reset: resetSelected } = useToggleSet<string>()
  const { set: collapsed, toggle: toggleCollapse, clear: expandAll, reset: resetCollapsed } = useToggleSet<string>()
  const { weightUnit, toggleWeightUnit } = useWeightUnit()
  const isBelowLg = useIsBelowLg()
  const [newCategoryName, setNewCategoryName] = useState('')

  function exitSelectMode() {
    setSelectMode(false)
    clearSelected()
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
      createCategory(userId, name, categories.length),
    ...makeOptimisticInsert<Category, string>({
      qc,
      queryKey: queryKeys.categories(),
      // Server assigns is_default=false for user-created categories
      // (defaults are seeded). Placeholder mirrors that.
      optimistic: (name) => ({
        id: `temp-${crypto.randomUUID()}`,
        user_id: userId,
        name,
        sort_order: categories.length,
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
    mutationFn: (id: string) => deleteCategory(id),
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

  const reorderCats = useMutation({
    mutationFn: reorderCategories,
    ...makeOptimisticReorder<Category>(qc, queryKeys.categories()),
  })

  const addItem = useMutation({
    mutationFn: (data: Parameters<typeof createGearItem>[1]) =>
      createGearItem(userId, data, allItems.length),
    ...makeOptimisticInsert<GearItem, Parameters<typeof createGearItem>[1]>({
      qc,
      queryKey: queryKeys.gearItems(),
      optimistic: (data) => {
        const now = new Date().toISOString()
        return {
          id: `temp-${crypto.randomUUID()}`,
          user_id: userId,
          category_id: data.category_id,
          name: data.name,
          description: data.description,
          weight_grams: data.weight_grams,
          cost: data.cost,
          purchase_date: data.purchase_date,
          sort_order: allItems.length,
          created_at: now,
          updated_at: now,
        }
      },
    }),
  })

  // Hand-rolled because we need optimistic fan-out into every list-items
  // cache that references this gear (lists embed gear via join — without
  // the fan-out, an immediate reorder after a category change reads stale
  // embedded category_id and writes corrupted sort_order). Helper extraction
  // is a future commit once the shape proves stable.
  const editItem = useMutation({
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
      createListFromSelection(userId, name, description, ids, lists.length),
    onSuccess: (newList) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.listItems(newList.id) })
      setDialog(null)
      exitSelectMode()
      navigate(`/lists/${newList.id}`)
    },
  })

  const importItems = useMutation({
    mutationFn: (rows: GearCsvRow[]) => importGearItems(userId, rows, categories, allItems, allItems.length),
    onSuccess: () => { invalidateBoth(); setDialog(null) },
  })

  // ── Drag and drop ─────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  // Single page-level drag handler. Two cases only:
  //   1. Reorder categories themselves (drag a category up/down).
  //   2. Reorder items within their existing category.
  // Cross-category drops are deliberately rejected — recategorizing a gear
  // item happens exclusively via the item edit modal (or the multi-select
  // bulk-move toolbar). A drop whose destination differs from the source
  // category is ignored (item snaps back); the visual auto-shift during
  // drag still works because items live in a single page-wide
  // SortableContext.
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
      const oldIndex = categories.findIndex((c) => c.id === activeParsed.id)
      if (oldIndex === -1) return

      // Resolve over to a target category id. The collisionDetection above
      // restricts droppables to category-only when active is a category, so
      // overParsed.kind is always 'category' here. The else branch (over
      // resolved to a gear-item) is kept as a defence; if it ever fires,
      // map back to the parent category via category_id.
      let destCatId: string | null
      if (overParsed.kind === 'category') {
        destCatId = overParsed.id
      } else if (overParsed.kind === 'gear-item') {
        const overItem = allItems.find((i) => i.id === overParsed.id)
        destCatId = overItem?.category_id ?? null
      } else {
        return
      }
      // Uncategorized is not a real category row — no reorder target.
      if (destCatId === null) return
      const newIndex = categories.findIndex((c) => c.id === destCatId)
      if (newIndex === -1 || newIndex === oldIndex) return

      const reordered = arrayMove(categories, oldIndex, newIndex)
      reorderCats.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
      return
    }

    // Case 2 — within-category gear-item reorder. The drop target must be
    // another gear-item AND in the same category as the dragged item.
    if (activeParsed.kind !== 'gear-item' || overParsed.kind !== 'gear-item') return
    const activeItem = allItems.find((i) => i.id === activeParsed.id)
    if (!activeItem) return
    const overItem = allItems.find((i) => i.id === overParsed.id)
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
  const filteredItems = useMemo(() => {
    if (!search) return allItems
    const q = search.toLowerCase()
    return allItems.filter((i) => i.name.toLowerCase().includes(q))
  }, [allItems, search])

  const groups = useMemo(
    () => groupGearItemsByCategory(filteredItems, categories),
    [filteredItems, categories],
  )

  // Stable list of every collapsible key currently rendered — real category
  // ids plus '__uncategorized__' when that bucket is non-empty. Mirrors the
  // key derivation the per-category collapse trigger uses, so the bulk
  // collapse/expand affordances target exactly what's on screen.
  const collapsibleKeys = useMemo(
    () => groups.map((g) => g.category?.id ?? '__uncategorized__'),
    [groups],
  )

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Back to list */}
      <button
        type="button"
        onClick={() => navigate(backTarget)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
      >
        <ArrowLeft size={14} />
        {fromListId ? 'Back to list' : 'Back to lists'}
      </button>

      {/* Page header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-xl font-semibold text-gray-900">
          Gear Library
          <span className="ml-2 text-sm font-normal text-gray-500">{allItems.length} items</span>
        </h1>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={toggleWeightUnit}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {weightUnit}
        </button>
        {selectMode ? (
          <button
            onClick={exitSelectMode}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => setSelectMode(true)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Select
          </button>
        )}
        <button
          onClick={handleExport}
          disabled={allItems.length === 0}
          title="Export gear library as CSV"
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <Download size={14} /> Export
        </button>
        <button
          onClick={() => setDialog({ type: 'import-explainer' })}
          title="Import gear items from CSV"
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Upload size={14} /> Import
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleImportFile}
        />
        <button
          onClick={() => setDialog({ type: 'create-item' })}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={14} />
          New item
        </button>
      </div>

      {/* Sticky bulk-action bar — shown only in selection mode. Sits between
          the page header and "Add category" so it sticks to the top of the
          gear list area as the user scrolls. */}
      {selectMode && (
        <BulkActionsToolbar
          selectedCount={selectedIds.size}
          selectableTotal={filteredItems.length}
          onClose={exitSelectMode}
          onSelectAll={() => resetSelected(filteredItems.map((i) => i.id))}
          onDeselectAll={clearSelected}
          onCreateList={() => setDialog({ type: 'create-list-from-selection' })}
          onMoveToCategory={() => setDialog({ type: 'bulk-move' })}
          onDelete={() => bulkDelete.mutate(Array.from(selectedIds))}
        />
      )}

      {/* Add category row */}
      {dialog?.type === 'add-category' ? (
        <div className="flex items-center gap-2 mb-4">
          <input
            autoFocus
            type="text"
            placeholder="Category name"
            maxLength={128}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newCategoryName.trim()) {
                addCategory.mutate(newCategoryName.trim())
                setNewCategoryName('')
                setDialog(null)
              }
              if (e.key === 'Escape') {
                setNewCategoryName('')
                setDialog(null)
              }
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => {
              if (newCategoryName.trim()) {
                addCategory.mutate(newCategoryName.trim())
                setNewCategoryName('')
              }
              setDialog(null)
            }}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add
          </button>
          <button
            onClick={() => { setNewCategoryName(''); setDialog(null) }}
            className="rounded p-1.5 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        // "Add category" + bulk collapse/expand share one row — both are
        // category-list-scoped affordances. flex-wrap covers narrow
        // viewports; the bulk-collapse pair shifts under "Add category"
        // when there's no horizontal room.
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            onClick={() => setDialog({ type: 'add-category' })}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <Plus size={14} />
            Add category
          </button>
          <div className="ml-auto flex items-center gap-3 text-sm text-gray-500">
            <button
              type="button"
              onClick={() => resetCollapsed(collapsibleKeys)}
              disabled={collapsibleKeys.length === 0}
              title="Collapse all categories"
              className="flex items-center gap-1 hover:text-gray-700 disabled:opacity-40"
            >
              <ChevronsDownUp size={14} />
              Collapse all
            </button>
            <button
              type="button"
              onClick={expandAll}
              disabled={collapsibleKeys.length === 0}
              title="Expand all categories"
              className="flex items-center gap-1 hover:text-gray-700 disabled:opacity-40"
            >
              <ChevronsUpDown size={14} />
              Expand all
            </button>
          </div>
        </div>
      )}

      {/* Category list */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (() => {
        const activeParsed = activeId ? parseDnDId(activeId) : null
        const activeItem =
          activeParsed?.kind === 'gear-item' ? allItems.find((i) => i.id === activeParsed.id) : null
        return (
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
                  onRenameCategory: (id: string, name: string) =>
                    renameCategory.mutate({ id, name }),
                  onDeleteCategory: (cat: Category) =>
                    setDialog({ type: 'delete-category', category: cat }),
                  onAddItemToCategory: (categoryId: string | null) =>
                    setDialog({ type: 'create-item', categoryId }),
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
                    reorderPending={reorderCats.isPending}
                    {...commonProps}
                  />
                )
              })}
            </SortableContext>
            <DragOverlay>
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
                />
              ) : null}
            </DragOverlay>
          </DndContext>
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
              ? () => setDialog({ type: 'delete-item', item: dialog.item })
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
          onCancel={() => setDialog(null)}
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
              <button
                type="button"
                onClick={() => { setDialog(null); openImportPicker() }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Continue
              </button>
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
    </div>
  )
}
