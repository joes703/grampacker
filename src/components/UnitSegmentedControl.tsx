import { useWeightUnit } from '../lib/use-weight-unit'

type Props = {
  /** Visual ID prefix for the two radio inputs so multiple instances on the
   *  same page (Settings vs SharePage's header) get distinct ids. Defaults
   *  to "wuc" if not provided. */
  idPrefix?: string
  /** Optional label rendered above the control (Settings uses this).
   *  SharePage omits the label since the segmented chrome reads on its own. */
  label?: string
  /** Optional helper paragraph below the control. */
  hint?: string
}

// Metric/Imperial segmented control bound to the global weight unit
// preference. Writes through to the same useWeightUnit store every other
// consumer in the app reads, so changing the unit here propagates to lists,
// gear inventory, and the public share view immediately.
//
// We render real radio inputs (sr-only) and label them visually so keyboard
// arrow navigation works for free and the control still feels like a
// segmented control. Touch + click both work because the labels are wired
// via `for=` to the inputs.
export default function UnitSegmentedControl({ idPrefix = 'wuc', label, hint }: Props) {
  const { weightUnit, setUnit } = useWeightUnit()
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
      {/* Compact inline value selector. Smaller radius (rounded-md /
          rounded-sm) and tighter padding than PillToggle so it reads
          as a value picker, not another big toggle. Selected segment
          stays bg-blue-600 / white for clear active state. */}
      <div
        role="radiogroup"
        aria-labelledby={label ? `${idPrefix}-label` : undefined}
        aria-label={label ? undefined : 'Weight units'}
        className="inline-flex rounded-md border border-gray-300 bg-white p-0.5"
      >
        <input
          type="radio"
          id={metricId}
          name={groupName}
          checked={weightUnit === 'g'}
          onChange={() => setUnit('g')}
          className="peer/m sr-only"
        />
        <label
          htmlFor={metricId}
          title="Metric"
          className={`cursor-pointer rounded-sm px-2 py-0.5 text-xs font-semibold transition-colors ${
            weightUnit === 'g'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 hover:bg-gray-50'
          } peer-focus-visible/m:ring-2 peer-focus-visible/m:ring-blue-300`}
        >
          g
        </label>
        <input
          type="radio"
          id={imperialId}
          name={groupName}
          checked={weightUnit === 'oz'}
          onChange={() => setUnit('oz')}
          className="peer/i sr-only"
        />
        <label
          htmlFor={imperialId}
          title="Imperial"
          className={`cursor-pointer rounded-sm px-2 py-0.5 text-xs font-semibold transition-colors ${
            weightUnit === 'oz'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 hover:bg-gray-50'
          } peer-focus-visible/i:ring-2 peer-focus-visible/i:ring-blue-300`}
        >
          oz
        </label>
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
