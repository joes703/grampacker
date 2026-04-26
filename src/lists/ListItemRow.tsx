import { useState, useRef, useEffect } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
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

  useEffect(() => {
    setWeightDraft(String(item.weight_grams))
  }, [item.weight_grams])

  useEffect(() => {
    if (editingWeight) weightInputRef.current?.focus()
  }, [editingWeight])

  function commitWeight() {
    const parsed = parseInt(weightDraft, 10)
    const clamped = isNaN(parsed) || parsed < 0 ? 0 : Math.min(parsed, 100000)
    if (clamped !== item.weight_grams) onUpdate({ weight_grams: clamped })
    setEditingWeight(false)
  }

  const sourceWeight = item.gear_item?.weight_grams
  const outOfSync = sourceWeight !== undefined && sourceWeight !== item.weight_grams
  const name = item.gear_item?.name ?? '(deleted item)'

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        packMode && item.is_packed
          ? 'border-green-200 bg-green-50'
          : 'border-gray-100 bg-white'
      }`}
    >
      {/* Pack-mode checkbox */}
      {packMode && (
        <input
          type="checkbox"
          checked={item.is_packed}
          onChange={(e) => onUpdate({ is_packed: e.target.checked })}
          aria-label="Packed"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 shrink-0"
        />
      )}

      {/* Name */}
      <span
        className={`flex-1 min-w-0 truncate font-medium ${
          packMode && item.is_packed ? 'text-gray-400 line-through' : 'text-gray-900'
        }`}
      >
        {name}
      </span>

      {/* Out-of-sync indicator (hidden in pack mode) */}
      {!packMode && outOfSync && (
        <button
          onClick={() => onUpdate({ weight_grams: sourceWeight! })}
          title={`Library weight is ${formatItemWeight(sourceWeight!, weightUnit)} — click to sync`}
          className="shrink-0 text-amber-500 hover:text-amber-600"
        >
          <AlertTriangle size={14} />
        </button>
      )}

      {/* Weight: read-only in pack mode, click to edit otherwise */}
      {packMode ? (
        <span className="shrink-0 tabular-nums text-gray-500 text-xs">
          {formatItemWeight(item.weight_grams * item.quantity, weightUnit)}
        </span>
      ) : editingWeight ? (
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
          className="w-20 rounded border border-blue-400 px-1.5 py-0.5 text-right text-sm tabular-nums focus:outline-none"
        />
      ) : (
        <button
          onClick={() => setEditingWeight(true)}
          title="Click to edit weight"
          className="shrink-0 tabular-nums text-gray-600 hover:text-blue-600"
        >
          {formatItemWeight(item.weight_grams, weightUnit)}
        </button>
      )}

      {/* Quantity stepper (hidden in pack mode) */}
      {!packMode && (
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => item.quantity > 1 && onUpdate({ quantity: item.quantity - 1 })}
          disabled={item.quantity <= 1}
          className="w-5 h-5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 text-center leading-none"
        >−</button>
        <span className="w-4 text-center text-xs tabular-nums text-gray-700">{item.quantity}</span>
        <button
          onClick={() => item.quantity < 99 && onUpdate({ quantity: item.quantity + 1 })}
          disabled={item.quantity >= 99}
          className="w-5 h-5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 text-center leading-none"
        >+</button>
      </div>
      )}

      {/* Worn / Consumable / Delete (hidden in pack mode) */}
      {!packMode && (
        <>
          <button
            onClick={() => {
              if (item.is_worn) onUpdate({ is_worn: false })
              else onUpdate({ is_worn: true, is_consumable: false })
            }}
            title="Worn (excluded from pack weight)"
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${item.is_worn ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-600'}`}
          >W</button>
          <button
            onClick={() => {
              if (item.is_consumable) onUpdate({ is_consumable: false })
              else onUpdate({ is_consumable: true, is_worn: false })
            }}
            title="Consumable (added to pack weight separately)"
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${item.is_consumable ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:text-gray-600'}`}
          >C</button>
          <button
            onClick={onDelete}
            title="Remove from list"
            className="rounded p-1 text-gray-400 hover:text-red-600"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  )
}
