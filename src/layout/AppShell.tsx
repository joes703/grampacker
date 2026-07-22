import { Link, Outlet, useLocation } from 'react-router'
import { Settings } from 'lucide-react'
import { authClient } from '../lib/auth-client'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import { MobilePrimaryNavProvider } from './mobile-primary-nav-context'
import { SidebarDrawerProvider } from './sidebar-drawer-context'
import MobilePrimaryNav from './MobilePrimaryNav'
import { useSignOut } from './use-sign-out'

// Session-gated layout shell: slim top header (brand, desktop nav links,
// settings, sign out) plus the mobile primary nav. Route components own their
// page headings and actions; this shared shell intentionally stays independent
// of route-specific state.
export default function AppShell() {
  const { data: session } = authClient.useSession()
  const { pathname } = useLocation()
  const { signingOut, signOut } = useSignOut()

  return (
    <SidebarDrawerProvider>
    <MobilePrimaryNavProvider>
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-6">
              <Link to="/" className="text-lg font-bold tracking-tight text-gray-900">
                grampacker
              </Link>
              <nav className="hidden lg:flex items-center gap-4" aria-label="Primary">
                <Link
                  to="/gear"
                  className={`text-sm font-medium ${
                    pathname === '/gear' ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Gear
                </Link>
                <Link
                  to="/lists"
                  className={`text-sm font-medium ${
                    pathname === '/lists' || pathname.startsWith('/lists/')
                      ? 'text-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Lists
                </Link>
                <Link
                  to="/food"
                  className={`text-sm font-medium ${
                    pathname === '/food' || pathname.startsWith('/food/')
                      ? 'text-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Food
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-sm text-gray-600">{session?.user.email}</span>
              {/* Settings lives in the header at every viewport because the
                  mode-specific bottom bars contain destinations and page
                  actions, not global account controls. */}
              <Link
                to="/settings"
                aria-label="Settings"
                aria-current={pathname === '/settings' ? 'page' : undefined}
                className={`${ROW_CONTROL_TARGET} shrink-0 hover:bg-gray-50 ${
                  pathname === '/settings' ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Settings size={18} />
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 pt-4 lg:pt-8 pb-20 lg:pb-8">
          <Outlet />
        </main>
        <MobilePrimaryNav />
      </div>
    </MobilePrimaryNavProvider>
    </SidebarDrawerProvider>
  )
}
