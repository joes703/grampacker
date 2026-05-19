import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Backpack, HelpCircle, ListChecks, LogOut, Settings } from 'lucide-react'
import { useRequireSession } from '../auth/use-require-session'
import { supabase } from '../lib/supabase'
import { queryKeys, fetchLists } from '../lib/queries'
import { useIsMobile } from '../lib/use-breakpoint'
import MobileMenu from './MobileMenu'
import CurrentListHeader from '../lists/CurrentListHeader'

// Per-route slot resolution. Mounted only inside AppShell, which is gated by
// PrivateRoute — so this component is never rendered on /login, /register,
// /forgot-password, /reset-password, or /r/:slug. The path-match logic only
// needs to handle authenticated routes plus the AppShell catch-all. AppShell
// can't pass routeId via props (NavBar sits outside the inner <Routes>), so
// the current list id is parsed from pathname here.
type RouteContext =
  | { kind: 'list-detail'; listId: string }
  | { kind: 'all-lists' }
  | { kind: 'gear' }
  | { kind: 'settings' }
  | { kind: 'help' }
  | { kind: 'other' }

function resolveRoute(pathname: string): RouteContext {
  const listMatch = pathname.match(/^\/lists\/([^/]+)$/)
  if (listMatch?.[1]) return { kind: 'list-detail', listId: listMatch[1] }
  if (pathname === '/lists') return { kind: 'all-lists' }
  if (pathname === '/gear') return { kind: 'gear' }
  if (pathname === '/settings') return { kind: 'settings' }
  if (pathname === '/help') return { kind: 'help' }
  return { kind: 'other' }
}

// Global authed top bar. Stable across every authed route:
//   - Brand on md+.
//   - Route heading slot — static labels on /lists, /gear, /settings, /help;
//     CurrentListHeader on /lists/:id at <md (mobile keeps the list name in
//     the top bar). At md+ on /lists/:id the slot is empty — the desktop
//     list-detail page body owns the list toolbar (CurrentListHeader +
//     List options + Pack pill) so the global nav stays clean and stable.
//     List switching happens through the Lists destination, not from the
//     list title in either layout.
//   - Persistent secondary cluster on md+: Lists, Gear, Help, Settings, Sign out.
//   - MobileMenu on <md for the same global destinations.
export default function NavBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const route = resolveRoute(pathname)

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <header className="border-b border-gray-200 bg-white print:hidden">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 sm:gap-3 lg:gap-6 px-4">
        {/* Brand. Hidden on <md to free space for the route heading +
            controls (the route's own heading carries the identity). On md+
            it's the home link. */}
        <Link
          to="/"
          className="hidden md:inline-block text-lg font-bold text-gray-900 hover:text-gray-700"
        >
          grampacker
        </Link>

        {/* Heading slot — varies by route. */}
        <RouteHeading route={route} />

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {/* Persistent global navigation on md+. Lists + Gear sit alongside
              Help/Settings/Sign out so the two primary destinations are
              always reachable. The Lists destination is also where users
              switch between lists — the per-page title (CurrentListHeader)
              only identifies the current list, never switches it. */}
          <div className="hidden md:flex items-center gap-1 pl-2">
            <NavLink
              to="/lists"
              title="Lists"
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
              }
            >
              <ListChecks size={14} />
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

          {/* < md trigger for the secondary-destination popover. The
              mobile bottom action bar handles list-specific actions on
              /lists/:id, so this menu is global-only on every route. */}
          <div className="md:hidden">
            <MobileMenu />
          </div>
        </div>
      </div>
    </header>
  )
}

// Route-specific heading slot. /lists/:id renders CurrentListHeader at
// <md only — desktop list-detail moves the list title into the page body.
// Other routes render a static text heading at all sizes. Loading state
// on /lists/:id shows a neutral placeholder so the bar's height stays
// stable.
function RouteHeading({ route }: { route: RouteContext }) {
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''
  const isMobile = useIsMobile()

  // Lists are fetched here for the mobile heading text. The query is also
  // used by ListDetailPage / RootRedirect — same key, so there's a single
  // source of truth in the cache.
  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
  })

  if (route.kind === 'list-detail') {
    // Desktop list-detail anchors the list title in the page body's
    // toolbar (ListDetailPage's CurrentListHeader). Skip mounting it here
    // on desktop entirely — a plain CSS `md:hidden` would still mount the
    // component and surface the inline-rename input in the desktop DOM
    // even though it's invisible.
    if (!isMobile) return <div className="flex-1 min-w-0" />
    const list = lists.find((l) => l.id === route.listId)
    if (!list) {
      // Either the lists query is still loading, or the URL points at a
      // list the current user can't see / that no longer exists. Either
      // way, render no heading content rather than thrash.
      return <div className="flex-1 min-w-0" />
    }
    return (
      <div className="flex flex-1 min-w-0">
        <CurrentListHeader list={list} />
      </div>
    )
  }

  if (route.kind === 'all-lists') return <StaticHeading>Lists</StaticHeading>
  if (route.kind === 'gear') return <StaticHeading>Gear Library</StaticHeading>
  if (route.kind === 'settings') return <StaticHeading>Settings</StaticHeading>
  if (route.kind === 'help') return <StaticHeading>Help</StaticHeading>
  return <div className="flex-1 min-w-0" />
}

function StaticHeading({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="flex-1 min-w-0 truncate text-base sm:text-lg font-semibold text-gray-900">
      {children}
    </h1>
  )
}
