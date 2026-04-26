import { useState, useRef, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'
import { ChevronDown, ChevronRight, GripVertical, Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import type { Category, GearItem } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import GearItemRow from './GearItemRow'

type CategorySectionProps = {
  category: Category | null // null = Uncategorised
  items: GearItem[]
  weightUnit: WeightUnit
  collapsed: boolean
  onToggleCollapse: () => void
  selectMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onInlineSave: (id: string, patch: Partial<Pick<GearItem, 'name' | 'description'>>) => void
  onEditItem: (item: GearItem) => void
  onDeleteItem: (item: GearItem) => void
  onRenameCategory: (id: string, name: string) => void
  onDeleteCategory: (category: Category) => void
  onAddItemToCategory: (categoryId: string | null) => void
}

function CategorySectionInner(
  props: CategorySectionProps & {
    dragHandleRef?: (node: HTMLButtonElement | null) => void
    dragHandleListeners?: SyntheticListenerMap
    dragHandleAttributes?: DraggableAttributes
  },
) {
  const {
    category,
    items,
    weightUnit,
    collapsed,
    onToggleCollapse,
    selectMode,
    selectedIds,
    onToggleSelect,
    onInlineSave,
    onEditItem,
    onDeleteItem,
    onRenameCategory,
    onDeleteCategory,
    onAddItemToCategory,
    dragHandleRef,
    dragHandleListeners,
    dragHandleAttributes,
  } = props

  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState(category?.name ?? '')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus()
  }, [renaming])

  function commitRename() {
    const trimmed = renameDraft.trim()
    if (trimmed && category && trimmed !== category.name) {
      onRenameCategory(category.id, trimmed)
    }
    setRenaming(false)
  }

  const isUncategorised = category === null
  const name = category?.name ?? 'Uncategorised'

  return (
    <div className="mb-2">
      {/* Category header */}
      <div className="flex items-center gap-1 rounded-lg px-2 py-0.5 bg-gray-100">
        {/* Drag handle — only for real categories */}
        {!isUncategorised && dragHandleRef ? (
          <button
            ref={dragHandleRef}
            {...dragHandleListeners}
            {...dragHandleAttributes}
            className="cursor-grab touch-none text-gray-400 hover:text-gray-600 active:cursor-grabbing"
            tabIndex={-1}
            aria-label="Drag to reorder"
          >
            <GripVertical size={16} />
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* Collapse toggle */}
        <button onClick={onToggleCollapse} className="text-gray-500 hover:text-gray-800">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>

        {/* Category name / rename input */}
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setRenameDraft(category?.name ?? '')
                setRenaming(false)
              }
            }}
            className="flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-sm font-medium focus:outline-none"
          />
        ) : (
          <span className="flex-1 text-sm font-medium text-gray-800 select-none">
            {name}
            <span className="ml-1.5 text-xs font-normal text-gray-500">({items.length})</span>
          </span>
        )}

        {/* Header actions — hidden in select mode */}
        {!selectMode && !renaming && (
          <div className="flex items-center gap-0.5 ml-auto">
            <button
              onClick={() => onAddItemToCategory(category?.id ?? null)}
              title="Add item to this category"
              className="rounded p-1 text-gray-400 hover:text-gray-700"
            >
              <Plus size={14} />
            </button>
            {!isUncategorised && (
              <>
                <button
                  onClick={() => {
                    setRenameDraft(category!.name)
                    setRenaming(true)
                  }}
                  title="Rename category"
                  className="rounded p-1 text-gray-400 hover:text-gray-700"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => onDeleteCategory(category!)}
                  title="Delete category"
                  className="rounded p-1 text-gray-400 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        )}

        {renaming && (
          <div className="flex items-center gap-0.5 ml-auto">
            <button onClick={commitRename} className="rounded p-1 text-green-600 hover:text-green-700">
              <Check size={14} />
            </button>
            <button
              onClick={() => {
                setRenameDraft(category?.name ?? '')
                setRenaming(false)
              }}
              className="rounded p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Items */}
      {!collapsed && (
        <div className="mt-1 pl-6">
          {items.length === 0 ? (
            <p className="py-2 px-3 text-xs text-gray-400 italic">No items</p>
          ) : (
            items.map((item) => (
              <GearItemRow
                key={item.id}
                item={item}
                weightUnit={weightUnit}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => onToggleSelect(item.id)}
                onInlineSave={(patch) => onInlineSave(item.id, patch)}
                onEdit={() => onEditItem(item)}
                onDelete={() => onDeleteItem(item)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// Sortable wrapper used for real categories (not Uncategorised)
export function SortableCategorySection(props: CategorySectionProps & { id: string }) {
  const { id, ...rest } = props
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <CategorySectionInner
        {...rest}
        dragHandleRef={setActivatorNodeRef as unknown as (node: HTMLButtonElement | null) => void}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
      />
    </div>
  )
}

// Non-sortable version for Uncategorised
export function StaticCategorySection(props: CategorySectionProps) {
  return <CategorySectionInner {...props} />
}
