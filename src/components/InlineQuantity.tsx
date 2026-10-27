import { useEffect, useRef, useState } from 'react'
import { useCommitOnce } from '../lib/use-commit-once'
import {
  DESKTOP_ROW_CONTROL_MIN_TARGET,
  FLAT_TABLE_QUANTITY_TEXT,
  INLINE_EDIT_FOCUS_RING,
  MOBILE_ROW_CONTROL_MIN_TARGET,
} from './flat-table-styles'
import { clampQuantity } from '../../shared/lists'

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
  /** Applied to the input instead of `className` while editing. Use ONLY when
   *  the two states genuinely want different widths - if the control sits in
   *  running text, they must not, or committing visibly shrinks it and reflows
   *  the line. In a numeric COLUMN the width is fixed by the column anyway. */
  editingClassName?: string
  /** 'end' for a numeric column, where digits line up on the right. 'start'
   *  for a control sitting at the head of a line of text, where the number
   *  must sit flush against the words that follow it. 'center' for a
   *  control floating between words. A prop rather than a className
   *  override: two justify- classes on one element leave the outcome to
   *  Tailwind's ordering, which is not something to leave to chance. */
  align?: 'end' | 'center' | 'start'
}

export default function InlineQuantity({
  quantity,
  max,
  onSave,
  itemName,
  className = '',
  editingClassName,
  align = 'end',
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
    // Clamp rather than reject: the server's range check is the real gate, and
    // an out-of-range draft should not be able to strand the row in edit mode.
    const clamped = clampQuantity(draft, max)
    if (clamped !== quantity && onSave) onSave(clamped)
    setEditing(false)
  }

  // The control target, per docs/ui-density.md: 40px on touch, 28x24 on
  // pointer. Owned by the control rather than left to each caller - this is
  // the ONLY way to correct a food count, and a text-height 24px tap target on
  // a phone is how someone gives up and packs the wrong weight.
  const target = `${MOBILE_ROW_CONTROL_MIN_TARGET} ${DESKTOP_ROW_CONTROL_MIN_TARGET}`
  const justify =
    align === 'center' ? 'justify-center' : align === 'start' ? 'justify-start' : 'justify-end'
  const textAlign =
    align === 'center' ? 'text-center' : align === 'start' ? 'text-left' : 'text-right'

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
        className={`shrink-0 rounded border border-blue-400 px-1 py-0.5 tabular-nums ${textAlign} ${target} ${INLINE_EDIT_FOCUS_RING} ${editingClassName ?? className}`}
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
        className={`shrink-0 inline-flex items-center ${justify} ${target} ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600 hover:text-blue-600 ${className}`}
      >
        {quantity}
      </button>
    )
  }

  // The read-only span carries the SAME target as the button. Not because a
  // span can be tapped, but because the food row swaps to it while a write is
  // in flight: sized to its text instead, the row would visibly shrink and
  // shift every time you committed a quantity, which reads as a glitch on the
  // control you just used.
  return (
    <span
      className={`shrink-0 inline-flex items-center ${justify} ${target} ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600 ${className}`}
    >
      {quantity}
    </span>
  )
}
