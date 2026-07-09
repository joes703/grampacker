import { Backpack } from 'lucide-react'
import { TABLE_BORDER, TABLE_RADIUS, TABLE_SURFACE_BG } from '../components/flat-table-styles'

type Props = {
  /** Mobile-only Add affordance. Opens the gear-picker drawer. The same
   *  effect is reachable from the mobile bottom bar's Add button. */
  onMobileAdd: () => void
}

// Empty-list cell. Desktop describes the always-mounted gear picker
// aside as the affordance (no inline button — the picker IS the action).
// Mobile points at the bottom-bar Add button using matching wording; the
// inline button is a `<lg`-only convenience that calls the same drawer
// opener as the bottom bar.
export default function EmptyListCell({ onMobileAdd }: Props) {
  return (
    <div className={`${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} p-6 print:hidden`}>
      <div className="flex items-start gap-3">
        <Backpack size={20} className="mt-0.5 shrink-0 text-blue-600" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900">Add gear to this list</h2>
          <p className="mt-1 hidden lg:block text-sm text-gray-500">
            Use the gear picker on the left to pull items from your gear.
          </p>
          <p className="mt-1 lg:hidden text-sm text-gray-500">
            Tap{' '}
            <button
              type="button"
              onClick={onMobileAdd}
              className="font-medium text-blue-600 underline-offset-2 hover:underline"
            >
              Add
            </button>
            {' '}to pull items from your gear.
          </p>
        </div>
      </div>
    </div>
  )
}
