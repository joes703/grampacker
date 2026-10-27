import { useState } from 'react'
import { MAX_ITEM_WEIGHT_GRAMS, MAX_NAME_LENGTH, MAX_DESC_LENGTH } from '../lib/caps'
import { clampQuantity } from '../../shared/lists'

// Shared state machine for the List Detail "Quick Add" flow. Both the
// desktop inline AddItemRow and the mobile QuickAddItemModal consume this
// hook so the two presentations cannot drift on field set, validation, or
// the shape of the submitted payload. The DOM differs between the two; the
// state, the worn/consumable mutual-exclusion rule, and the parse/clamp
// logic in buildData() do not.
//
// Quick Add intentionally collects only the fields needed to put a new
// item on this list. Full inventory details like cost and purchase date
// live in GearItemDialog.

export type AddItemData = {
  name: string
  description: string | null
  weightGrams: number
  quantity: number
  isWorn: boolean
  isConsumable: boolean
}

export function useQuickAddForm() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [weightGrams, setWeightGrams] = useState(0)
  // Held as a string so the field can be cleared/retyped without React
  // fighting the cursor; parsed to a clamped integer in buildData().
  const [quantity, setQuantity] = useState('1')
  const [worn, setWorn] = useState(false)
  const [consumable, setConsumable] = useState(false)

  // Worn/consumable XOR: ticking one unticks the other. Reflects the DB
  // CHECK constraint (worn_xor_consumable) and matches GearItemDialog.
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

  const canSubmit = name.trim() !== ''

  // Returns the validated, clamped payload, or null when the name is
  // blank. Callers decide what to do with null (inline row cancels;
  // modal's submit is a no-op because the Save button is disabled).
  function buildData(): AddItemData | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    const w = Math.max(0, Math.min(weightGrams, MAX_ITEM_WEIGHT_GRAMS))
    const q = clampQuantity(quantity)
    const d = description.trim()
    return {
      name: trimmed.slice(0, MAX_NAME_LENGTH),
      description: d ? d.slice(0, MAX_DESC_LENGTH) : null,
      weightGrams: w,
      quantity: q,
      isWorn: worn,
      isConsumable: consumable,
    }
  }

  return {
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
    canSubmit,
    buildData,
  }
}
