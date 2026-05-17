import { useWeightUnit } from '../lib/use-weight-unit'

// Display-preference control. Lives in the NavBar's right cluster on
// every route that wants to expose the global g/oz toggle (currently
// /lists/:id and /gear). Identical chrome on every viewport — the
// label is short enough to fit at 375px without crowding.
export default function WeightUnitToggle() {
  const { weightUnit, toggleWeightUnit } = useWeightUnit()
  return (
    <button
      onClick={toggleWeightUnit}
      title={`Switch to ${weightUnit === 'g' ? 'oz' : 'g'}`}
      aria-label={`Toggle weight unit (currently ${weightUnit})`}
      className="rounded-lg border border-gray-300 px-2 sm:px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
    >
      {weightUnit}
    </button>
  )
}
