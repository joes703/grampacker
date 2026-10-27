import { useId } from 'react'
import { useWeightUnit } from '../lib/use-weight-unit'
import type { WeightUnit } from '../lib/weight'

type CommonProps = {
  /** Optional label rendered above the control.
   *  SharePage omits the label since the segmented chrome reads on its own. */
  label?: string
  /** Optional helper paragraph below the control. */
  hint?: string
}

type ViewProps = CommonProps & {
  value: WeightUnit
  onValueChange: (unit: WeightUnit) => void
}

// Presentational half: renders the radio group against whatever value it is
// given. It subscribes to NOTHING.
//
// This is split out from the store-bound default export on purpose. The public
// share view drives its own isolated preference (see SHARE_WEIGHT_UNIT_KEY),
// and a control that unconditionally subscribed to the authenticated store
// would both do useless work on an anonymous page and make it far too easy for
// the public page to write the app-wide key.
//
// We render real radio inputs (sr-only) and label them visually so keyboard
// arrow navigation works for free and the control still feels like a
// segmented control. Touch + click both work because the labels are wired
// via `for=` to the inputs.
export function UnitSegmentedControlView({
  label,
  hint,
  value,
  onValueChange,
}: ViewProps) {
  // useId keeps two instances on one page (toolbar and panel) apart.
  const idPrefix = useId()
  const groupName = `${idPrefix}-units`
  const metricId = `${idPrefix}-metric`
  const imperialId = `${idPrefix}-imperial`
  return (
    <div>
      {label && (
        <div id={`${idPrefix}-label`} className="mb-1 text-sm font-medium text-gray-700">
          {label}
        </div>
      )}
      {/* Inline value selector: a gray track with the chosen unit as a
          white chip. No border and no blue fill - that is the selected-
          button look, and beside the list's view tabs it read as
          navigation. The labels carry the size (40px touch, 28px at lg). */}
      <div
        role="radiogroup"
        aria-labelledby={label ? `${idPrefix}-label` : undefined}
        aria-label={label ? undefined : 'Weight units'}
        className="inline-grid grid-cols-2 rounded-md bg-gray-100 p-0.5"
      >
        <input
          type="radio"
          id={metricId}
          name={groupName}
          checked={value === 'g'}
          onChange={() => onValueChange('g')}
          className="peer/m sr-only"
        />
        <label
          htmlFor={metricId}
          title="Metric"
          className={`inline-flex min-h-10 min-w-9 cursor-pointer items-center justify-center rounded px-2 text-xs font-medium transition-colors lg:min-h-7 ${
            value === 'g'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          } peer-focus-visible/m:ring-2 peer-focus-visible/m:ring-blue-300`}
        >
          g
        </label>
        <input
          type="radio"
          id={imperialId}
          name={groupName}
          checked={value === 'oz'}
          onChange={() => onValueChange('oz')}
          className="peer/i sr-only"
        />
        <label
          htmlFor={imperialId}
          title="Imperial"
          className={`inline-flex min-h-10 min-w-9 cursor-pointer items-center justify-center rounded px-2 text-xs font-medium transition-colors lg:min-h-7 ${
            value === 'oz'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          } peer-focus-visible/i:ring-2 peer-focus-visible/i:ring-blue-300`}
        >
          oz
        </label>
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

// Store-bound half, for AUTHENTICATED surfaces only (list detail, gear).
// Writes through to the shared useWeightUnit store, so changing the unit here
// propagates to lists and gear inventory immediately.
//
// Do NOT render this on the public share view - that is precisely the bug this
// split exists to prevent. Use UnitSegmentedControlView with the share-scoped
// preference instead.
export default function UnitSegmentedControl(props: CommonProps) {
  const { weightUnit, setUnit } = useWeightUnit()
  return <UnitSegmentedControlView {...props} value={weightUnit} onValueChange={setUnit} />
}
