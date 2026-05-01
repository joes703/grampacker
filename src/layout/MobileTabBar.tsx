import { Link, useLocation } from 'react-router'
import { Backpack, List } from 'lucide-react'

// Bottom tab bar for the < md band. Mounted by AppShell so it only renders
// inside the authenticated shell — /login, /register, and /r/:slug never
// see it. At md+ the top NavBar shows an icon-only (or full labeled at lg+)
// cluster covering all destinations, so the tab bar steps aside. Active
// state is computed manually rather than via NavLink's `end` because
// "Lists" needs to highlight across "/", "/lists", and "/lists/:id".
export default function MobileTabBar() {
  const { pathname } = useLocation()
  const onLists = pathname === '/' || pathname === '/lists' || pathname.startsWith('/lists/')
  const onGear = pathname === '/gear' || pathname.startsWith('/gear/')

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex h-14">
        <Tab to="/lists" label="Lists" active={onLists} icon={<List size={20} />} />
        <Tab to="/gear" label="Gear" active={onGear} icon={<Backpack size={20} />} />
      </div>
    </nav>
  )
}

function Tab({
  to,
  label,
  active,
  icon,
}: {
  to: string
  label: string
  active: boolean
  icon: React.ReactNode
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
        active ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}
