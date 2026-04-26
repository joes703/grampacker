import { useState, useRef, useEffect } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import type { GearItem } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'

type Props = {
  item: GearItem
  weightUnit: WeightUnit
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onInlineSave: (patch: Partial<Pick<GearItem, 'name' | 'description'>>) => void
  onEdit: () => void
  onDelete: () => void
}

function InlineText({
  value,
  placeholder,
  onSave,
  className = '',
}: {
  value: string
  placeholder?: string
  onSave: (v: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function save() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        className={`rounded border border-blue-400 px-1 py-0.5 text-sm focus:outline-none ${className}`}
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={`cursor-text rounded px-1 py-0.5 hover:bg-gray-100 ${className}`}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
    </span>
  )
}

export default function GearItemRow({
  item,
  weightUnit,
  selectMode,
  selected,
  onToggleSelect,
  onInlineSave,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-1 text-sm ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-gray-300 text-blue-600"
        />
      )}
      <div className="flex-1 min-w-0 flex items-baseline gap-2 truncate">
        <InlineText
          value={item.name}
          onSave={(v) => onInlineSave({ name: v })}
          className="font-medium text-gray-900"
        />
        {(item.description !== null || !selectMode) && (
          <InlineText
            value={item.description ?? ''}
            placeholder="Add description"
            onSave={(v) => onInlineSave({ description: v })}
            className="min-w-0 text-xs text-gray-500"
          />
        )}
      </div>
      <span className="shrink-0 text-sm text-gray-600 tabular-nums">
        {formatItemWeight(item.weight_grams, weightUnit)}
      </span>
      {!selectMode && (
        <>
          <button
            onClick={onEdit}
            title="Edit item"
            className="rounded p-1 text-gray-400 hover:text-gray-700"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDelete}
            title="Delete item"
            className="rounded p-1 text-gray-400 hover:text-red-600"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  )
}
