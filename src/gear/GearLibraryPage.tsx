import { useState, useMemo, useRef } from 'react'
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
import { useNavigate } from 'react-router'
import { Download, ListPlus, Plus, Search, Upload, X } from 'lucide-react'
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
} from '../lib/queries'
import type { Category, GearItem } from '../lib/types'
import { getWeightUnit, setWeightUnit, formatGrams, type WeightUnit } from '../lib/weight'
import { gearItemsToCsv, downloadCsv, parseGearCsv, type GearCsvRow } from '../lib/csv'
import { supabase } from '../lib/supabase'
import { SortableCategorySection, StaticCategorySection } from './CategorySection'
import GearItemDialog from './GearItemDialog'
import ConfirmDialog from '../components/ConfirmDialog'

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

type Group = { category: Category | null; items: GearItem[] }

function groupItems(items: GearItem[], categories: Category[]): Group[] {
  const groups: Group[] = categories.map((cat) => ({
    category: cat,
    items: items.filter((i) => i.category_id === cat.id),
  }))
  const uncategorised = items.filter((i) => i.category_id === null)
  if (uncategorised.length > 0) groups.push({ category: null, items: uncategorised })
  return groups
}

export default function GearLibraryPage() {
  const { session } = useAuth()
  const userId = session!.user.id
  const qc = useQueryClient()
  const navigate = useNavigate()

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
  const [selectedIds, setSelectedIds] = useState(new Set<string>())
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const [weightUnit, setWeightUnitState] = useState<WeightUnit>(getWeightUnit)
  const [newCategoryName, setNewCategoryName] = useState('')

  function toggleWeightUnit() {
    const next: WeightUnit = weightUnit === 'g' ? 'oz' : 'g'
    setWeightUnit(next)
    setWeightUnitState(next)
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  // ── CSV import/export ─────────────────────────────────────────────────────────
  const importInputRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    const csv = gearItemsToCsv(allItems, categories)
    downloadCsv('gear-library.csv', csv)
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!importInputRef.current) return
    importInputRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const result = parseGearCsv(text)
      if (typeof result === 'string') {
        setDialog({ type: 'import-error', message: result })
      } else {
        setDialog({ type: 'import-preview', rows: result })
      }
    }
    reader.readAsText(file)
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
    onSuccess: invalidateCats,
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
    mutationFn: async (rows: GearCsvRow[]) => {
      // Resolve category names → ids, creating missing categories
      const uniqueNames = [...new Set(rows.map((r) => r.category.trim()).filter(Boolean))]
      const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))

      for (const name of uniqueNames) {
        if (!catByName.has(name.toLowerCase())) {
          const created = await createCategory(userId, name, categories.length + catByName.size)
          catByName.set(name.toLowerCase(), created.id)
        }
      }

      const items = rows.map((row, i) => ({
        user_id: userId,
        name: row.name.trim().slice(0, 256),
        description: row.description ? row.description.slice(0, 2000) : null,
        weight_grams: row.weight_grams,
        category_id: row.category.trim() ? (catByName.get(row.category.trim().toLowerCase()) ?? null) : null,
        sort_order: allItems.length + i,
      }))

      const { error } = await supabase.from('gear_items').insert(items)
      if (error) throw error
    },
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
    () => groupItems(filteredItems, categories),
    [filteredItems, categories],
  )

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div>
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
          onClick={() => importInputRef.current?.click()}
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
      {selectMode && selectedIds.size > 0 && (() => {
        const overListCap = selectedIds.size > 300
        return (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <span
              className={`text-sm ${
                overListCap
                  ? 'rounded-md bg-red-50 px-2 py-0.5 font-medium text-red-700'
                  : 'text-gray-600'
              }`}
            >
              {selectedIds.size} selected
              {overListCap && ' · max 300 per list'}
            </span>
            <button
              onClick={() => {
                const all = filteredItems.map((i) => i.id)
                setSelectedIds(new Set(all))
              }}
              className="text-sm text-blue-600 hover:underline"
            >
              Select all
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 hover:underline"
            >
              Deselect all
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setDialog({ type: 'create-list-from-selection' })}
                disabled={overListCap}
                title={overListCap ? `Lists can hold at most 300 items (you've selected ${selectedIds.size})` : undefined}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                <ListPlus size={14} /> Create list
              </button>
              <button
                onClick={() => setDialog({ type: 'bulk-move' })}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Move to category
              </button>
              <button
                onClick={() => bulkDelete.mutate(Array.from(selectedIds))}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete ({selectedIds.size})
              </button>
            </div>
          </div>
        </div>
        )
      })()}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Import error</h2>
            <p className="text-sm text-red-600 mb-4">{dialog.message}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setDialog(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.type === 'import-preview' && (
        <ImportPreviewDialog
          rows={dialog.rows}
          saving={importItems.isPending}
          onConfirm={(rows) => importItems.mutate(rows)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function CreateListFromSelectionDialog({
  selectedCount,
  existingListCount,
  saving,
  onSubmit,
  onClose,
}: {
  selectedCount: number
  existingListCount: number
  saving: boolean
  onSubmit: (name: string, description: string | null) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const listCapHit = existingListCount >= 100
  const itemCapHit = selectedCount > 300
  const blocked = listCapHit || itemCapHit
  const trimmed = name.trim()
  const canSubmit = !blocked && !saving && trimmed.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Create list from selection</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit(trimmed, description.trim() || null) }}
          className="px-6 py-4 space-y-4"
        >
          <p className="text-sm text-gray-600">
            {selectedCount} item{selectedCount === 1 ? '' : 's'} will be added to the new list.
          </p>

          {listCapHit && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              You've reached the 100-list limit. Delete an existing list before creating a new one.
            </p>
          )}
          {itemCapHit && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Lists can hold at most 300 items. You've selected {selectedCount}. Reduce the selection and try again.
            </p>
          )}

          <div>
            <label htmlFor="cls-name" className="block text-sm font-medium text-gray-700 mb-1">
              List name
            </label>
            <input
              id="cls-name"
              autoFocus
              type="text"
              required
              maxLength={256}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="cls-desc" className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-xs font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              id="cls-desc"
              maxLength={2000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create list'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ImportPreviewDialog({
  rows,
  saving,
  onConfirm,
  onClose,
}: {
  rows: GearCsvRow[]
  saving: boolean
  onConfirm: (rows: GearCsvRow[]) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-lg flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            Import {rows.length} item{rows.length !== 1 ? 's' : ''}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2 text-left">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-1.5 font-medium text-gray-800 max-w-[180px] truncate">{row.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{formatGrams(row.weight_grams)}</td>
                  <td className="px-3 py-1.5 text-gray-500">{row.category || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(rows)}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Importing…' : `Import ${rows.length} item${rows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkMoveCategoryDialog({
  categories,
  count,
  onMove,
  onClose,
}: {
  categories: Category[]
  count: number
  onMove: (categoryId: string | null) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string>('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Move {count} item{count !== 1 ? 's' : ''} to category
        </h2>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">— Uncategorised —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => onMove(selected || null)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  )
}
