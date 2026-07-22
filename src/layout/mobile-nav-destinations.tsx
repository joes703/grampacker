import { Backpack, ListChecks, UtensilsCrossed } from 'lucide-react'
import type { MobileBottomBarItem } from '../components/MobileBottomBar'

// Shared "destination" items (Gear + Lists + Food) for the mobile bottom
// bar. Every mobile bar emits the same first three slots so users see
// consistent geography across the app; page-specific bars may append actions,
// producing deliberate 3-, 4-, or 5-slot layouts.
//
// Active-state rules live here so all callers stay aligned:
//   - Gear active on /gear
//   - Lists active on /lists and every list-detail mode — the slot is a
//     destination for the whole lists workspace, so detail pages keep it lit.
//   - Food active on /food and any /food/... (the food workspace, so a
//     future plan editor keeps it lit)
//
// Order is Gear, Lists, Food and must match AppShell's desktop header links.
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
    {
      type: 'link',
      to: '/food',
      label: 'Food',
      icon: <UtensilsCrossed size={18} />,
      ariaLabel: 'Food',
      active: pathname === '/food' || pathname.startsWith('/food/'),
    },
  ]
}
