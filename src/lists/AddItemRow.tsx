import { useState } from 'react'
import { Shirt, UtensilsCrossed, XCircle } from 'lucide-react'
import RowIconButton from '../components/RowIconButton'
import WeightInput from '../components/WeightInput'

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
  const [weightGrams, setWeightGrams] = useState(0)
  const [quantity, setQuantity] = useState('1')
  const [worn, setWorn] = useState(false)
  const [consumable, setConsumable] = useState(false)

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) return
    const w = Math.max(0, Math.min(weightGrams, 100000))
    const q = Math.max(1, Math.min(parseInt(quantity, 10) || 1, 9999))
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
        <label className="flex-[2] min-w-0">
          <span className="sr-only">Item name</span>
          <input
            autoFocus
            value={name}
            placeholder="Item name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKey}
            maxLength={256}
            className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm font-normal focus:outline-none"
          />
        </label>
        <label className="flex-[3] min-w-0">
          <span className="sr-only">Description (optional)</span>
          <input
            value={description}
            placeholder="Description (optional)"
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={handleKey}
            maxLength={2000}
            className="w-full rounded border border-gray-200 px-1 py-0.5 text-sm font-normal focus:outline-none focus:border-blue-400"
          />
        </label>
      </div>

      <RowIconButton
        variant="purpleToggle"
        active={worn}
        onClick={() => { setWorn((v) => !v); if (!worn) setConsumable(false) }}
        title="Worn"
        ariaLabel="Worn"
        icon={<Shirt size={14} />}
      />
      <RowIconButton
        variant="orangeToggle"
        active={consumable}
        onClick={() => { setConsumable((v) => !v); if (!consumable) setWorn(false) }}
        title="Consumable"
        ariaLabel="Consumable"
        icon={<UtensilsCrossed size={14} />}
      />

      <input
        type="number"
        min={1}
        max={9999}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={handleKey}
        aria-label="Quantity"
        className="shrink-0 w-12 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
      />
      <WeightInput
        grams={weightGrams}
        onChange={setWeightGrams}
        onKeyDown={handleKey}
        ariaLabel="Weight"
        className="shrink-0 w-24"
        inputClassName="flex-1 min-w-0 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums focus:outline-none"
      />

      <RowIconButton
        variant="danger"
        onClick={onCancel}
        title="Cancel"
        ariaLabel="Cancel"
        icon={<XCircle size={14} />}
      />
    </div>
  )
}
