import { useState, type FormEvent } from 'react'
import { CircleMinus, Minus, Plus, Shirt, Trash2, UtensilsCrossed, X } from 'lucide-react'
import type { Category, GearItem } from '../../lib/types'
import { DEFAULT_GEAR_STATUS, GEAR_STATUS_MENU_OPTIONS, type GearStatus } from '../../lib/gear-status'
import { CONSUMABLE_ICON_CLASS, WORN_ICON_CLASS } from '../../lib/row-indicator-styles'
import { FLAT_TABLE_EYEBROW, FORM_INPUT, ROW_CONTROL_TARGET, SECONDARY_BUTTON } from '../flat-table-styles'
import FormLabel from '../FormLabel'
import InlineCreateCategory from '../InlineCreateCategory'
import Modal from '../Modal'
import PrimaryButton from '../PrimaryButton'
import WeightInput from '../WeightInput'
import { MAX_COST, MAX_NAME_LENGTH, MAX_DESC_LENGTH, MAX_LIST_ITEM_QUANTITY } from '../../lib/caps'
import { clampQuantity } from '../../../shared/lists'
import { useWornConsumableFlags } from '../../lists/use-worn-consumable-flags'
import { clampWeightGrams } from '../../../shared/gear'

export type GearPatch = {
  name: string
  description: string | null
  weightGrams: number
  categoryId: string | null
  cost: number | null
  purchaseDate: string | null
  status: GearStatus
}

export type ListContextPatch = {
  quantity: number
  isWorn: boolean
  isConsumable: boolean
}

type Props = {
  categories: Category[]
  item?: GearItem
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
  const [weightGrams, setWeightGrams] = useState(item?.weightGrams ?? 0)
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? null)
  // Cost is held as a string so the user can type freely (e.g. "89.",
  // "89.9") without React fighting the cursor; parsed to number on
  // submit. Empty string → null. Initial value is the existing cost
  // formatted to two decimals so editing doesn't drift the display.
  const [costError, setCostError] = useState<string | null>(null)
  const [cost, setCost] = useState(
    item?.cost != null ? item.cost.toFixed(2) : '',
  )
  // purchaseDate is already an ISO YYYY-MM-DD string in the model and
  // the <input type="date"> contract — no parsing needed.
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate ?? '')
  const [status, setStatus] = useState<GearStatus>(item?.status ?? DEFAULT_GEAR_STATUS)
  const [quantity, setQuantity] = useState(listContext?.quantity ?? 1)
  const { worn, consumable, toggleWorn, toggleConsumable } = useWornConsumableFlags({
    isWorn: listContext?.isWorn ?? false,
    isConsumable: listContext?.isConsumable ?? false,
  })
  // Visibility only: the editor itself (draft, pending, error, late-answer
  // protection) is the shared InlineCreateCategory, remounted fresh each open.
  const [newCategoryOpen, setNewCategoryOpen] = useState(false)

  // Form state is initialized from props by the useState initializers above;
  // there is no reset effect because the dialog is keyed on the target's id
  // at every call site (ListDetailPage, GearLibraryPage), so switching to a
  // different target remounts the component with fresh state by construction.

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmedCost = cost.trim()
    const parsedCost = trimmedCost === '' ? NaN : parseFloat(trimmedCost)
    // The server refuses a cost above its maximum; say so here instead.
    if (parsedCost > MAX_COST) {
      setCostError(`Cost must be $${MAX_COST.toLocaleString('en-US')} or less.`)
      return
    }
    setCostError(null)
    const trimmedDate = purchaseDate.trim()
    const gearPatch: GearPatch = {
      name: name.trim(),
      description: description.trim() || null,
      weightGrams: clampWeightGrams(weightGrams),
      categoryId: categoryId,
      // Blank / NaN / negative -> null (unknown), never 0.
      cost: !isFinite(parsedCost) || parsedCost < 0
        ? null
        : Math.round(parsedCost * 100) / 100,
      // <input type="date"> emits ISO YYYY-MM-DD already; trust the
      // shape and only collapse blanks to null.
      purchaseDate: trimmedDate === '' ? null : trimmedDate,
      status,
    }
    const listPatch: ListContextPatch | null = listContext
      ? {
          quantity: clampQuantity(quantity),
          isWorn: worn,
          isConsumable: consumable,
        }
      : null
    onSave(gearPatch, listPatch)
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
      className="w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-hidden"
      closeOnBackdropClick={false}
    >
      <form onSubmit={handleSubmit} className="flex max-h-[90vh] min-h-0 flex-col">
        {/* Header — sits above the scroll region so the close button
            never disappears as the user scrolls the form. */}
        <div className="flex items-center justify-between px-6 pt-6 pb-3 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`${ROW_CONTROL_TARGET} text-gray-500 hover:text-gray-600`}>
            <X size={18} />
          </button>
        </div>

        {/* Scroll region — flex-1 min-h-0 is the standard recipe for a
            flex child that can shrink AND grow inside its parent's flex
            constraints. Without min-h-0 the child would refuse to be
            smaller than its content and the overflow-y-auto would
            never kick in.

            The fieldset freezes the form for the duration of a save. Without it
            the fields stay live while the request is out, so anything typed
            after Save is in state the submitted patch never saw - and a success
            closes the dialog and discards it, silently. Deliberately scoped to
            the body: the header's Close and the footer's Cancel stay reachable,
            because abandoning a slow save is a legitimate thing to want (the
            page's completion guard is what makes leaving safe).

            min-w-0 is load-bearing: a <fieldset> carries a UA
            `min-inline-size: min-content`, which would stop it shrinking and let
            the two-column rows below (and native date controls) overflow the
            modal. The div this replaced had no such floor. */}
        <fieldset
          disabled={saving}
          className="flex-1 min-h-0 min-w-0 overflow-y-auto px-6 space-y-4 disabled:opacity-60"
        >
          <div>
            <FormLabel htmlFor="gi-name">
              Name
            </FormLabel>
            <input
              id="gi-name"
              type="text"
              required
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full ${FORM_INPUT}`}
              autoFocus
            />
          </div>
          <div>
            <FormLabel htmlFor="gi-desc">
              Description
            </FormLabel>
            <textarea
              id="gi-desc"
              maxLength={MAX_DESC_LENGTH}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`w-full ${FORM_INPUT} resize-none`}
            />
          </div>
          <div className="flex gap-4">
            <div className="w-40 min-w-0">
              <FormLabel htmlFor="gi-weight">
                Weight
              </FormLabel>
              <WeightInput
                inputId="gi-weight"
                grams={weightGrams}
                onChange={setWeightGrams}
                className="w-full"
                inputClassName={`flex-1 min-w-0 ${FORM_INPUT} tabular-nums`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <FormLabel htmlFor="gi-cat">
                Category
              </FormLabel>
              <select
                id="gi-cat"
                value={categoryId ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__new_category__') {
                    setNewCategoryOpen(true)
                  } else {
                    setCategoryId(e.target.value || null)
                  }
                }}
                className={`w-full ${FORM_INPUT}`}
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {onCreateCategory && <option value="__new_category__">+ New category</option>}
              </select>
              {newCategoryOpen && onCreateCategory && (
                <InlineCreateCategory
                  variant="form"
                  create={onCreateCategory}
                  onCreated={(created) => {
                    setCategoryId(created.id)
                    setNewCategoryOpen(false)
                  }}
                  onCancel={() => setNewCategoryOpen(false)}
                />
              )}
            </div>
          </div>
          {/* Cost + Purchase date. Keep the same two-column mobile rhythm
              as Weight + Category above, but force every grid child/input
              to min-w-0 so native date controls cannot overflow the modal. */}
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <FormLabel htmlFor="gi-cost">
                Cost (USD)
              </FormLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
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
                  className="w-full min-w-0 rounded-lg border border-gray-300 pl-6 pr-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="min-w-0">
              <FormLabel htmlFor="gi-pdate">
                Purchase date
              </FormLabel>
              <input
                id="gi-pdate"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className={`block w-full min-w-0 max-w-full appearance-none ${FORM_INPUT} tabular-nums`}
              />
            </div>
          </div>
          <div>
            <FormLabel htmlFor="gi-status">
              Status
            </FormLabel>
            <select
              id="gi-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as GearStatus)}
              className={`w-full ${FORM_INPUT}`}
            >
              {GEAR_STATUS_MENU_OPTIONS.map((option) => (
                <option key={option.status} value={option.status}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* List-context section — quantity / worn / consumable. Only shown
              when the dialog was opened from a list (listContext provided).
              The gear-library edit path omits listContext, so this section
              doesn't render and the dialog stays as it was. */}
          {listContext && (
            <div className="border-t border-gray-200 pt-4 space-y-3">
              <p className={FLAT_TABLE_EYEBROW}>
                On this list
              </p>
              <div>
                <FormLabel htmlFor="gi-qty">
                  Quantity
                </FormLabel>
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
                    max={MAX_LIST_ITEM_QUANTITY}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(clampQuantity(e.target.value))
                    }
                    className="w-16 h-11 rounded-lg border border-gray-300 px-2 text-center text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(MAX_LIST_ITEM_QUANTITY, q + 1))}
                    disabled={quantity >= MAX_LIST_ITEM_QUANTITY}
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
              {/* Remove from list — list-scoped membership action, sits in
                  the "On this list" section near quantity/worn/consumable
                  rather than buried in the bottom destructive row. Calm-red
                  treatment (not the louder Delete-from-inventory red): it's a
                  removal, but reversible — the gear item stays in inventory. */}
              {onRemoveFromList && (
                <button
                  type="button"
                  onClick={onRemoveFromList}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  <CircleMinus size={14} />
                  Remove from list
                </button>
              )}
            </div>
          )}

          {/* Mobile-only Delete from inventory. The destructive action stays
              at the bottom of the dialog so it can't be tapped by accident
              while editing fields; "Remove from list" moved into the "On
              this list" section above because it's list-scoped, not global.
              On desktop these actions are reached via the row kebab; the
              wrapper is `lg:hidden`. Cancel of the delete confirm restores
              this dialog (see ListDetailPage / GearLibraryPage delete state
              `returnDialog`). */}
          {onDeleteFromInventory && (
            <div className="lg:hidden border-t border-gray-200 pt-4">
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

          {costError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {costError}
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
        </fieldset>

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
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
            <PrimaryButton
              type="submit"
              disabled={saving || !name.trim()}
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}
            </PrimaryButton>
          </div>
        </div>
      </form>
    </Modal>
  )
}
