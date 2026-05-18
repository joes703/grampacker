import { Backpack, ListChecks } from 'lucide-react'
import { useLocation } from 'react-router'
import MobileBottomBar from '../components/MobileBottomBar'

export default function MobilePrimaryNav() {
  const { pathname } = useLocation()

  // List Detail and Gear Library have richer bottom bars that include
  // these same primary destinations plus page-local actions. The Lists
  // page itself has its own richer bar (MobileListsActionBar) too, so
  // this generic primary nav now only surfaces on Settings/Help.
  if (
    /^\/lists\/[^/]+$/.test(pathname) ||
    pathname === '/gear' ||
    pathname === '/lists'
  )
    return null

  return (
    <MobileBottomBar
      label="Primary navigation"
      items={[
        {
          type: 'link',
          to: '/lists',
          label: 'Lists',
          icon: <ListChecks size={18} />,
          active: pathname.startsWith('/lists'),
        },
        {
          type: 'link',
          to: '/gear',
          label: 'Gear',
          icon: <Backpack size={18} />,
          active: pathname === '/gear',
        },
      ]}
    />
  )
}
