import { Backpack, ListChecks } from 'lucide-react'
import type { MobileBottomBarItem } from '../components/MobileBottomBar'

// Shared "destination" items (Gear + Lists) for the mobile bottom bar.
// Every mobile bar emits the same first two slots so users see consistent
// geography across the app; page-specific bars then append their own Add
// and Options items to complete the 4-slot layout.
//
// Active-state rules live here so all callers stay aligned:
//   - Gear active on /gear
//
// TRANSPLANT NOTE (phase 3): /lists does not exist on this stack yet, so
// the Lists slot renders as a disabled button (the same pattern as
// MobilePrimaryNav's contextless Add/Options slots) instead of a link
// that would fall through to the wildcard redirect. When the lists slice
// transplants, this slot becomes the old repo's link again:
//   { type: 'link', to: '/lists', label: 'Lists', ...,
//     active: pathname === '/lists' || pathname.startsWith('/lists/') }
export function buildMobileDestinationItems(pathname: string): MobileBottomBarItem[] {
  return [
    {
      type: 'link',
      to: '/gear',
      label: 'Gear',
      icon: <Backpack size={18} />,
      ariaLabel: 'Gear',
      active: pathname === '/gear',
    },
    {
      type: 'button',
      label: 'Lists',
      icon: <ListChecks size={18} />,
      onClick: () => {},
      disabled: true,
      ariaLabel: 'Lists (coming soon)',
    },
  ]
}
