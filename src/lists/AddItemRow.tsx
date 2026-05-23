import { Shirt, UtensilsCrossed, XCircle } from 'lucide-react'
import RowIconButton from '../components/RowIconButton'
import WeightInput from '../components/WeightInput'
import {
  DESKTOP_ROW_HEIGHT,
  FLAT_TABLE_BODY_TEXT,
  MOBILE_ROW_HEIGHT,
} from '../components/flat-table-styles'
import { useQuickAddForm, type AddItemData } from './use-quick-add-form'

type Props = {
  onSubmit: (data: AddItemData) => void
  onCancel: () => void
}

// Desktop inline presentation of the List Detail "Quick Add" flow. Mirrors
// the regular ListItemRow column geometry; full-row blur commits when name
// is non-empty, cancels when blank. The form state, validation, and submit
// payload all come from useQuickAddForm, which the mobile QuickAddItemModal
// shares so the two presentations can't drift.
export default function AddItemRow({ onSubmit, onCancel }: Props) {
  const {
    name,
    setName,
    description,
    setDescription,
    weightGrams,
    setWeightGrams,
    quantity,
    setQuantity,
    worn,
    toggleWorn,
    consumable,
    toggleConsumable,
    buildData,
  } = useQuickAddForm()

  function commit() {
    const data = buildData()
    if (!data) return
    onSubmit(data)
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
      // Draft input row aligns with the surrounding item rows via the shared
      // density tokens (height tracks the desktop tightening automatically).
      // Horizontal padding stays px-3 inline because this is a desktop-only
      // edit affordance and the row has several inputs that prefer the
      // canonical inset over the px-2 mobile ramp.
      className={`flex ${MOBILE_ROW_HEIGHT} ${DESKTOP_ROW_HEIGHT} items-center gap-1.5 border-b border-gray-100 bg-blue-50/40 px-3 py-0 ${FLAT_TABLE_BODY_TEXT}`}
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
            className={`w-full rounded border border-blue-400 px-1 py-0.5 ${FLAT_TABLE_BODY_TEXT} font-normal focus:outline-none`}
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
            className={`w-full rounded border border-gray-200 px-1 py-0.5 ${FLAT_TABLE_BODY_TEXT} font-normal focus:outline-none focus:border-blue-400`}
          />
        </label>
      </div>

      <RowIconButton
        variant="purpleToggle"
        active={worn}
        alwaysVisible
        onClick={toggleWorn}
        title="Worn"
        ariaLabel="Worn"
        icon={<Shirt size={14} />}
      />
      <RowIconButton
        variant="orangeToggle"
        active={consumable}
        alwaysVisible
        onClick={toggleConsumable}
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
