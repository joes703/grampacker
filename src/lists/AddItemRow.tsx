import { useState } from 'react'
import { Shirt, UtensilsCrossed, XCircle } from 'lucide-react'

export type AddItemData = {
  name: string
  description: string | null
  weight_grams: number
  quantity: number
  is_worn: boolean
  is_consumable: boolean
}

type Props = {
  onSubmit: (data: AddItemData) => void
  onCancel: () => void
}

// Editable draft row for the "+ Add new item" affordance under a category.
// Mirrors the regular ListItemRow column geometry; full-row blur commits when
// name is non-empty, cancels when blank.
export default function AddItemRow({ onSubmit, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [weight, setWeight] = useState('0')
  const [quantity, setQuantity] = useState('1')
  const [worn, setWorn] = useState(false)
  const [consumable, setConsumable] = useState(false)

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) return
    const w = Math.max(0, Math.min(parseInt(weight, 10) || 0, 100000))
    const q = Math.max(1, Math.min(parseInt(quantity, 10) || 1, 99))
    onSubmit({
      name: trimmed.slice(0, 256),
      description: description.trim() ? description.trim().slice(0, 2000) : null,
      weight_grams: w,
      quantity: q,
      is_worn: worn,
      is_consumable: consumable,
    })
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') onCancel()
  }

  // Commit (or cancel, if name is empty) when focus leaves the entire row —
  // not just one input. relatedTarget is the element receiving focus next; if
  // it's a child of this row, the user is just tabbing between fields and we
  // shouldn't commit yet.
  function handleRowBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    if (name.trim()) commit()
    else onCancel()
  }

  return (
    <div
      onBlur={handleRowBlur}
      className="flex items-center gap-1.5 border-b border-gray-100 bg-blue-50/40 px-3 py-0.5 text-sm"
    >
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <input
          autoFocus
          value={name}
          placeholder="Item name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKey}
          maxLength={256}
          className="flex-[2] min-w-0 rounded border border-blue-400 px-1 py-0.5 text-sm font-medium focus:outline-none"
        />
        <input
          value={description}
          placeholder="Description (optional)"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKey}
          maxLength={2000}
          className="flex-[3] min-w-0 rounded border border-gray-200 px-1 py-0.5 text-xs focus:outline-none focus:border-blue-400"
        />
      </div>

      <button
        type="button"
        onClick={() => { setWorn((v) => !v); if (!worn) setConsumable(false) }}
        title="Worn"
        className={`shrink-0 w-7 h-6 inline-flex items-center justify-center rounded ${
          worn ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Shirt size={14} />
      </button>
      <button
        type="button"
        onClick={() => { setConsumable((v) => !v); if (!consumable) setWorn(false) }}
        title="Consumable"
        className={`shrink-0 w-7 h-6 inline-flex items-center justify-center rounded ${
          consumable ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
        }`}
      >
        <UtensilsCrossed size={14} />
      </button>

      <input
        type="number"
        min={1}
        max={99}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={handleKey}
        className="shrink-0 w-12 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
      />
      <input
        type="number"
        min={0}
        max={100000}
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        onKeyDown={handleKey}
        className="shrink-0 w-16 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
      />

      <button
        type="button"
        onClick={onCancel}
        title="Cancel"
        className="shrink-0 w-7 h-6 inline-flex items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
      >
        <XCircle size={14} />
      </button>
    </div>
  )
}
