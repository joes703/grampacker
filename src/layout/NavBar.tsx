import { NavLink, useNavigate } from 'react-router'
import { LogOut, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function NavBar() {
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <span className="text-lg font-bold text-gray-900">grampacker</span>
        <nav className="flex gap-1">
          <NavLink
            to="/gear"
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            Gear
          </NavLink>
          <NavLink
            to="/lists"
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
            }
          >
            Lists
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-1">
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
      </div>
    </header>
  )
}
