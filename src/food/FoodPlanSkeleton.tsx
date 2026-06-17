import { FLAT_TABLE_HEADER, FLAT_TABLE_SURFACE } from '../components/flat-table-styles'

// Loading placeholder for the food-plan surface, shared by FoodPlanPage (the
// plan fetch) and FoodPlanDocument (the follow-on food-library fetch) so both
// load phases look the same instead of flashing plain text. It mirrors the
// loaded shape - a toolbar row above a couple of day-section blocks. Purely
// decorative: screen readers get the sr-only label plus aria-busy, not the bars.
export default function FoodPlanSkeleton() {
  return (
    <div data-testid="food-plan-loading" aria-busy="true" className="mt-6 space-y-4">
      <span className="sr-only">Loading food plan</span>
      <div aria-hidden="true" className="flex items-center justify-between gap-2">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
        <div className="h-6 w-24 animate-pulse rounded bg-gray-200" />
      </div>
      {[0, 1].map((section) => (
        <div key={section} aria-hidden="true" className={FLAT_TABLE_SURFACE}>
          <div className={`${FLAT_TABLE_HEADER} justify-between gap-2 px-3`}>
            <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
          </div>
          <div className="divide-y divide-gray-100">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 px-3 py-3">
                <div className="h-4 flex-1 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-12 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
