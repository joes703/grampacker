import { useState, useRef, useEffect } from 'react'
import { AlertTriangle, Shirt, Trash2, UtensilsCrossed } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'

type Props = {
  item: ListItemWithGear
  weightUnit: WeightUnit
  packMode?: boolean
  onUpdate: (patch: Partial<Pick<ListItemWithGear, 'quantity' | 'weight_grams' | 'is_worn' | 'is_consumable' | 'is_packed'>>) => void
  onDelete: () => void
}

export default function ListItemRow({ item, weightUnit, packMode = false, onUpdate, onDelete }: Props) {
  const [editingWeight, setEditingWeight] = useState(false)
  const [weightDraft, setWeightDraft] = useState(String(item.weight_grams))
  const weightInputRef = useRef<HTMLInputElement>(null)

  const [editingQty, setEditingQty] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(String(item.quantity))
  const qtyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setWeightDraft(String(item.weight_grams)) }, [item.weight_grams])
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
    if (clamped !== item.weight_grams) onUpdate({ weight_grams: clamped })
    setEditingWeight(false)
  }

  function commitQty() {
    const parsed = parseInt(qtyDraft, 10)
    const clamped = isNaN(parsed) || parsed < 1 ? 1 : Math.min(parsed, 99)
    if (clamped !== item.quantity) onUpdate({ quantity: clamped })
    setEditingQty(false)
  }

  const sourceWeight = item.gear_item?.weight_grams
  const outOfSync = sourceWeight !== undefined && sourceWeight !== item.weight_grams
  const name = item.gear_item?.name ?? '(deleted item)'
  const description = item.gear_item?.description ?? ''

  // Pack mode: simple checklist row, no column alignment needed
  if (packMode) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
          item.is_packed ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-white'
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
          className={`flex-1 min-w-0 truncate font-medium ${
            item.is_packed ? 'text-gray-400 line-through' : 'text-gray-900'
          }`}
        >
          {name}
        </span>
        <span className="shrink-0 tabular-nums text-gray-500 text-xs">
          {formatItemWeight(item.weight_grams * item.quantity, weightUnit)}
        </span>
      </div>
    )
  }

  // Normal (edit) row: aligned columns matching the category header
  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
      {/* Name + description (flex-1) */}
      <div className="flex-1 min-w-0 flex items-baseline gap-2 truncate">
        <span className="font-medium text-gray-900">{name}</span>
        {description && (
          <span className="min-w-0 truncate text-xs text-gray-500">{description}</span>
        )}
      </div>

      {/* Worn (Shirt) */}
      <button
        onClick={() => onUpdate({ is_worn: !item.is_worn, is_consumable: false })}
        title={item.is_worn ? 'Worn — click to clear' : 'Mark as worn'}
        className={`shrink-0 w-7 h-7 inline-flex items-center justify-center rounded ${
          item.is_worn ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Shirt size={14} />
      </button>

      {/* Consumable (UtensilsCrossed) */}
      <button
        onClick={() => onUpdate({ is_consumable: !item.is_consumable, is_worn: false })}
        title={item.is_consumable ? 'Consumable — click to clear' : 'Mark as consumable'}
        className={`shrink-0 w-7 h-7 inline-flex items-center justify-center rounded ${
          item.is_consumable ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <UtensilsCrossed size={14} />
      </button>

      {/* Out-of-sync indicator (reserves width even when absent) */}
      <div className="shrink-0 w-5 inline-flex items-center justify-center">
        {outOfSync && (
          <button
            onClick={() => onUpdate({ weight_grams: sourceWeight! })}
            title={`Library weight is ${formatItemWeight(sourceWeight!, weightUnit)} — click to sync`}
            className="text-amber-500 hover:text-amber-600"
          >
            <AlertTriangle size={14} />
          </button>
        )}
      </div>

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
          className="shrink-0 w-14 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
        />
      ) : (
        <button
          onClick={() => setEditingQty(true)}
          title="Click to edit quantity"
          className="shrink-0 w-14 text-right tabular-nums text-gray-600 hover:text-blue-600"
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
            if (e.key === 'Escape') { setWeightDraft(String(item.weight_grams)); setEditingWeight(false) }
          }}
          className="shrink-0 w-16 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
        />
      ) : (
        <button
          onClick={() => setEditingWeight(true)}
          title="Click to edit weight"
          className="shrink-0 w-16 text-right tabular-nums text-gray-600 hover:text-blue-600"
        >
          {formatItemWeight(item.weight_grams, weightUnit)}
        </button>
      )}

      {/* Delete — only on row hover (absolute so it doesn't reserve a column) */}
      <button
        onClick={onDelete}
        title="Remove from list"
        className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded bg-white shadow-sm text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
