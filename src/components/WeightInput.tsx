import { useEffect, useRef, useState, type Ref } from 'react'
import { gramsToOz, ozToGrams, getWeightUnit, type WeightUnit } from '../lib/weight'
import { MAX_ITEM_WEIGHT_GRAMS } from '../lib/queries/caps'

// Number input + g/oz unit toggle. Storage is always integer grams; the
// component converts at the input boundary. The initial unit follows the
// user's display preference (lib/weight.getWeightUnit). Toggling the unit
// while typing converts the displayed value but keeps the underlying grams
// unchanged.
//
// Controlled API: `grams` is the source of truth held by the parent;
// `onChange(grams)` fires on every keystroke and on unit toggle (when the
// rounded grams value differs after conversion). External `grams` changes
// reset the visible draft (useful for parent-side resets after save).
//
// Layout: flex with the <input> as the main child and a small unit-toggle
// button beside it. Heights match via items-stretch so the toggle scales
// with the input. Parents control overall width via `className`. Typical
// sizings:
//   - Inline rows  : `className="shrink-0 w-24"` (input ~64 px, toggle ~30 px)
//   - Dialog field : `className="w-full"` inside a w-32 / w-40 wrapper
type Props = {
  grams: number
  onChange: (grams: number) => void
  className?: string
  inputClassName?: string
  inputRef?: Ref<HTMLInputElement>
  inputId?: string
  /** Accessible name for the number input (used when there's no associated
   *  <label>, e.g. inline edit rows). The unit-toggle button has its own. */
  ariaLabel?: string
  /** Fires when focus leaves the entire WeightInput (input AND toggle). */
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

function formatDraft(grams: number, unit: WeightUnit): string {
  if (unit === 'g') return String(grams)
  return gramsToOz(grams).toFixed(1)
}

function unitName(unit: WeightUnit): string {
  return unit === 'g' ? 'grams' : 'ounces'
}

export default function WeightInput({
  grams,
  onChange,
  className = '',
  inputClassName = '',
  inputRef,
  inputId,
  ariaLabel,
  onBlur,
  onKeyDown,
}: Props) {
  const [unit, setUnit] = useState<WeightUnit>(getWeightUnit)
  const [draft, setDraft] = useState(() => formatDraft(grams, unit))
  // Track the last grams value we emitted so external prop changes (e.g.
  // parent-side reset after save) reset the draft, but our own emits don't
  // bounce back and clobber an in-progress draft.
  const lastEmitted = useRef(grams)

  useEffect(() => {
    if (grams !== lastEmitted.current) {
      setDraft(formatDraft(grams, unit))
      lastEmitted.current = grams
    }
  }, [grams, unit])

  function emitFromDraft(d: string, u: WeightUnit) {
    const parsed = parseFloat(d)
    if (isNaN(parsed) || parsed < 0) {
      lastEmitted.current = 0
      onChange(0)
      return
    }
    const g = u === 'g' ? Math.round(parsed) : Math.round(ozToGrams(parsed))
    const clamped = Math.min(g, MAX_ITEM_WEIGHT_GRAMS)
    lastEmitted.current = clamped
    onChange(clamped)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setDraft(next)
    emitFromDraft(next, unit)
  }

  function toggleUnit() {
    const nextUnit: WeightUnit = unit === 'g' ? 'oz' : 'g'
    setDraft(formatDraft(lastEmitted.current, nextUnit))
    setUnit(nextUnit)
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Don't fire onBlur when focus moves between input and toggle (still
    // within this WeightInput). Only fire when focus truly leaves.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    onBlur?.()
  }

  const nextUnit: WeightUnit = unit === 'g' ? 'oz' : 'g'

  return (
    <div className={`flex items-stretch gap-1 ${className}`} onBlur={handleBlur}>
      <input
        id={inputId}
        ref={inputRef}
        type="number"
        inputMode="decimal"
        min={0}
        step={unit === 'g' ? 1 : 0.1}
        value={draft}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        className={inputClassName}
      />
      <button
        type="button"
        // Don't steal focus from the input when the toggle is clicked — keeps
        // the input focused so the user can keep typing after switching units.
        // Keyboard users can still tab to the toggle and press Space/Enter.
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleUnit}
        title={`Entering ${unitName(unit)}. Switch to ${unitName(nextUnit)}.`}
        aria-label={`Entering ${unitName(unit)}, switch to ${unitName(nextUnit)}`}
        className="shrink-0 inline-flex min-w-11 items-center justify-center rounded border border-blue-200 bg-blue-50 px-2 text-xs font-semibold tabular-nums text-blue-800 hover:border-blue-300 hover:bg-blue-100"
      >
        {unit}
      </button>
    </div>
  )
}
