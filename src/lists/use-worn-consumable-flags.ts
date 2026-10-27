import { useState } from 'react'

// The worn and consumable checkboxes of a list item. Ticking one unticks the
// other: the database forbids both (the worn_xor_consumable CHECK).
export function useWornConsumableFlags(initial: { isWorn: boolean; isConsumable: boolean }) {
  const [worn, setWorn] = useState(initial.isWorn)
  const [consumable, setConsumable] = useState(initial.isConsumable)

  function toggleWorn() {
    setWorn(!worn)
    if (!worn) setConsumable(false)
  }
  function toggleConsumable() {
    setConsumable(!consumable)
    if (!consumable) setWorn(false)
  }

  return { worn, consumable, toggleWorn, toggleConsumable }
}
