import { useEffect, useRef, useState } from 'react'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { useCommitOnce } from '../lib/use-commit-once'
import { FLAT_TABLE_NUMERIC_TEXT, INLINE_EDIT_FOCUS_RING } from './flat-table-styles'
import ItemWeightValue from './ItemWeightValue'
import WeightInput from './WeightInput'
import { clampWeightGrams } from '../../shared/gear'

// Click-to-edit weight, the one inline control shared by every surface that
// shows a weight: the Category row, the Pack row, and the gear library row.
//
// It exists because those three had drifted apart - the list row could edit a
// weight in place, the gear library could not, and the Pack row showed no
// weight at all. Three copies of the same state machine (draft, prop-sync,
// focus, clamp, commit-once) is how that drift happened, so there is one.
//
// Read-only when `onSave` is absent - that is the public share view's case,
// where a weight is a fact and not a control.
type Props = {
  grams: number
  unit: WeightUnit
  /** Absent means read-only. */
  onSave?: (grams: number) => void
  /** Names the row in the control's accessible name ("Edit weight 1.2 kg for
   *  Backpack"), so a screen reader hears which weight it is about to edit. */
  itemName: string
  /** Width, visibility and TEXT COLOR utilities from the row. Color is not
   *  baked in because the call sites genuinely differ - the Pack row's weight
   *  is gray-500 against its checklist, the others gray-600 - and two color
   *  classes on one element would leave Tailwind's ordering to decide. */
  className?: string
  /** Applied to the WeightInput wrapper while editing. Defaults to
   *  `className` when omitted; the Pack row needs a different display
   *  utility (flex, not inline-block) for the input than for the button. */
  editingClassName?: string
}

export default function InlineWeight({
  grams,
  unit,
  onSave,
  itemName,
  className = '',
  editingClassName,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draftGrams, setDraftGrams] = useState(grams)
  // Sync the draft to external prop changes via the React-docs
  // "store-previous-prop" pattern, so optimistic updates and cross-tab edits
  // land without remounting the row mid-edit and without the cascading-render
  // pitfall react-hooks/set-state-in-effect flags.
  const [prevGrams, setPrevGrams] = useState(grams)
  if (grams !== prevGrams) {
    setPrevGrams(grams)
    setDraftGrams(grams)
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const commitOnce = useCommitOnce()

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    const clamped = clampWeightGrams(draftGrams)
    if (clamped !== grams && onSave) onSave(clamped)
    setEditing(false)
  }

  function cancel() {
    setDraftGrams(grams)
    setEditing(false)
  }

  if (onSave && editing) {
    return (
      <WeightInput
        inputRef={inputRef}
        grams={draftGrams}
        onChange={setDraftGrams}
        ariaLabel={`Weight for ${itemName}`}
        onBlur={() => commitOnce(commit)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitOnce(commit)
          if (e.key === 'Escape') commitOnce(cancel)
        }}
        className={editingClassName ?? className}
        inputClassName={`flex-1 min-w-0 rounded border border-blue-400 px-1 py-0.5 text-right tabular-nums ${INLINE_EDIT_FOCUS_RING}`}
      />
    )
  }

  if (onSave) {
    return (
      <button
        onClick={() => setEditing(true)}
        title="Edit weight"
        aria-label={`Edit weight ${formatItemWeight(grams, unit)} for ${itemName}`}
        className={`text-right ${FLAT_TABLE_NUMERIC_TEXT} hover:text-blue-600 ${className}`}
      >
        <ItemWeightValue grams={grams} unit={unit} />
      </button>
    )
  }

  return (
    <span className={`text-right ${FLAT_TABLE_NUMERIC_TEXT} ${className}`}>
      <ItemWeightValue grams={grams} unit={unit} />
    </span>
  )
}
