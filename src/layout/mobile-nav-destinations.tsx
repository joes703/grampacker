import { Backpack, ListChecks } from 'lucide-react'
import type { MobileBottomBarItem } from '../components/MobileBottomBar'

// Shared "destination" items (Gear + Lists) for the mobile bottom bar.
// Every mobile bar emits the same first two slots so users see consistent
// geography across the app; page-specific bars then append their own Add
// and Options items to complete the 4-slot layout.
//
// Active-state rules live here so all callers stay aligned:
//   - Gear active on /gear
//   - Lists active on /lists and /lists/:id (any subroute, including
//     ?mode=pack). Pack mode is URL state on a list, not a separate
//     destination; the in-page Pack pill on List Detail carries that
//     signal locally.
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
      type: 'link',
      to: '/lists',
      label: 'Lists',
      icon: <ListChecks size={18} />,
      ariaLabel: 'Lists',
      active: pathname === '/lists' || pathname.startsWith('/lists/'),
    },
  ]
}
