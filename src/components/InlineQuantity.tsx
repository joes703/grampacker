import { useEffect, useRef, useState } from 'react'
import { useCommitOnce } from '../lib/use-commit-once'
import { FLAT_TABLE_QUANTITY_TEXT, INLINE_EDIT_FOCUS_RING } from './flat-table-styles'

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
  /** Width and text color from the row - call sites genuinely differ, the same
   *  reasoning as InlineWeight's className. */
  className?: string
}

export default function InlineQuantity({
  quantity,
  max,
  onSave,
  itemName,
  className = '',
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

  if (onSave && editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={1}
        max={max}
        value={draft}
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
        className={`shrink-0 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums ${INLINE_EDIT_FOCUS_RING} ${className}`}
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
        className={`shrink-0 text-right ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600 hover:text-blue-600 ${className}`}
      >
        {quantity}
      </button>
    )
  }

  return (
    <span className={`shrink-0 text-right ${FLAT_TABLE_QUANTITY_TEXT} text-gray-600 ${className}`}>
      {quantity}
    </span>
  )
}
