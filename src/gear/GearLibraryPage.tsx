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
import { SortableCategorySection, StaticCategorySection, parseGearCategoryDroppableId } from './CategorySection'
import GearItemRow from './GearItemRow'
import GearItemDialog from './GearItemDialog'
import CreateListFromSelectionDialog from './CreateListFromSelectionDialog'
import GearImportPreviewDialog from './GearImportPreviewDialog'
import BulkMoveCategoryDialog from './BulkMoveCategoryDialog'
import BulkActionsToolbar from './BulkActionsToolbar'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'

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
    onSuccess: invalidateBoth,
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
    onSuccess: invalidateItems,
  })

  const removeItem = useMutation({
    mutationFn: deleteGearItem,
    onSuccess: invalidateItems,
  })

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
    onSuccess: () => { invalidateItems(); exitSelectMode() },
  })

  const bulkMove = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string | null }) =>
      bulkMoveToCategoryGearItems(ids, categoryId),
    onSuccess: () => { invalidateItems(); exitSelectMode() },
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
  // for the affected category. Optimistic via the existing
  // makeOptimisticReorder helper on ['gear-items'].
  const reorderGearItemsMut = useMutation({
    mutationFn: async (updates: { id: string; sort_order: number }[]) => {
      await Promise.all(updates.map((u) => updateGearItem(u.id, { sort_order: u.sort_order })))
    },
    ...makeOptimisticReorder<GearItem>(qc, queryKeys.gearItems()),
  })

  // Cross-category move on the gear library page. Updates gear_items.category_id
  // for the moved item and renumbers gear_items.sort_order in the destination
  // so the row lands where the user dropped it. Optimistic on ['gear-items'];
  // ['list-items'] (broad) is invalidated on settle so any list embedding the
  // moved gear item refreshes its embedded gear_item.category_id.
  const moveGearAcrossCategoriesMut = useMutation({
    mutationFn: async ({
      movedItemId,
      newCategoryId,
      sortUpdates,
    }: {
      movedItemId: string
      newCategoryId: string | null
      sortUpdates: { id: string; sort_order: number }[]
    }) => {
      const movedSort = sortUpdates.find((u) => u.id === movedItemId)
      await updateGearItem(movedItemId, {
        category_id: newCategoryId,
        ...(movedSort ? { sort_order: movedSort.sort_order } : {}),
      })
      const others = sortUpdates.filter((u) => u.id !== movedItemId)
      if (others.length) {
        await Promise.all(others.map((u) => updateGearItem(u.id, { sort_order: u.sort_order })))
      }
    },
    onMutate: async ({ movedItemId, newCategoryId, sortUpdates }) => {
      await qc.cancelQueries({ queryKey: queryKeys.gearItems() })
      const previous = qc.getQueryData<GearItem[]>(queryKeys.gearItems())
      const sortMap = new Map(sortUpdates.map((u) => [u.id, u.sort_order]))
      qc.setQueryData<GearItem[]>(queryKeys.gearItems(), (curr) => {
        if (!curr) return curr
        return curr.map((g) => {
          let next = g
          if (g.id === movedItemId) next = { ...next, category_id: newCategoryId }
          if (sortMap.has(g.id)) next = { ...next, sort_order: sortMap.get(g.id)! }
          return next
        })
      })
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.gearItems(), ctx.previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: ['list-items'] })
    },
  })

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  // Single page-level drag handler. Branches on whether active.id is a
  // category id (run the category reorder flow) or an item id (run the
  // same-cat sort vs cross-cat move flow).
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    if (active.id === over.id) return

    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)
    const categoryIds = new Set(categories.map((c) => c.id))

    // Category-drag branch.
    if (categoryIds.has(activeIdStr)) {
      const oldIndex = categories.findIndex((c) => c.id === activeIdStr)
      if (oldIndex === -1) return

      // Resolve over.id to a target category id. closestCenter picks the
      // closest droppable, which is often an item row or a category drop
      // zone rather than the raw category outer-wrapper id — handle all
      // three shapes here.
      let destCatId: string | null
      if (categoryIds.has(overIdStr)) {
        destCatId = overIdStr
      } else {
        const parsed = parseGearCategoryDroppableId(overIdStr)
        if (parsed !== undefined) {
          destCatId = parsed
        } else {
          const overItem = allItems.find((i) => i.id === overIdStr)
          destCatId = overItem?.category_id ?? null
        }
      }
      // Uncategorised is not a real category row — no reorder target.
      if (destCatId === null) return
      const newIndex = categories.findIndex((c) => c.id === destCatId)
      if (newIndex === -1 || newIndex === oldIndex) return

      const reordered = arrayMove(categories, oldIndex, newIndex)
      reorderCats.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
      return
    }

    // Item-drag branch.
    const activeItem = allItems.find((i) => i.id === activeIdStr)
    if (!activeItem) return
    const activeCat = activeItem.category_id ?? null

    const parsedCat = parseGearCategoryDroppableId(overIdStr)
    let destCat: string | null
    let overItemId: string | null = null
    if (parsedCat !== undefined) {
      destCat = parsedCat
    } else {
      overItemId = overIdStr
      const overItem = allItems.find((i) => i.id === overItemId)
      if (!overItem) return
      destCat = overItem.category_id ?? null
    }

    if (destCat === activeCat) {
      // Same-category sort reorder
      if (!overItemId) return
      const itemsInCat = allItems.filter((i) => (i.category_id ?? null) === activeCat)
      const oldIndex = itemsInCat.findIndex((i) => i.id === activeIdStr)
      const newIndex = itemsInCat.findIndex((i) => i.id === overItemId)
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = arrayMove(itemsInCat, oldIndex, newIndex)
      reorderGearItemsMut.mutate(assignSortOrderSlots(reordered))
      return
    }

    // Cross-category drop: insert the moved item into the destination's
    // ordered list at the drop position, then renumber slot values.
    const destItems = allItems
      .filter((i) => (i.category_id ?? null) === destCat && i.id !== activeItem.id)
      .sort((a, b) => a.sort_order - b.sort_order)
    let insertIdx: number
    if (overItemId) {
      const idx = destItems.findIndex((i) => i.id === overItemId)
      insertIdx = idx === -1 ? destItems.length : idx
    } else {
      insertIdx = destItems.length
    }
    const newDestOrder = [
      ...destItems.slice(0, insertIdx),
      activeItem,
      ...destItems.slice(insertIdx),
    ]
    const sortUpdates = assignSortOrderSlots(newDestOrder)
    moveGearAcrossCategoriesMut.mutate({
      movedItemId: activeItem.id,
      newCategoryId: destCat,
      sortUpdates,
    })
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
          {weightUnit === 'g' ? 'g' : 'oz'}
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
      {selectMode && selectedIds.size > 0 && (
        <BulkActionsToolbar
          selectedCount={selectedIds.size}
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
          onSave={(data) => {
            if (dialog.type === 'edit-item') {
              editItem.mutate({ id: dialog.item.id, patch: data }, { onSuccess: () => setDialog(null) })
            } else {
              addItem.mutate(data, { onSuccess: () => setDialog(null) })
            }
          }}
        />
      )}

      {dialog?.type === 'delete-item' && (
        <ConfirmDialog
          title="Delete item"
          message={`Delete "${dialog.item.name}"? This will remove it from all lists.`}
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
