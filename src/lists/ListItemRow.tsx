import { useState, useRef, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Shirt, UtensilsCrossed, XCircle } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { asButtonRef } from '../lib/dnd'
import InlineText from '../components/InlineText'

type Props = {
  item: ListItemWithGear
  weightUnit: WeightUnit
  packMode?: boolean
  onUpdate: (patch: Partial<Pick<ListItemWithGear, 'quantity' | 'is_worn' | 'is_consumable' | 'is_packed'>>) => void
  onSaveName?: (name: string) => void
  onSaveDescription?: (description: string) => void
  onSaveWeight?: (weight_grams: number) => void
  onDelete: () => void
}

export default function ListItemRow({ item, weightUnit, packMode = false, onUpdate, onSaveName, onSaveDescription, onSaveWeight, onDelete }: Props) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: packMode })

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const itemWeight = item.gear_item?.weight_grams ?? 0
  const [editingWeight, setEditingWeight] = useState(false)
  const [weightDraft, setWeightDraft] = useState(String(itemWeight))
  const weightInputRef = useRef<HTMLInputElement>(null)

  const [editingQty, setEditingQty] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(String(item.quantity))
  const qtyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setWeightDraft(String(itemWeight)) }, [itemWeight])
  useEffect(() => { setQtyDraft(String(item.quantity)) }, [item.quantity])

  useEffect(() => {
    if (editingWeight) weightInputRef.current?.focus()
  }, [editingWeight])
  useEffect(() => {
    if (editingQty) { qtyInputRef.current?.focus(); qtyInputRef.current?.select() }
  }, [editingQty])

  function commitWeight() {
    const parsed = parseInt(weightDraft, 10)
    const clamped = isNaN(parsed) || parsed < 0 ? 0 : Math.min(parsed, 100000)
    if (clamped !== itemWeight && onSaveWeight) onSaveWeight(clamped)
    setEditingWeight(false)
  }

  function commitQty() {
    const parsed = parseInt(qtyDraft, 10)
    const clamped = isNaN(parsed) || parsed < 1 ? 1 : Math.min(parsed, 99)
    if (clamped !== item.quantity) onUpdate({ quantity: clamped })
    setEditingQty(false)
  }

  const name = item.gear_item?.name ?? '(deleted item)'
  const description = item.gear_item?.description ?? ''

  // Pack mode: checklist row — name, worn/consumable status, qty
  if (packMode) {
    return (
      <div
        ref={setNodeRef}
        style={sortableStyle}
        className={`flex items-center gap-1.5 border-b border-gray-100 px-3 py-0.5 text-sm transition-colors ${
          item.is_packed ? 'bg-green-50' : 'bg-white'
        }`}
      >
        <input
          type="checkbox"
          checked={item.is_packed}
          onChange={(e) => onUpdate({ is_packed: e.target.checked })}
          aria-label="Packed"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 shrink-0"
        />
        <span
          className={`flex-1 min-w-0 truncate font-normal ${
            item.is_packed ? 'text-gray-400 line-through' : 'text-gray-900'
          }`}
        >
          {name}
        </span>
        <span className="shrink-0 w-7 inline-flex items-center justify-center">
          {item.is_worn && <Shirt size={14} className="text-purple-600" aria-label="Worn" />}
        </span>
        <span className="shrink-0 w-7 inline-flex items-center justify-center">
          {item.is_consumable && <UtensilsCrossed size={14} className="text-orange-600" aria-label="Consumable" />}
        </span>
        <span className="shrink-0 w-10 text-right tabular-nums text-xs text-gray-500">
          {item.quantity}
        </span>
      </div>
    )
  }

  // Normal (edit) row: aligned columns matching the category header
  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className="group relative flex items-center gap-1.5 border-b border-gray-100 bg-white px-3 py-0.5 text-sm"
    >
      {/* Drag handle — appears on row hover at the left edge */}
      <button
        ref={asButtonRef(setActivatorNodeRef)}
        {...listeners}
        {...attributes}
        tabIndex={-1}
        aria-label="Drag to reorder"
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full cursor-grab touch-none p-1 text-gray-300 hover:text-gray-500 active:cursor-grabbing opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        <GripVertical size={14} />
      </button>

      {/* Name + description as proportional columns — name : description = 2 : 3 */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <div className="flex-[2] min-w-0">
          {onSaveName ? (
            <InlineText
              value={name}
              onSave={onSaveName}
              className="block w-full truncate font-normal text-gray-900"
            />
          ) : (
            <span className="block w-full truncate font-normal text-gray-400 italic">{name}</span>
          )}
        </div>
        <div className="flex-[3] min-w-0">
          {onSaveDescription ? (
            <InlineText
              value={description}
              placeholder="Add description"
              onSave={onSaveDescription}
              className="block w-full truncate text-sm font-normal text-gray-500"
            />
          ) : (
            <span className="block w-full truncate text-sm font-normal text-gray-500">{description}</span>
          )}
        </div>
      </div>

      {/* Worn (Shirt) */}
      <button
        onClick={() => onUpdate({ is_worn: !item.is_worn, is_consumable: false })}
        title={item.is_worn ? 'Worn — click to clear' : 'Mark as worn'}
        className={`shrink-0 w-7 h-6 inline-flex items-center justify-center rounded ${
          item.is_worn ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Shirt size={14} />
      </button>

      {/* Consumable (UtensilsCrossed) */}
      <button
        onClick={() => onUpdate({ is_consumable: !item.is_consumable, is_worn: false })}
        title={item.is_consumable ? 'Consumable — click to clear' : 'Mark as consumable'}
        className={`shrink-0 w-7 h-6 inline-flex items-center justify-center rounded ${
          item.is_consumable ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <UtensilsCrossed size={14} />
      </button>

      {/* Quantity (before weight) */}
      {editingQty ? (
        <input
          ref={qtyInputRef}
          type="number"
          min={1}
          max={99}
          value={qtyDraft}
          onChange={(e) => setQtyDraft(e.target.value)}
          onBlur={commitQty}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitQty()
            if (e.key === 'Escape') { setQtyDraft(String(item.quantity)); setEditingQty(false) }
          }}
          className="shrink-0 w-12 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
        />
      ) : (
        <button
          onClick={() => setEditingQty(true)}
          title="Click to edit quantity"
          className="shrink-0 w-12 text-right tabular-nums text-gray-600 hover:text-blue-600"
        >
          {item.quantity}
        </button>
      )}

      {/* Weight */}
      {editingWeight ? (
        <input
          ref={weightInputRef}
          type="number"
          min={0}
          max={100000}
          value={weightDraft}
          onChange={(e) => setWeightDraft(e.target.value)}
          onBlur={commitWeight}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitWeight()
            if (e.key === 'Escape') { setWeightDraft(String(itemWeight)); setEditingWeight(false) }
          }}
          className="shrink-0 w-16 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
        />
      ) : (
        <button
          onClick={() => setEditingWeight(true)}
          title="Click to edit weight"
          className="shrink-0 w-16 text-right tabular-nums text-gray-600 hover:text-blue-600"
        >
          {formatItemWeight(itemWeight, weightUnit)}
        </button>
      )}

      {/* Remove from list — visible X in flow (does NOT delete from inventory) */}
      <button
        onClick={onDelete}
        title="Remove from list"
        className="shrink-0 w-7 h-6 inline-flex items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
      >
        <XCircle size={14} />
      </button>
    </div>
  )
}
