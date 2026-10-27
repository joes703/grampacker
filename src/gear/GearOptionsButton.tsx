import { Settings2 } from 'lucide-react'
import KebabMenu, { type KebabTriggerProps } from '../components/KebabMenu'
import GearOptionsContent, { type GearOptionsHandlers } from './GearOptionsContent'
import { TOOLBAR_BUTTON } from '../components/flat-table-styles'

type Props = {
  gearOptions: GearOptionsHandlers
  /** False until BOTH gear items and categories have resolved. Disables the
   *  trigger outright: every row in the panel either builds a write from the
   *  library snapshot or has nothing to act on without it. Mirrors
   *  MobileGearActionBar's Options slot. */
  libraryReady: boolean
}

// The labeled toolbar trigger. Hoisted because KebabMenu's `trigger` must be
// a stable component; `disabled` arrives through the trigger contract
// (KebabMenu forwards its own disabled prop).
function OptionsTrigger({ ref, onClick, open, disabled }: KebabTriggerProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Gear options"
      aria-label="Gear options"
      aria-expanded={open}
      className={`inline-flex items-center gap-1.5 ${TOOLBAR_BUTTON}`}
    >
      <Settings2 size={14} />
      Options
    </button>
  )
}

// Desktop popover trigger for Gear page rare/utility actions (New category,
// Import/Export CSV, Collapse all, Expand all). Hidden at <md because
// MobileGearActionBar owns the equivalent surface there. The panel goes
// through the shared KebabMenu shell, which also gives it the viewport
// flip/clamp the old hand-anchored version lacked.
export default function GearOptionsButton({ libraryReady, gearOptions }: Props) {
  return (
    <KebabMenu
      width={64}
      contentClassName="p-2"
      ariaLabel="Gear options"
      menuLabel="Gear options"
      disabled={!libraryReady}
      trigger={OptionsTrigger}
    >
      {({ close }) => <GearOptionsContent {...gearOptions} onAction={close} />}
    </KebabMenu>
  )
}
