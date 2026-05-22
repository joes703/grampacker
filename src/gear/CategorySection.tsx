import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, GripVertical, Pencil, Trash2, Check, X, MoreVertical } from 'lucide-react'
import type { Category, GearItem } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import { makeDnDId } from '../lib/dnd-ids'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
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
  onSetItemStatus: (id: string, status: GearItem['status']) => void
  onRenameCategory: (id: string, name: string) => void
  onDeleteCategory: (category: Category) => void
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
    onSetItemStatus,
    onRenameCategory,
    onDeleteCategory,
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
      <div className="flex min-h-11 items-center gap-1 rounded-lg px-2 py-0.5 bg-gray-100">
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

        {/* Collapse toggle - sized for touch on mobile (40x40, the minimum
            comfortable target on phone hardware) and tightened on desktop
            where mouse precision is higher. The chevron is the only
            collapse affordance; the name button next to it triggers
            rename, not collapse, so the two intents stay separate. */}
        <button
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-controls={regionId}
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          className="inline-flex h-10 w-10 lg:h-7 lg:w-7 items-center justify-center rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200/60 shrink-0"
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
          category && !selectMode ? (
            <button
              type="button"
              onClick={() => {
                setRenameDraft(category.name)
                setRenaming(true)
              }}
              title="Click to rename"
              className="flex-1 min-w-0 rounded px-1 py-0.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              <span className="truncate">{name}</span>
              <span className="ml-1.5 text-xs font-normal tabular-nums text-gray-500">({items.length})</span>
            </button>
          ) : (
            <span className="flex-1 text-sm font-medium text-gray-700 select-none">
              {name}
              <span className="ml-1.5 text-xs font-normal tabular-nums text-gray-500">({items.length})</span>
            </span>
          )
        )}

        {/* Header actions — hidden in select mode */}
        {!selectMode && !renaming && (
          <div
            className={`flex items-center gap-1.5 ml-auto ${
              items.length > 0 && !collapsed ? 'lg:pr-1' : ''
            }`}
          >
            {/* Desktop column labels — widths and gap mirror GearItemRow's
               right-side columns (w-20 cost, w-24 purchase date, w-24
               weight, w-7 kebab) so labels sit directly above row values.
               lg:pr-1 nudges the block 4px left to absorb the header's
               px-2 vs the row's px-3 outer-padding difference. lg:contents
               flattens the labels into the parent flex on desktop so the
               parent's gap-1.5 applies between every column. Suppressed
               on mobile, when the category is collapsed, on empty
               categories, and in select mode (the parent !selectMode
               gate handles that — the row reshapes there: checkbox added,
               kebab removed, so labels would no longer match columns). */}
            {items.length > 0 && !collapsed && (
              <div aria-hidden="true" className="hidden lg:contents text-xs text-gray-400">
                <span className="shrink-0 w-20 text-right">Price</span>
                <span className="shrink-0 w-24 text-right">Purchased</span>
                <span className="shrink-0 w-24 text-right">Weight</span>
                {/* Uncategorized has no category-level kebab in the header,
                   but item rows still render a per-row kebab in non-select
                   mode. Without this spacer, the labels above would slide
                   2.125rem (w-7 + gap-1.5) right of the row column edges. */}
                {!category && <span className="shrink-0 w-7" />}
              </div>
            )}
            {category && (
              <CategoryKebab
                onRename={() => {
                  setRenameDraft(category.name)
                  setRenaming(true)
                }}
                onDelete={() => onDeleteCategory(category)}
              />
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
                  onSetStatus={(status) => onSetItemStatus(item.id, status)}
                />
              ))}
            </SortableContext>
          )}
        </div>
      )}
    </div>
  )
}

function CategoryKebab({
  onRename,
  onDelete,
}: {
  onRename: () => void
  onDelete: () => void
}) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })

  return (
    <>
      <RowIconButton
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          if (menuOpen) close()
          else openMenu()
        }}
        ariaLabel="Category options"
        icon={<MoreVertical size={14} />}
      />

      {menuOpen && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <MenuItem icon={<Pencil size={13} />} onClick={() => { close(); onRename() }}>
            Rename
          </MenuItem>
          <div className="my-1 border-t border-gray-100" />
          <MenuItem icon={<Trash2 size={13} />} onClick={() => { close(); onDelete() }} danger>
            Delete category
          </MenuItem>
        </div>,
        document.body,
      )}
    </>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
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
