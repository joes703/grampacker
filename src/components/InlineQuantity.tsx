import { useEffect, useRef, useState } from 'react'
import { useCommitOnce } from '../lib/use-commit-once'
import {
  DESKTOP_ROW_CONTROL_MIN_TARGET,
  FLAT_TABLE_QUANTITY_TEXT,
  INLINE_EDIT_FOCUS_RING,
  MOBILE_ROW_CONTROL_MIN_TARGET,
} from './flat-table-styles'

// Click-to-edit quantity, the sibling of InlineWeight and extracted for the
// same reason: a second surface now needs it.
//
// It used to live inline in ItemRow, whose comment said quantity "is
// list-membership data, not gear data, and has no second home". That reason
// expired when food items got a quantity you can change - so rather than let a
// second copy of the draft/prop-sync/clamp/commit-once state machine grow
// (which is exactly how the three weight controls drifted apart), there is one
// control and both rows use it.
//
// Read-only when `onSave` is absent, matching InlineWeight.
type Props = {
  quantity: number
  /** Upper clamp. Gear and food have different server-side ceilings. */
  max: number
  /** Absent means read-only. */
  onSave?: (quantity: number) => void
  /** Names the row in the accessible name ("Edit quantity 5 for Tortilla"). */
  itemName: string
  /** EXTRA width and text color from the row - call sites genuinely differ,
   *  the same reasoning as InlineWeight's className. The touch/pointer target
   *  is owned here and is not a caller's to opt out of. */
  className?: string
  /** Applied to the input instead of `className` while editing. A number
   *  input needs room for four digits plus the native steppers, which is more
   *  than the resting label needs - the same split InlineWeight makes. */
  editingClassName?: string
}

export default function InlineQuantity({
  quantity,
  max,
  onSave,
  itemName,
  className = '',
  editingClassName,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(quantity))
  // Store-previous-prop rather than an effect, matching InlineText: setState
  // during render, so the input never shows a stale draft after a refetch.
  const [prev, setPrev] = useState(quantity)
  if (quantity !== prev) {
    setPrev(quantity)
    setDraft(String(quantity))
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const commitOnce = useCommitOnce()

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    const parsed = parseInt(draft, 10)
    // Clamp rather than reject: the server's range check is the real gate, and
    // an out-of-range draft should not be able to strand the row in edit mode.
    const clamped = isNaN(parsed) || parsed < 1 ? 1 : Math.min(parsed, max)
    if (clamped !== quantity && onSave) onSave(clamped)
    setEditing(false)
  }

  // The control target, per docs/ui-density.md: 40px on touch, 28x24 on
  // pointer. Owned by the control rather than left to each caller - this is
  // the ONLY way to correct a food count, and a text-height 24px tap target on
  // a phone is how someone gives up and packs the wrong weight.
  const target = `${MOBILE_ROW_CONTROL_MIN_TARGET} ${DESKTOP_ROW_CONTROL_MIN_TARGET}`

  if (onSave && editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={1}
        max={max}
        value={draft}
        // The trigger's accessible name does not survive into edit mode, so
        // the spinbutton names itself. Without this a screen reader lands on
        // an unlabeled number field.
        aria-label={`Quantity for ${itemName}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commitOnce(commit)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitOnce(commit)
          if (e.key === 'Escape') {
            commitOnce(() => {
              setDraft(String(quantity))
              setEditing(false)
            })
          }
        }}
        className={`shrink-0 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums ${target} ${INLINE_EDIT_FOCUS_RING} ${editingClassName ?? className}`}
      />
    )
  }

  if (onSave) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Edit quantity"
        aria-label={`Edit quantity ${quantity} for ${itemName}`}
        className={`shrink-0 inline-flex items-center justify-end ${target} ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600 hover:text-blue-600 ${className}`}
      >
        {quantity}
      </button>
    )
  }

  return (
    <span className={`shrink-0 inline-flex items-center justify-end ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600 ${className}`}>
      {quantity}
    </span>
  )
}
