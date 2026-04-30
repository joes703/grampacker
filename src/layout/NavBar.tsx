import { Link, NavLink, useNavigate } from 'react-router'
import { Backpack, HelpCircle, Info, List, LogOut, PanelLeftOpen, Settings } from 'lucide-react'
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
            aria-label="Open gear library"
            className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <PanelLeftOpen size={20} />
          </button>
        )}
        <Link to="/" className="text-lg font-bold text-gray-900 hover:text-gray-700">
          grampacker
        </Link>
        {/* Top link cluster. Three responsive bands:
            - lg+ (≥1024): icons + visible text labels.
            - md to lg (768-1023): icon-only — labels collapse via
              sr-only lg:not-sr-only so screen readers still read them
              and the link's accessible name stays correct without a
              separate aria-label. `title` provides a hover hint.
            - < md (<768): hidden entirely; the bottom MobileTabBar
              covers Lists/Gear and the HamburgerMenu covers the rest. */}
        <div className="ml-auto hidden md:flex items-center gap-1">
          <NavLink
            to="/lists"
            title="Lists"
            // Highlight on /lists itself AND any /lists/:id detail route, so
            // the nav doesn't go dim once the user clicks into a card.
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <List size={14} />
            <span className="sr-only lg:not-sr-only">Lists</span>
          </NavLink>
          <NavLink
            to="/gear"
            title="Gear"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <Backpack size={14} />
            <span className="sr-only lg:not-sr-only">Gear</span>
          </NavLink>
          <NavLink
            to="/help"
            title="Help"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <HelpCircle size={14} />
            <span className="sr-only lg:not-sr-only">Help</span>
          </NavLink>
          <NavLink
            to="/about"
            title="About"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <Info size={14} />
            <span className="sr-only lg:not-sr-only">About</span>
          </NavLink>
          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            <Settings size={14} />
            <span className="sr-only lg:not-sr-only">Settings</span>
          </NavLink>
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={14} />
            <span className="sr-only lg:not-sr-only">Sign out</span>
          </button>
        </div>
        {/* < md trigger for the secondary-destination popover. md-lg uses the
            icon-only top cluster above; lg+ shows full labels. */}
        <div className="ml-auto md:hidden">
          <HamburgerMenu />
        </div>
      </div>
    </header>
  )
}
