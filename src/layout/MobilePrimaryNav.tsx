import { Plus, Settings2 } from 'lucide-react'
import { useLocation } from 'react-router'
import MobileBottomBar from '../components/MobileBottomBar'
import { useIsMobilePrimaryNavSuppressed } from './mobile-primary-nav-context'
import { buildMobileDestinationItems } from './mobile-nav-destinations'

// Always-on mobile primary nav (Gear, Lists, Add, Options). Pages with
// their own page-specific bar (List Detail, Gear, Lists) call
// useSuppressMobilePrimaryNav() to register themselves with
// MobilePrimaryNavProvider so this fallback steps aside. Suppression is
// keyed to runtime registration rather than pathname, so terminal states
// that skip mounting the rich bar (list not found, future loading/error
// branches) still get this fallback instead of leaving the user with no
// way out.
//
// On routes where no per-page bar mounts (Settings, Help, Profile), the
// Add and Options slots have no contextual action, so they render as
// real disabled buttons — the `disabled` attribute is what blocks
// activation; `aria-disabled` is mostly for non-button elements but
// included for clarity. Empty handlers keep the union type satisfied
// without firing anything.
export default function MobilePrimaryNav() {
  const { pathname } = useLocation()
  const suppressed = useIsMobilePrimaryNavSuppressed()

  if (suppressed) return null

  return (
    <MobileBottomBar
      label="Primary navigation"
      items={[
        ...buildMobileDestinationItems(pathname),
        {
          type: 'button',
          label: 'Add',
          icon: <Plus size={18} />,
          onClick: () => {},
          disabled: true,
          ariaLabel: 'Add (no action on this page)',
        },
        {
          type: 'button',
          label: 'Options',
          icon: <Settings2 size={18} />,
          onClick: () => {},
          disabled: true,
          ariaLabel: 'Options (no action on this page)',
        },
      ]}
    />
  )
}
