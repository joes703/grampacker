import { useState, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import { groupGearItemsByCategory } from '../lib/grouping'
import { SortableCategorySection, StaticCategorySection } from './CategorySection'
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
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    const reordered = arrayMove(categories, oldIndex, newIndex)
    reorderCats.mutate(reordered.map((c, i) => ({ id: c.id, sort_order: i })))
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
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600"
      >
        <ArrowLeft size={14} />
        {fromListId ? 'Back to list' : 'Back to lists'}
      </button>

      {/* Page header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900">
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
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          {weightUnit === 'g' ? 'g' : 'oz'}
        </button>
        {selectMode ? (
          <button
            onClick={exitSelectMode}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => setSelectMode(true)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Select
          </button>
        )}
        <button
          onClick={handleExport}
          disabled={allItems.length === 0}
          title="Export gear library as CSV"
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <Download size={14} /> Export
        </button>
        <button
          onClick={openImportPicker}
          title="Import gear items from CSV"
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
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
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={categories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
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
        </DndContext>
      )}

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
