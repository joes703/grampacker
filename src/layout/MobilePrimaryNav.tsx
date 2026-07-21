import { useLocation } from 'react-router'
import MobileBottomBar from '../components/MobileBottomBar'
import { useIsMobilePrimaryNavSuppressed } from './mobile-primary-nav-context'
import { buildMobileDestinationItems } from './mobile-nav-destinations'

// Always-on mobile primary nav (Gear, Lists, Food). Pages with
// their own page-specific bar (List Detail, Gear, Lists) call
// useSuppressMobilePrimaryNav() to register themselves with
// MobilePrimaryNavProvider so this fallback steps aside. Suppression is
// keyed to runtime registration rather than pathname, so terminal states
// that skip mounting the rich bar (list not found, future loading/error
// branches) still get this fallback instead of leaving the user with no
// way out.
//
// Routes without contextual actions show destinations only. Empty future
// slots are not user-facing controls.
export default function MobilePrimaryNav() {
  const { pathname } = useLocation()
  const suppressed = useIsMobilePrimaryNavSuppressed()

  if (suppressed) return null

  return (
    <MobileBottomBar
      label="Primary navigation"
      items={buildMobileDestinationItems(pathname)}
    />
  )
}
