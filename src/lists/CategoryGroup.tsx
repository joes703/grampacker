import { useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, GripVertical, Plus } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import type { ListItemPatch } from '../lib/queries'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import ItemRow, { SortableItemRow } from './ItemRow'
import AddItemRow, { type AddItemData } from './AddItemRow'

// Droppable id namespace for category drop zones. The page-level
// onDragEnd resolves these to a category id (or null for uncategorised)
// before mutating. Namespaced so it can never collide with a list_items.id.
export const CATEGORY_DROP_PREFIX = 'category-drop:'
export const UNCATEGORISED_KEY = '__uncategorised__'
export function categoryDroppableId(categoryId: string | null): string {
  return `${CATEGORY_DROP_PREFIX}${categoryId ?? UNCATEGORISED_KEY}`
}
export function parseCategoryDroppableId(id: string): string | null | undefined {
  if (!id.startsWith(CATEGORY_DROP_PREFIX)) return undefined
  const v = id.slice(CATEGORY_DROP_PREFIX.length)
  return v === UNCATEGORISED_KEY ? null : v
}

// Single source of truth for a category section. Used by both the
// authenticated list detail view and the public share view.
//
// Column widths (header / footer / row Qty stubs) are defined here so the
// header labels, item rows, and footer totals always line up.
//
// Editing affordances are gated on which handlers are passed:
//   - sortable           ⇒ rows render as SortableItemRow. Must be inside a
//                          page-level <SortableContext> covering all items.
//                          Without it, rows are plain ItemRow (no drag).
//   - categoryId         ⇒ category section registers as a drop target so
//                          the page-level onDragEnd can resolve cross-cat
//                          drops to this category. null ⇒ uncategorised.
//                          undefined ⇒ no drop target (share view).
//   - onAddItem          ⇒ "+ Add new item" footer button + AddItemRow draft.
//   - onDelete + onUpdate + onSaveGear* + onEditGearItem + onDeleteGearItem
//                        ⇒ forwarded per-row to ItemRow's editing affordances.
//   - collapsible        ⇒ header gets a chevron + count badge + toggle.
//                          Default true (authed); share view passes false.
//   - packMode           ⇒ pack-mode header (qty-only, no weight column) +
//                          pack-mode row layout. Authed-only.
//   - dragHandle         ⇒ injected by SortableCategoryGroup wrapper.
export type GroupProps = {
  name: string
  items: ListItemWithGear[]
  weightUnit: WeightUnit
  packMode?: boolean
  collapsible?: boolean
  /** Category id used for drop-target registration. null = uncategorised.
   *  undefined disables the drop target (share view). */
  categoryId?: string | null
  /** Render rows as SortableItemRow (must be inside a page-level SortableContext). */
  sortable?: boolean
  onUpdate?: (itemId: string, patch: ListItemPatch) => void
  onDelete?: (itemId: string) => void
  onSaveGearName?: (gearItemId: string, name: string) => void
  onSaveGearDescription?: (gearItemId: string, description: string) => void
  onSaveGearWeight?: (gearItemId: string, weight_grams: number) => void
  onAddItem?: (data: AddItemData) => void
  // Kebab handlers receive the gear item's id; the parent resolves to a full
  // GearItem from its gearItems query before opening dialogs.
  onEditGearItem?: (gearItemId: string) => void
  onDeleteGearItem?: (gearItemId: string) => void
  dragHandle?: ReactNode
}

export default function CategoryGroup({
  name,
  items,
  weightUnit,
  packMode = false,
  collapsible = true,
  categoryId,
  sortable = false,
  onUpdate,
  onDelete,
  onSaveGearName,
  onSaveGearDescription,
  onSaveGearWeight,
  onAddItem,
  onEditGearItem,
  onDeleteGearItem,
  dragHandle,
}: GroupProps) {
  const [adding, setAdding] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const packedCount = items.filter((i) => i.is_packed).length
  const totalGrams = items.reduce((s, i) => s + (i.gear_item?.weight_grams ?? 0) * i.quantity, 0)
  const showKebabSlot = !packMode && Boolean(onDelete)

  // Drop target for cross-category drops. Disabled when categoryId is undefined
  // (e.g. the share view doesn't allow drops at all).
  const droppable = useDroppable({
    id: categoryId === undefined ? '__disabled__' : categoryDroppableId(categoryId),
    disabled: categoryId === undefined,
  })

  // Per-row props builder — same shape for SortableItemRow and ItemRow.
  function rowPropsFor(item: ListItemWithGear) {
    const gearId = item.gear_item?.id
    return {
      item,
      weightUnit,
      packMode,
      onUpdate: onUpdate ? (patch: ListItemPatch) => onUpdate(item.id, patch) : undefined,
      onSaveName: gearId && onSaveGearName ? (n: string) => onSaveGearName(gearId, n) : undefined,
      onSaveDescription: gearId && onSaveGearDescription ? (d: string) => onSaveGearDescription(gearId, d) : undefined,
      onSaveWeight: gearId && onSaveGearWeight ? (w: number) => onSaveGearWeight(gearId, w) : undefined,
      onEditGearItem: gearId && onEditGearItem ? () => onEditGearItem(gearId) : undefined,
      onDeleteGearItem: gearId && onDeleteGearItem ? () => onDeleteGearItem(gearId) : undefined,
      onDelete: onDelete ? () => onDelete(item.id) : undefined,
    }
  }

  return (
    <div>
      {/* Header — also functions as the column header for Weight / Qty */}
      <div className="flex items-center gap-1.5 rounded-lg px-3 py-0.5 bg-gray-100 mb-1">
        {dragHandle}
        {collapsible ? (
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
          >
            {collapsed ? (
              <ChevronRight size={14} className="text-gray-400 shrink-0" />
            ) : (
              <ChevronDown size={14} className="text-gray-400 shrink-0" />
            )}
            <span className="truncate text-sm font-medium text-gray-700">{name}</span>
            <span className="shrink-0 text-xs tabular-nums text-gray-400">
              {packMode ? `${packedCount} / ${items.length}` : `(${items.length})`}
            </span>
          </button>
        ) : (
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-700">{name}</span>
        )}
        {!packMode ? (
          <>
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-12 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Qty
            </div>
            <div className="shrink-0 w-24 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Weight
            </div>
            {showKebabSlot && <div className="shrink-0 w-7" />}
          </>
        ) : (
          <>
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-10 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Qty
            </div>
          </>
        )}
      </div>

      {/* Items + footer (footer is the row's "total" line, lined up under Weight) */}
      {!collapsed && (
        <div
          ref={droppable.setNodeRef}
          className={`pl-2 ${droppable.isOver ? 'rounded ring-2 ring-blue-300 ring-inset' : ''}`}
        >
          {sortable
            ? items.map((item) => <SortableItemRow key={item.id} {...rowPropsFor(item)} />)
            : items.map((item) => <ItemRow key={item.id} {...rowPropsFor(item)} />)}

          {/* Draft row when adding — full editable item row */}
          {!packMode && onAddItem && adding && (
            <AddItemRow
              onSubmit={(data) => { onAddItem(data); setAdding(false) }}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* Footer row — "+ Add new item" on the left (only when authed),
              category total on the right. */}
          {!packMode && !adding && (
            <div className="flex items-center gap-1.5 px-3 py-0.5 text-sm">
              {onAddItem ? (
                <button
                  onClick={() => setAdding(true)}
                  className="flex flex-1 min-w-0 items-center gap-1 text-left text-gray-400 hover:text-blue-600"
                >
                  <Plus size={12} /> Add new item
                </button>
              ) : (
                <div className="flex-1 min-w-0" />
              )}
              <div className="shrink-0 w-7" />
              <div className="shrink-0 w-7" />
              <div className="shrink-0 w-12" />
              <div className="shrink-0 w-24 text-right tabular-nums font-semibold text-gray-700">
                {items.length > 0 ? formatItemWeight(totalGrams, weightUnit) : ''}
              </div>
              {showKebabSlot && <div className="shrink-0 w-7" />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Sortable wrapper for the authenticated list view's category-level
// drag-and-drop. Must be rendered inside a SortableContext.
export function SortableCategoryGroup(props: GroupProps & { id: string }) {
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

  const handle = (
    <button
      ref={asButtonRef(setActivatorNodeRef)}
      {...listeners}
      {...attributes}
      className="cursor-grab touch-none text-gray-400 hover:text-gray-600 active:cursor-grabbing shrink-0"
      tabIndex={-1}
      aria-label="Drag to reorder category"
    >
      <GripVertical size={14} />
    </button>
  )

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <CategoryGroup {...rest} dragHandle={handle} />
    </div>
  )
}
