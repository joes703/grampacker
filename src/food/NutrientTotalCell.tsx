import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import { FLAT_TABLE_NUMERIC_TEXT, POPOVER_SURFACE } from '../components/flat-table-styles'
import { formatTotalWeight, type WeightUnit } from '../lib/weight'
import { MISSING_FOOD_LABEL, type NutrientTotal, type WeightTotal } from '../lib/food/nutrition'

export type NutrientCellKind = 'calories' | 'grams' | 'mg'

function formatValue(value: number, kind: NutrientCellKind): string {
  switch (kind) {
    case 'calories': return `${Math.round(value)} kcal`
    case 'grams': return `${value.toFixed(1)} g`
    case 'mg': return `${Math.round(value)} mg`
  }
}

export default function NutrientTotalCell({
  total, kind, nameForId,
}: {
  total: NutrientTotal
  kind: NutrientCellKind
  nameForId?: (foodId: string) => string
}) {
  if (total.state === 'complete') {
    return <span className={`${FLAT_TABLE_NUMERIC_TEXT} text-gray-900`}>{formatValue(total.value, kind)}</span>
  }
  return <IncompleteMarker missingFoodIds={total.missingFoodIds} nameForId={nameForId} />
}

// Keyboard- and touch-accessible disclosure: a focusable button (accessible
// name lists count + foods for AT) that, on click/tap, opens a dismissible
// portal popover listing the affected foods. Reused for both missing nutrients
// and missing food definitions, so the wording is configurable via `reason`.
// Split into its own component so the useAnchoredMenu hook is never called
// conditionally (rules of hooks).
export function IncompleteMarker({
  missingFoodIds, nameForId, reason = 'missing this nutrient',
}: {
  missingFoodIds: string[]
  nameForId?: (foodId: string) => string
  reason?: string
}) {
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 224 })
  const names = missingFoodIds.map((id) => nameForId?.(id) ?? MISSING_FOOD_LABEL)
  const n = missingFoodIds.length
  const label = `${n} food${n === 1 ? '' : 's'} ${reason}`
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); if (open) close(); else openMenu() }}
        aria-expanded={open}
        aria-label={`${label}: ${names.join(', ')}`}
        className="inline-flex items-center gap-1 rounded text-amber-600 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <AlertTriangle size={13} aria-hidden="true" />
        <span className="tabular-nums text-xs">{n}</span>
      </button>
      {open && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="tooltip"
          className={`fixed z-50 w-56 p-2 text-xs ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <p className="mb-1 font-medium text-gray-700">{label}</p>
          <ul className="space-y-0.5 text-gray-600">
            {names.map((nm, i) => <li key={`${nm}-${i}`}>{nm}</li>)}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}

// Aggregate weight cell. Complete -> nearest-gram display (full precision is
// preserved upstream in the math). Incomplete (a food definition is missing) ->
// the same tap disclosure with weight-appropriate wording, never a bare dash
// that would read as a true low number.
export function WeightCell({
  weight, weightUnit, nameForId,
}: {
  weight: WeightTotal
  weightUnit: WeightUnit
  nameForId?: (foodId: string) => string
}) {
  if (weight.state === 'complete') {
    return <span className={FLAT_TABLE_NUMERIC_TEXT}>{formatTotalWeight(Math.round(weight.grams), weightUnit)}</span>
  }
  return <IncompleteMarker missingFoodIds={weight.missingFoodIds} nameForId={nameForId} reason="with a missing definition" />
}
