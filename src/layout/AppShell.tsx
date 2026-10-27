import { Suspense, lazy, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { Settings } from 'lucide-react'
import { authClient } from '../lib/auth-client'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import { MobilePrimaryNavProvider } from './mobile-primary-nav-context'
import { SidebarDrawerProvider } from './sidebar-drawer-context'
import MobilePrimaryNav from './MobilePrimaryNav'
import { useSignOut } from './use-sign-out'
// Lazy + mounted only while open. Settings pulls in passkeys, the data-export
// zipper and react-query; the shell wraps every page, so importing that tree
// eagerly would put it on the critical path of a view that rarely opens it.
const SettingsModal = lazy(() => import('../settings/SettingsModal'))

// Session-gated layout shell: slim top header (brand, desktop nav links,
// settings, sign out) plus the mobile primary nav. Route components own their
// page headings and actions; this shared shell intentionally stays independent
// of route-specific state.
const headerLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium ${isActive ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'}`

export default function AppShell() {
  const { data: session } = authClient.useSession()
  const { signingOut, signOut } = useSignOut()
  // Settings is a modal, not a route: four small sections you touch a few
  // times a year do not justify leaving the list you are working on.
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <SidebarDrawerProvider>
    <MobilePrimaryNavProvider>
      <div className="min-h-screen bg-gray-50 print:min-h-0 print:bg-white">
        {/* The whole app header is chrome: brand, nav, the signed-in
            EMAIL ADDRESS, Settings and Sign out. None of it belongs on a
            printed checklist, and the email least of all - a packing list
            is a document you hand to someone. */}
        <header className="border-b border-gray-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-6">
              <Link to="/" className="text-lg font-bold tracking-tight text-gray-900">
                grampacker
              </Link>
              <nav className="hidden lg:flex items-center gap-4" aria-label="Primary">
                <NavLink to="/gear" className={headerLinkClass}>
                  Gear
                </NavLink>
                {/* NavLink matches child paths, so Lists stays lit on every
                    list page and view. */}
                <NavLink to="/lists" className={headerLinkClass}>
                  Lists
                </NavLink>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-sm text-gray-600">{session?.user.email}</span>
              {/* Settings lives in the header at every viewport because the
                  mode-specific bottom bars contain destinations and page
                  actions, not global account controls. */}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                aria-expanded={settingsOpen}
                className={`${ROW_CONTROL_TARGET} shrink-0 hover:bg-gray-50 ${
                  settingsOpen ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Settings size={18} />
              </button>
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
        {/* print:p-0 here, not on the page: this padding is an ANCESTOR of
            the route, so ListDetailPage's own print:pb-0 cannot reach it.
            pb-20 is the mobile bottom-bar reserve and would print as two
            inches of blank paper. */}
        <main className="mx-auto max-w-7xl px-4 pt-4 lg:pt-8 pb-20 lg:pb-8 print:max-w-none print:p-0">
          <Outlet />
        </main>
        <MobilePrimaryNav />
        {settingsOpen && (
          <Suspense fallback={null}>
            <SettingsModal open onClose={() => setSettingsOpen(false)} />
          </Suspense>
        )}
      </div>
    </MobilePrimaryNavProvider>
    </SidebarDrawerProvider>
  )
}
