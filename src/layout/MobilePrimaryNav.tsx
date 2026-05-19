import { Backpack, ListChecks } from 'lucide-react'
import { useLocation } from 'react-router'
import MobileBottomBar from '../components/MobileBottomBar'
import { useIsMobilePrimaryNavSuppressed } from './mobile-primary-nav-context'

// Always-on mobile primary nav (Gear + Lists). Pages with a richer
// bottom bar of their own (List Detail, Gear, Lists) call
// useSuppressMobilePrimaryNav() from their bar component, registering
// themselves with MobilePrimaryNavProvider. Suppression is keyed to that
// runtime registration rather than to the current pathname, so terminal
// states that skip mounting the rich bar (list not found, future
// loading/error branches) still get the generic nav instead of leaving
// the user with no way out.
export default function MobilePrimaryNav() {
  const { pathname } = useLocation()
  const suppressed = useIsMobilePrimaryNavSuppressed()

  if (suppressed) return null

  return (
    <MobileBottomBar
      label="Primary navigation"
      items={[
        {
          type: 'link',
          to: '/gear',
          label: 'Gear',
          icon: <Backpack size={18} />,
          active: pathname === '/gear',
        },
        {
          type: 'link',
          to: '/lists',
          label: 'Lists',
          icon: <ListChecks size={18} />,
          active: pathname.startsWith('/lists'),
        },
      ]}
    />
  )
}
