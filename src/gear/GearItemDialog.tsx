import { useState, type FormEvent } from 'react'
import { CircleMinus, Minus, Plus, Shirt, Trash2, UtensilsCrossed, X } from 'lucide-react'
import type { Category, GearItem } from '../lib/types'
import Modal from '../components/Modal'
import WeightInput from '../components/WeightInput'

export type GearPatch = {
  name: string
  description: string | null
  weight_grams: number
  category_id: string | null
}

export type ListContextPatch = {
  quantity: number
  is_worn: boolean
  is_consumable: boolean
}

type Props = {
  categories: Category[]
  item?: GearItem
  defaultCategoryId?: string | null
  /** When provided, the dialog renders an "On this list" section with
   *  quantity / worn / consumable fields, and onSave receives a second
   *  argument with the list-item patch. Omitted from the gear-library
   *  edit path; the bottom section doesn't render and onSave's second
   *  argument is null. */
  listContext?: ListContextPatch
  onSave: (gearPatch: GearPatch, listPatch: ListContextPatch | null) => void
  onClose: () => void
  saving?: boolean
  /** Mobile-only (< lg) action buttons. Both render only when listContext
   *  is also provided (i.e. the dialog was opened from a list). On desktop
   *  these actions are reached via the row kebab. */
  onRemoveFromList?: () => void
  onDeleteFromInventory?: () => void
  /** Save-time error surfaced from the parent. Rendered inline in the dialog
   *  body so the user sees it without a toast and can retry without losing
   *  their edits. Owned by the parent since it knows which mutation failed
   *  and what state the DB is left in. */
  saveError?: string | null
}

export default function GearItemDialog({
  categories,
  item,
  defaultCategoryId = null,
  listContext,
  onSave,
  onClose,
  saving = false,
  onRemoveFromList,
  onDeleteFromInventory,
  saveError = null,
}: Props) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [weightGrams, setWeightGrams] = useState(item?.weight_grams ?? 0)
  const [categoryId, setCategoryId] = useState<string | null>(
    item?.category_id ?? defaultCategoryId,
  )
  const [quantity, setQuantity] = useState(listContext?.quantity ?? 1)
  const [worn, setWorn] = useState(listContext?.is_worn ?? false)
  const [consumable, setConsumable] = useState(listContext?.is_consumable ?? false)

  // Form state is initialized from props by the useState initializers above;
  // there is no reset effect because the dialog is keyed on the target's id
  // at every call site (ListDetailPage, GearLibraryPage), so switching to a
  // different target remounts the component with fresh state by construction.

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const gearPatch: GearPatch = {
      name: name.trim(),
      description: description.trim() || null,
      weight_grams: Math.max(0, Math.min(weightGrams, 100000)),
      category_id: categoryId,
    }
    const listPatch: ListContextPatch | null = listContext
      ? {
          quantity: Math.max(1, Math.min(99, Math.round(quantity) || 1)),
          is_worn: worn,
          is_consumable: consumable,
        }
      : null
    onSave(gearPatch, listPatch)
  }

  // Worn/consumable XOR: ticking one unticks the other. Reflects the DB
  // CHECK constraint (worn_xor_consumable) and matches the in-row toggle
  // semantics on desktop.
  function toggleWorn() {
    const next = !worn
    setWorn(next)
    if (next) setConsumable(false)
  }
  function toggleConsumable() {
    const next = !consumable
    setConsumable(next)
    if (next) setWorn(false)
  }

  const isEdit = Boolean(item)
  const heading = isEdit ? 'Edit item' : 'New item'

  return (
    <Modal open onClose={onClose} title={heading} className="w-full max-w-md" closeOnBackdropClick={false}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="gi-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              id="gi-name"
              type="text"
              required
              maxLength={256}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="gi-desc" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="gi-desc"
              maxLength={2000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex gap-4">
            <div className="w-40">
              <label htmlFor="gi-weight" className="block text-sm font-medium text-gray-700 mb-1">
                Weight
              </label>
              <WeightInput
                inputId="gi-weight"
                grams={weightGrams}
                onChange={setWeightGrams}
                className="w-full"
                inputClassName="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="gi-cat" className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                id="gi-cat"
                value={categoryId ?? ''}
                onChange={(e) => setCategoryId(e.target.value || null)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Uncategorised —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* List-context section — quantity / worn / consumable. Only shown
              when the dialog was opened from a list (listContext provided).
              The gear-library edit path omits listContext, so this section
              doesn't render and the dialog stays as it was. */}
          {listContext && (
            <div className="border-t border-gray-200 pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                On this list
              </p>
              <div>
                <label htmlFor="gi-qty" className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity
                </label>
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                    className="inline-flex w-11 h-11 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    id="gi-qty"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)))
                    }
                    className="w-16 h-11 rounded-lg border border-gray-300 px-2 text-center text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                    disabled={quantity >= 99}
                    aria-label="Increase quantity"
                    className="inline-flex w-11 h-11 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={worn}
                    onChange={toggleWorn}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <Shirt size={14} className="text-purple-600" />
                  <span className="text-sm text-gray-700">Worn (not added to pack weight)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={consumable}
                    onChange={toggleConsumable}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <UtensilsCrossed size={14} className="text-orange-600" />
                  <span className="text-sm text-gray-700">Consumable (food, fuel, water)</span>
                </label>
              </div>
            </div>
          )}

          {/* Mobile-only destructive / scoping actions. On desktop these live
              in the row kebab (list view) or as inline icon buttons (gear
              inventory). The wrapper renders if either action is wired;
              "Remove from list" still requires listContext (it has no
              meaning outside a list), but "Delete from inventory" applies
              both to list-view edits and to the gear inventory page. */}
          {(onRemoveFromList || onDeleteFromInventory) && (
            <div className="lg:hidden border-t border-gray-200 pt-4 space-y-3">
              {listContext && onRemoveFromList && (
                <button
                  type="button"
                  onClick={onRemoveFromList}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <CircleMinus size={14} />
                  Remove from list
                </button>
              )}
              {onDeleteFromInventory && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-2">
                    Danger
                  </p>
                  <button
                    type="button"
                    onClick={onDeleteFromInventory}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700"
                  >
                    <Trash2 size={14} />
                    Delete from inventory
                  </button>
                </div>
              )}
            </div>
          )}

          {saveError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {saveError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
