import { Backpack, ListChecks } from 'lucide-react'
import type { MobileBottomBarItem } from '../components/MobileBottomBar'

// Shared destination items for the mobile bottom
// bar. Every mobile bar emits the same first three slots so users see
// consistent geography across the app; page-specific bars may append actions,
// producing deliberate 3-, 4-, or 5-slot layouts.
//
// The links are NavLinks (MobileBottomBar), which match child paths, so Lists
// stays lit on every list page. Order must match AppShell's desktop header
// links.
export function buildMobileDestinationItems(): MobileBottomBarItem[] {
  const items: MobileBottomBarItem[] = [
    {
      type: 'link',
      to: '/gear',
      label: 'Gear',
      icon: <Backpack size={18} />,
      ariaLabel: 'Gear',
    },
    {
      type: 'link',
      to: '/lists',
      label: 'Lists',
      icon: <ListChecks size={18} />,
      ariaLabel: 'Lists',
    },
  ]

  return items
}
