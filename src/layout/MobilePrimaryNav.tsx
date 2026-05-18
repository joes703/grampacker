import { Backpack, Boxes } from 'lucide-react'
import { useLocation } from 'react-router'
import MobileBottomBar from '../components/MobileBottomBar'

export default function MobilePrimaryNav() {
  const { pathname } = useLocation()

  // List Detail and Gear Library have richer bottom bars that include
  // these same primary destinations plus page-local actions.
  if (/^\/lists\/[^/]+$/.test(pathname) || pathname === '/gear') return null

  return (
    <MobileBottomBar
      label="Primary navigation"
      items={[
        {
          type: 'link',
          to: '/lists',
          label: 'Lists',
          icon: <Backpack size={18} />,
          active: pathname === '/lists' || pathname.startsWith('/lists/'),
        },
        {
          type: 'link',
          to: '/gear',
          label: 'Gear',
          icon: <Boxes size={18} />,
          active: pathname === '/gear',
        },
      ]}
    />
  )
}
