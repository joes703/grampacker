import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { Settings } from 'lucide-react'
import { authClient } from '../lib/auth-client'
import { readLastListPath } from '../lib/last-list-path'
import { MobilePrimaryNavProvider } from './mobile-primary-nav-context'
import { SidebarDrawerProvider } from './sidebar-drawer-context'
import MobilePrimaryNav from './MobilePrimaryNav'
import { useSignOut } from './use-sign-out'

// Session-gated layout shell: slim top header (brand, desktop nav links,
// sign out) + the always-on mobile primary nav. Mounted as a react-router
// layout route in App.tsx, so every signed-in page renders through the
// Outlet inside the shared <main> container.
//
// TRANSPLANT NOTE: the old repo's AppShell composed a full NavBar
// (sidebar drawer, mobile menu, route-context heading) plus lazy-loaded
// secondary routes. Those arrive with their slices; this shell stays
// minimal on purpose so each transplant lands against a surface it can
// grow.
export default function AppShell() {
  const { data: session } = authClient.useSession()
  const { pathname } = useLocation()
  const navigate = useNavigate()
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
              <nav className="hidden md:flex items-center gap-4" aria-label="Primary">
                <Link
                  to="/gear"
                  className={`text-sm font-medium ${
                    pathname === '/gear' ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Gear
                </Link>
                {/* Return-to-workspace shortcut: clicking Lists lands on
                    the last opened list path (so workflows resume where
                    the user left off), or /lists when no cached path
                    exists. The onClick intercept handles the shortcut;
                    falling through to the default target (/lists) covers
                    the first-visit / no-cached-path case. Active on the
                    card page and every list detail/pack URL. */}
                <Link
                  to="/lists"
                  onClick={(e) => {
                    const lastPath = readLastListPath()
                    if (lastPath) {
                      e.preventDefault()
                      void navigate(lastPath)
                    }
                  }}
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
              {/* Settings lives in the header (all screen sizes): the mobile
                  bottom bar is a fixed 4 slots (Gear/Lists/Add/Options)
                  with no room for it, so the cog is the single entry point
                  to /settings on every viewport. */}
              <Link
                to="/settings"
                aria-label="Settings"
                aria-current={pathname === '/settings' ? 'page' : undefined}
                className={`rounded-md p-1.5 hover:bg-gray-50 ${
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
