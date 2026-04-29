import { useState, useMemo } from 'react'
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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Download, Plus, Search, Upload, X } from 'lucide-react'
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
  createListFromSelection,
  importGearItems,
  makeOptimisticReorder,
} from '../lib/queries'
import type { Category, GearItem } from '../lib/types'
import { gearItemsToCsv, downloadCsv, parseGearCsv, type GearCsvRow } from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useToggleSet } from '../lib/use-toggle-set'
import { groupGearItemsByCategory, assignSortOrderSlots } from '../lib/grouping'
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
    queryFn: fetchCategories,
  })
  const { data: allItems = [], isLoading } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: fetchGearItems,
  })
  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: fetchLists,
  })

  // ── Local state ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const { set: selectedIds, toggle: toggleSelect, clear: clearSelected, reset: resetSelected } = useToggleSet<string>()
  const { set: collapsed, toggle: toggleCollapse } = useToggleSet<string>()
  const { weightUnit, toggleWeightUnit } = useWeightUnit()
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
  const invalidateCats = () => qc.invalidateQueries({ queryKey: queryKeys.categories() })
  const invalidateItems = () => qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
  // Broad ['list-items'] — every list view embeds gear_item via a Supabase
  // join, so any write that touches gear_items (or cascades into list_items)
  // must invalidate it. Mirrors the convention in updateGearItemMut /
  // deleteGearItemMut on ListDetailPage.
  const invalidateListItems = () => qc.invalidateQueries({ queryKey: ['list-items'] })

  const addCategory = useMutation({
    mutationFn: (name: string) =>
      createCategory(userId, name, categories.length),
    onSuccess: invalidateCats,
  })

  const renameCategory = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCategory(id, { name }),
    onSuccess: invalidateCats,
  })

  const removeCategory = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    // Deleting a category cascades to gear_items.category_id (SET NULL),
    // which is embedded in list_items via the gear join — invalidate
    // list-items too so open list views reflect the new uncategorised state.
    onSuccess: () => { invalidateBoth(); invalidateListItems() },
  })

  const reorderCats = useMutation({
    mutationFn: reorderCategories,
    ...makeOptimisticReorder<Category>(qc, queryKeys.categories()),
  })

  const addItem = useMutation({
    mutationFn: (data: Parameters<typeof createGearItem>[1]) =>
      createGearItem(userId, data, allItems.length),
    onSuccess: invalidateItems,
  })

  const editItem = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateGearItem>[1] }) =>
      updateGearItem(id, patch),
    onSuccess: () => { invalidateItems(); invalidateListItems() },
  })

  const removeItem = useMutation({
    mutationFn: deleteGearItem,
    // CASCADE removes the matching list_items rows in the DB; invalidate
    // ['list-items'] so any open list view refetches and drops them.
    onSuccess: () => { invalidateItems(); invalidateListItems() },
  })

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
    onSuccess: () => { invalidateItems(); invalidateListItems(); exitSelectMode() },
  })

  const bulkMove = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string | null }) =>
      bulkMoveToCategoryGearItems(ids, categoryId),
    onSuccess: () => { invalidateItems(); invalidateListItems(); exitSelectMode() },
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
    mutationFn: (rows: GearCsvRow[]) => importGearItems(userId, rows, categories, allItems.length),
    onSuccess: () => { invalidateBoth(); setDialog(null) },
  })

  // ── Drag and drop ─────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // Active drag id (item id OR category id). The DragOverlay renders an
  // item-row clone for item drags; category drag falls back to dnd-kit's
  // default (original element follows the cursor) since its id isn't in the
  // inner items SortableContext.
  const [activeId, setActiveId] = useState<string | null>(null)

  // Within-category sort drag for gear items. Updates gear_items.sort_order
  // for the affected category. Optimistic via makeOptimisticReorder on
  // ['gear-items']; the mutationFn fans out per-item updateGearItem calls,
  // so a partial failure can leave the backend in a partially-applied state.
  // No ['list-items'] invalidation — list views order by list_items.sort_order
  // and group by categories.sort_order, and the gear_item join projection
  // doesn't include sort_order. A change here is invisible to every list
  // consumer.
  const reorderGearItemsMut = useMutation({
    mutationFn: async (updates: { id: string; sort_order: number }[]) => {
      await Promise.all(updates.map((u) => updateGearItem(u.id, { sort_order: u.sort_order })))
    },
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

    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)
    const categoryIds = new Set(categories.map((c) => c.id))

    // Case 1 — category reorder.
    if (categoryIds.has(activeIdStr)) {
      const oldIndex = categories.findIndex((c) => c.id === activeIdStr)
      if (oldIndex === -1) return

      // Resolve over.id to a target category id. closestCenter picks the
      // closest droppable, which is often an item row rather than the
      // category outer-wrapper id, so handle both shapes.
      let destCatId: string | null
      if (categoryIds.has(overIdStr)) {
        destCatId = overIdStr
      } else {
        const overItem = allItems.find((i) => i.id === overIdStr)
        destCatId = overItem?.category_id ?? null
      }
      // Uncategorised is not a real category row — no reorder target.
      if (destCatId === null) return
      const newIndex = categories.findIndex((c) => c.id === destCatId)
      if (newIndex === -1 || newIndex === oldIndex) return

      const reordered = arrayMove(categories, oldIndex, newIndex)
      reorderCats.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
      return
    }

    // Case 2 — within-category item reorder. The drop target must be another
    // item AND in the same category as the dragged item.
    const activeItem = allItems.find((i) => i.id === activeIdStr)
    if (!activeItem) return
    const overItem = allItems.find((i) => i.id === overIdStr)
    if (!overItem) return
    const activeCat = activeItem.category_id ?? null
    const overCat = overItem.category_id ?? null
    if (overCat !== activeCat) return

    const itemsInCat = allItems.filter((i) => (i.category_id ?? null) === activeCat)
    const oldIndex = itemsInCat.findIndex((i) => i.id === activeIdStr)
    const newIndex = itemsInCat.findIndex((i) => i.id === overIdStr)
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
          onClick={openImportPicker}
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
        <button
          onClick={() => setDialog({ type: 'add-category' })}
          className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <Plus size={14} />
          Add category
        </button>
      )}

      {/* Category list */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (() => {
        // Flat list of every gear item id in render order. The inner
        // SortableContext owns the items list; verticalListSortingStrategy
        // handles cross-category visual shifts.
        const flatItemIds = groups.flatMap((g) => g.items.map((i) => i.id))
        const activeItem = activeId
          ? allItems.find((i) => i.id === activeId)
          : null
        return (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {/* Categories SortableContext is outer; items inner. With one
                DndContext, every useSortable inside reads the nearest
                SortableContext (items). Item drag gets strategy auto-shift;
                category drag fires but no auto-shift — the original element
                follows the cursor via dnd-kit's default. */}
            <SortableContext
              items={categories.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <SortableContext items={flatItemIds} strategy={verticalListSortingStrategy}>
                {groups.map((group) => {
                  const commonProps = {
                    items: group.items,
                    weightUnit,
                    collapsed: collapsed.has(group.category?.id ?? '__uncategorised__'),
                    onToggleCollapse: () =>
                      toggleCollapse(group.category?.id ?? '__uncategorised__'),
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
                  }

                  if (group.category === null) {
                    return (
                      <StaticCategorySection key="__uncategorised__" category={null} {...commonProps} />
                    )
                  }
                  return (
                    <SortableCategorySection
                      key={group.category.id}
                      id={group.category.id}
                      category={group.category}
                      {...commonProps}
                    />
                  )
                })}
              </SortableContext>
            </SortableContext>
            <DragOverlay>
              {activeItem ? (
                <GearItemRow
                  item={activeItem}
                  weightUnit={weightUnit}
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

      {/* Bulk actions toolbar */}
      {selectMode && (
        <BulkActionsToolbar
          selectedCount={selectedIds.size}
          selectableTotal={filteredItems.length}
          onSelectAll={() => resetSelected(filteredItems.map((i) => i.id))}
          onDeselectAll={clearSelected}
          onCreateList={() => setDialog({ type: 'create-list-from-selection' })}
          onMoveToCategory={() => setDialog({ type: 'bulk-move' })}
          onDelete={() => bulkDelete.mutate(Array.from(selectedIds))}
        />
      )}

      {/* Dialogs */}
      {(dialog?.type === 'create-item' || dialog?.type === 'edit-item') && (
        <GearItemDialog
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
          message={`Delete "${dialog.category.name}"? Items in this category will become uncategorised.`}
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
