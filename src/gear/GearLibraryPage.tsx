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
import { Plus, Search, X } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import {
  queryKeys,
  fetchCategories,
  fetchGearItems,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  createGearItem,
  updateGearItem,
  deleteGearItem,
  bulkDeleteGearItems,
  bulkMoveToCategoryGearItems,
} from '../lib/queries'
import type { Category, GearItem } from '../lib/types'
import { getWeightUnit, setWeightUnit, type WeightUnit } from '../lib/weight'
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

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories(),
    queryFn: fetchCategories,
  })
  const { data: allItems = [], isLoading } = useQuery({
    queryKey: queryKeys.gearItems(),
    queryFn: fetchGearItems,
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
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <span className="text-sm text-gray-600">{selectedIds.size} selected</span>
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
