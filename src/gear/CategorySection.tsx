import { useState, useRef, useEffect } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, GripVertical, Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import type { Category, GearItem } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'
import { SortableGearItemRow } from './GearItemRow'
import RowIconButton from '../components/RowIconButton'

type CategorySectionProps = {
  category: Category | null // null = Uncategorized
  items: GearItem[]
  weightUnit: WeightUnit
  isBelowLg: boolean
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
  /** Threaded to each SortableGearItemRow as `reorderPending` so the gear-
   *  item drag handles disable while the gear-item reorder mutation is in
   *  flight. Distinct from the category-level reorderPending on
   *  SortableCategorySection (which gates the section's own drag). */
  itemReorderPending?: boolean
}

function CategorySectionInner(
  props: CategorySectionProps & {
    dragHandleRef?: (node: HTMLButtonElement | null) => void
    dragHandleListeners?: DraggableSyntheticListeners
    dragHandleAttributes?: DraggableAttributes
  },
) {
  const {
    category,
    items,
    weightUnit,
    isBelowLg,
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
    itemReorderPending,
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

  const isUncategorized = category === null
  const name = category?.name ?? 'Uncategorized'
  // Stable id for the collapsible items region so the chevron button can
  // announce aria-controls.
  const regionId = `gear-cat-region-${category?.id ?? 'uncategorized'}`

  return (
    <div className="mb-2">
      {/* Category header */}
      <div className="flex items-center gap-1 rounded-lg px-2 py-0.5 bg-gray-100">
        {/* Drag handle — only for real categories */}
        {!isUncategorized && dragHandleRef ? (
          <RowIconButton
            ref={dragHandleRef}
            {...dragHandleListeners}
            {...dragHandleAttributes}
            tabIndex={-1}
            variant="dragHandle"
            ariaLabel="Drag to reorder"
            icon={<GripVertical size={16} />}
          />
        ) : (
          <span className="w-5" />
        )}

        {/* Collapse toggle */}
        <button
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-controls={regionId}
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          className="text-gray-500 hover:text-gray-800"
        >
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
          <span className="flex-1 text-sm font-medium text-gray-700 select-none">
            {name}
            <span className="ml-1.5 text-xs font-normal tabular-nums text-gray-500">({items.length})</span>
          </span>
        )}

        {/* Header actions — hidden in select mode */}
        {!selectMode && !renaming && (
          <div className="flex items-center gap-0.5 ml-auto">
            <RowIconButton
              onClick={() => onAddItemToCategory(category?.id ?? null)}
              title="Add item to this category"
              ariaLabel="Add item to this category"
              icon={<Plus size={14} />}
            />
            {!isUncategorized && (
              <>
                <RowIconButton
                  onClick={() => {
                    setRenameDraft(category!.name)
                    setRenaming(true)
                  }}
                  title="Rename category"
                  ariaLabel="Rename category"
                  icon={<Pencil size={14} />}
                />
                <RowIconButton
                  variant="danger"
                  onClick={() => onDeleteCategory(category!)}
                  title="Delete category"
                  ariaLabel="Delete category"
                  icon={<Trash2 size={14} />}
                />
              </>
            )}
          </div>
        )}

        {renaming && (
          <div className="flex items-center gap-0.5 ml-auto">
            <RowIconButton
              variant="success"
              onClick={commitRename}
              title="Confirm rename"
              ariaLabel="Confirm rename"
              icon={<Check size={14} />}
            />
            <RowIconButton
              onClick={() => {
                setRenameDraft(category?.name ?? '')
                setRenaming(false)
              }}
              title="Cancel rename"
              ariaLabel="Cancel rename"
              icon={<X size={14} />}
            />
          </div>
        )}
      </div>

      {/* Items */}
      {!collapsed && (
        <div id={regionId} className="mt-1 pl-2">
          {items.length === 0 ? (
            <p className="py-2 px-3 text-sm text-gray-400 italic">No items</p>
          ) : (
            // Per-category SortableContext — items reorder within their own
            // category only. Each row's useSortable resolves to this list.
            <SortableContext items={items.map((i) => makeDnDId('gear-item', i.id))} strategy={verticalListSortingStrategy}>
              {items.map((item) => (
                <SortableGearItemRow
                  key={item.id}
                  item={item}
                  weightUnit={weightUnit}
                  isBelowLg={isBelowLg}
                  selectMode={selectMode}
                  reorderPending={itemReorderPending}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={() => onToggleSelect(item.id)}
                  onInlineSave={(patch) => onInlineSave(item.id, patch)}
                  onEdit={() => onEditItem(item)}
                  onDelete={() => onDeleteItem(item)}
                />
              ))}
            </SortableContext>
          )}
        </div>
      )}
    </div>
  )
}

// Sortable wrapper used for real categories (not Uncategorized). The `id`
// prop is the bare category uuid; we wrap it with makeDnDId here so callers
// don't have to know about the typed-id convention. `reorderPending`
// disables the handle while a previous reorder mutation is still in flight,
// preventing the rollback-clobber race when two reorders overlap.
export function SortableCategorySection(
  props: CategorySectionProps & { id: string; reorderPending?: boolean },
) {
  const { id, reorderPending, ...rest } = props
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: makeDnDId('category', id), disabled: reorderPending })

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
        dragHandleRef={asButtonRef(setActivatorNodeRef)}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
      />
    </div>
  )
}

// Non-sortable version for Uncategorized
export function StaticCategorySection(props: CategorySectionProps) {
  return <CategorySectionInner {...props} />
}
