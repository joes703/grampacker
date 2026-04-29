import { Link, NavLink, useNavigate } from 'react-router'
import { Backpack, HelpCircle, Info, LogOut, PanelLeftOpen, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import HamburgerMenu from './HamburgerMenu'
import { useSidebarDrawer } from './sidebar-drawer-context'

export default function NavBar() {
  const navigate = useNavigate()
  const { available, setOpen } = useSidebarDrawer()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 lg:gap-6 px-4">
        {/* Mobile sidebar trigger — only renders when the active page has
            registered sidebar content (today: ListDetailPage). On pages
            without a drawer, this slot collapses and the brand sits at
            the left edge. Hidden on desktop, where the page renders the
            equivalent left aside inline. */}
        {available && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open sidebar"
            className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <PanelLeftOpen size={20} />
          </button>
        )}
        <Link to="/" className="text-lg font-bold text-gray-900 hover:text-gray-700">
          grampacker
        </Link>
        {/* Desktop link cluster — hidden on mobile, where the bottom tab bar
            covers Lists/Gear and the hamburger covers everything else. */}
        <div className="ml-auto hidden lg:flex items-center gap-1">
          <NavLink
            to="/gear"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <Backpack size={14} />
            Gear
          </NavLink>
          <NavLink
            to="/help"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <HelpCircle size={14} />
            Help
          </NavLink>
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <Info size={14} />
            About
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <Settings size={14} />
            Settings
          </NavLink>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
        {/* Mobile-only trigger for the secondary-destination popover. */}
        <div className="ml-auto lg:hidden">
          <HamburgerMenu />
        </div>
      </div>
    </header>
  )
}
