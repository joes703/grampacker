import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, GripVertical, Plus } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import type { ListItemPatch } from '../lib/queries'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import ListItemRow from './ListItemRow'
import AddItemRow, { type AddItemData } from './AddItemRow'

export type GroupProps = {
  name: string
  items: ListItemWithGear[]
  packMode: boolean
  weightUnit: WeightUnit
  onUpdate: (itemId: string, patch: ListItemPatch) => void
  onDelete: (itemId: string) => void
  onReorderItems: (orderedItems: ListItemWithGear[]) => void
  onSaveGearName: (gearItemId: string, name: string) => void
  onSaveGearDescription: (gearItemId: string, description: string) => void
  onSaveGearWeight: (gearItemId: string, weight_grams: number) => void
  onAddItem: (data: AddItemData) => void
  dragHandle?: React.ReactNode
}

export default function ListCategoryGroup({ name, items, packMode, weightUnit, onUpdate, onDelete, onReorderItems, onSaveGearName, onSaveGearDescription, onSaveGearWeight, onAddItem, dragHandle }: GroupProps) {
  const [adding, setAdding] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const packedCount = items.filter((i) => i.is_packed).length
  const totalGrams = items.reduce((s, i) => s + (i.gear_item?.weight_grams ?? 0) * i.quantity, 0)

  const itemSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleItemDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorderItems(arrayMove(items, oldIndex, newIndex))
  }

  return (
    <div>
      {/* Header — also functions as the column header for Weight / Qty */}
      <div className="flex items-center gap-1.5 rounded-lg px-3 py-0.5 bg-gray-100 mb-1">
        {dragHandle}
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
        {!packMode ? (
          <>
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-7" />
            <div className="shrink-0 w-12 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Qty
            </div>
            <div className="shrink-0 w-16 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Weight
            </div>
            <div className="shrink-0 w-7" />
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
        <div className="pl-2">
          <DndContext sensors={itemSensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {items.map((item) => {
                const gearId = item.gear_item?.id
                return (
                  <ListItemRow
                    key={item.id}
                    item={item}
                    packMode={packMode}
                    weightUnit={weightUnit}
                    onUpdate={(patch) => onUpdate(item.id, patch)}
                    onSaveName={gearId ? (n) => onSaveGearName(gearId, n) : undefined}
                    onSaveDescription={gearId ? (d) => onSaveGearDescription(gearId, d) : undefined}
                    onSaveWeight={gearId ? (w) => onSaveGearWeight(gearId, w) : undefined}
                    onDelete={() => onDelete(item.id)}
                  />
                )
              })}
            </SortableContext>
          </DndContext>

          {/* Draft row when adding — full editable item row */}
          {!packMode && adding && (
            <AddItemRow
              onSubmit={(data) => { onAddItem(data); setAdding(false) }}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* Footer row — "+ Add new item" on the left, category total on the right */}
          {!packMode && !adding && (
            <div className="flex items-center gap-1.5 px-3 py-0.5 text-sm">
              <button
                onClick={() => setAdding(true)}
                className="flex flex-1 min-w-0 items-center gap-1 text-left text-gray-400 hover:text-blue-600"
              >
                <Plus size={12} /> Add new item
              </button>
              <div className="shrink-0 w-7" />
              <div className="shrink-0 w-7" />
              <div className="shrink-0 w-12" />
              <div className="shrink-0 w-16 text-right tabular-nums font-semibold text-gray-700">
                {items.length > 0 ? formatItemWeight(totalGrams, weightUnit) : ''}
              </div>
              <div className="shrink-0 w-7" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SortableListCategoryGroup(props: GroupProps & { id: string }) {
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
      <ListCategoryGroup {...rest} dragHandle={handle} />
    </div>
  )
}
