import { useState, type FormEvent } from 'react'
import { Check, CircleMinus, Minus, Plus, Shirt, Trash2, UtensilsCrossed, X } from 'lucide-react'
import type { Category, GearItem } from '../lib/types'
import { DEFAULT_GEAR_STATUS, type GearStatus } from '../lib/gear-status'
import { CONSUMABLE_ICON_CLASS, WORN_ICON_CLASS } from '../lib/row-indicator-styles'
import Modal from '../components/Modal'
import WeightInput from '../components/WeightInput'

export type GearPatch = {
  name: string
  description: string | null
  weight_grams: number
  category_id: string | null
  cost: number | null
  purchase_date: string | null
  status: GearStatus
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
  onCreateCategory?: (name: string) => Promise<Category>
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
  onCreateCategory,
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
  // Cost is held as a string so the user can type freely (e.g. "89.",
  // "89.9") without React fighting the cursor; parsed to number on
  // submit. Empty string → null. Initial value is the existing cost
  // formatted to two decimals so editing doesn't drift the display.
  const [cost, setCost] = useState(
    item?.cost != null ? item.cost.toFixed(2) : '',
  )
  // purchase_date is already an ISO YYYY-MM-DD string in the model and
  // the <input type="date"> contract — no parsing needed.
  const [purchaseDate, setPurchaseDate] = useState(item?.purchase_date ?? '')
  const [status, setStatus] = useState<GearStatus>(item?.status ?? DEFAULT_GEAR_STATUS)
  const [quantity, setQuantity] = useState(listContext?.quantity ?? 1)
  const [worn, setWorn] = useState(listContext?.is_worn ?? false)
  const [consumable, setConsumable] = useState(listContext?.is_consumable ?? false)
  const [newCategoryOpen, setNewCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  // Form state is initialized from props by the useState initializers above;
  // there is no reset effect because the dialog is keyed on the target's id
  // at every call site (ListDetailPage, GearLibraryPage), so switching to a
  // different target remounts the component with fresh state by construction.

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmedCost = cost.trim()
    const parsedCost = trimmedCost === '' ? NaN : parseFloat(trimmedCost)
    const trimmedDate = purchaseDate.trim()
    const gearPatch: GearPatch = {
      name: name.trim(),
      description: description.trim() || null,
      weight_grams: Math.max(0, Math.min(weightGrams, 100000)),
      category_id: categoryId,
      // Blank / NaN / negative → null, never 0. Same rule as parseCost
      // in csv.ts so manual entry and CSV import agree.
      cost: !isFinite(parsedCost) || parsedCost < 0
        ? null
        : Math.round(parsedCost * 100) / 100,
      // <input type="date"> emits ISO YYYY-MM-DD already; trust the
      // shape and only collapse blanks to null.
      purchase_date: trimmedDate === '' ? null : trimmedDate,
      status,
    }
    const listPatch: ListContextPatch | null = listContext
      ? {
          quantity: Math.max(1, Math.min(9999, Math.round(quantity) || 1)),
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

  async function handleCreateCategory() {
    const trimmed = newCategoryName.trim()
    if (!trimmed || !onCreateCategory) return
    setCreatingCategory(true)
    setCategoryError(null)
    try {
      const created = await onCreateCategory(trimmed)
      setCategoryId(created.id)
      setNewCategoryName('')
      setNewCategoryOpen(false)
    } catch {
      setCategoryError("Couldn't create category. Please try again.")
    } finally {
      setCreatingCategory(false)
    }
  }

  const isEdit = Boolean(item)
  const heading = isEdit ? 'Edit item' : 'New item'

  return (
    // max-h-[90vh] + flex column lets the dialog cap its height and split
    // into header / scrollable body / sticky footer. On viewports tall
    // enough to fit the form (most desktops), the body just doesn't
    // scroll. On mobile, the body scrolls and Save/Cancel stay reachable
    // at the bottom of the modal without the user hunting for them.
    <Modal
      open
      onClose={onClose}
      title={heading}
      className="w-full max-w-md max-h-[90vh] flex flex-col"
      closeOnBackdropClick={false}
    >
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        {/* Header — sits above the scroll region so the close button
            never disappears as the user scrolls the form. */}
        <div className="flex items-center justify-between px-6 pt-6 pb-3 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {/* Scroll region — flex-1 min-h-0 is the standard recipe for a
            flex child that can shrink AND grow inside its parent's flex
            constraints. Without min-h-0 the child would refuse to be
            smaller than its content and the overflow-y-auto would
            never kick in. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4">
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
                onChange={(e) => {
                  if (e.target.value === '__new_category__') {
                    setNewCategoryOpen(true)
                    setCategoryError(null)
                  } else {
                    setCategoryId(e.target.value || null)
                  }
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Uncategorized —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {onCreateCategory && <option value="__new_category__">+ New category</option>}
              </select>
              {newCategoryOpen && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Category name"
                    maxLength={128}
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleCreateCategory()
                      }
                      if (e.key === 'Escape') {
                        setNewCategoryName('')
                        setNewCategoryOpen(false)
                        setCategoryError(null)
                      }
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateCategory()}
                    disabled={creatingCategory || !newCategoryName.trim()}
                    aria-label="Create category"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCategoryName('')
                      setNewCategoryOpen(false)
                      setCategoryError(null)
                    }}
                    aria-label="Cancel new category"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {categoryError && <p className="mt-1 text-xs text-red-600">{categoryError}</p>}
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-40">
              <label htmlFor="gi-cost" className="block text-sm font-medium text-gray-700 mb-1">
                Cost (USD)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                  $
                </span>
                <input
                  id="gi-cost"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder=""
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 pl-6 pr-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1">
              <label htmlFor="gi-pdate" className="block text-sm font-medium text-gray-700 mb-1">
                Purchase date
              </label>
              <input
                id="gi-pdate"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label htmlFor="gi-status" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              id="gi-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as GearStatus)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="needs_repair">Needs repair</option>
              <option value="loaned_out">Loaned out</option>
            </select>
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
                    max={9999}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(Math.max(1, Math.min(9999, parseInt(e.target.value, 10) || 1)))
                    }
                    className="w-16 h-11 rounded-lg border border-gray-300 px-2 text-center text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(9999, q + 1))}
                    disabled={quantity >= 9999}
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
                  <Shirt size={14} className={WORN_ICON_CLASS} />
                  <span className="text-sm text-gray-700">Worn (not added to pack weight)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={consumable}
                    onChange={toggleConsumable}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <UtensilsCrossed size={14} className={CONSUMABLE_ICON_CLASS} />
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

          {/* Bottom padding so the last form field has breathing room
              above the sticky footer. */}
          <div className="h-2" aria-hidden="true" />
        </div>

        {/* Sticky footer — Cancel / Save. Stays visible at the bottom of
            the modal even when the scroll region above scrolls. Inside
            the form so Enter from any field still submits. The
            safe-area padding handles iOS home-indicator overlap when the
            dialog snaps to the bottom on short viewports. */}
        <div
          className="shrink-0 border-t border-gray-100 bg-white px-6 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex justify-end gap-2">
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
        </div>
      </form>
    </Modal>
  )
}
