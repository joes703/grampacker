import { Check } from 'lucide-react'
import { GEAR_STATUS_MENU_OPTIONS, type GearStatus } from '../../lib/gear-status'
import { ROW_MENU_ITEM_BASE } from '../RowMenuItem'

type Props = {
  current: GearStatus
  onSelect: (status: GearStatus) => void
}

// Status menu rows for use inside an existing row kebab/popover. Each row
// shows the status's own icon on the left and a trailing checkmark on the
// currently-selected status.
// Clicking the currently-selected row is a no-op (avoids a wasted PATCH);
// hosts are still expected to close the menu themselves on selection.
//
// Style shares the row-menu base. Width fills the parent so the menu chooses
// its own column width.
export default function GearStatusMenuItems({ current, onSelect }: Props) {
  return (
    <>
      {GEAR_STATUS_MENU_OPTIONS.map((opt) => {
        const Icon = opt.icon
        const isCurrent = opt.status === current
        return (
          <button
            key={opt.status}
            type="button"
            role="menuitemradio"
            aria-checked={isCurrent}
            onClick={() => {
              if (!isCurrent) onSelect(opt.status)
            }}
            className={`${ROW_MENU_ITEM_BASE} ${
              isCurrent ? 'text-gray-900 font-medium' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Icon size={13} aria-hidden />
            <span className="flex-1 truncate">{opt.label}</span>
            {isCurrent && <Check size={13} className="text-blue-600" aria-hidden />}
          </button>
        )
      })}
    </>
  )
}
