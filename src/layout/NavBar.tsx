import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Backpack, HelpCircle, ListChecks, LogOut, Settings } from 'lucide-react'
import { useRequireSession } from '../auth/use-require-session'
import { supabase } from '../lib/supabase'
import { queryKeys, fetchLists } from '../lib/queries'
import { useIsMobile } from '../lib/use-breakpoint'
import { readLastListPath } from '../lib/last-list-path'
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
//     the top bar). At md+ on /lists/:id the global slot says "Lists" while
//     the page body owns the specific list title and toolbar
//     (CurrentListHeader + List options + Pack pill).
//     Desktop list switching lives in DesktopListsPanel on /lists/:id; the
//     global nav Lists item is just a return-to-workspace affordance.
//     Mobile Lists in the bottom bar still goes to the /lists page.
//   - Persistent secondary cluster on md+: Gear, Lists, Help, Settings, Sign out.
//   - MobileMenu on <md exposes only Help, Settings, Sign out — Gear and
//     Lists are already pinned to the mobile bottom bar on every authed
//     route, so they aren't duplicated in the hamburger.
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
          {/* Persistent global navigation on md+. Gear + Lists sit alongside
              Help/Settings/Sign out so the two primary destinations are
              always reachable. Gear is first because it's the source/library
              that lists are built from. Lists is a return-to-workspace
              button: clicking it lands on the last opened list path (so
              workflows resume where the user left off), or /lists when no
              last list exists. List switching itself lives in
              DesktopListsPanel on /lists/:id, not in this nav item. */}
          <div className="hidden md:flex items-center gap-1 pl-2">
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
            {/* NavLink with to="/lists" gives the same pill styling and the
                same active behavior the previous dropdown carried (active on
                /lists and any /lists/:id, courtesy of NavLink's default
                prefix match). onClick intercepts to send the user to the
                last opened list path when present, so the pill behaves as a
                return-to-workspace shortcut rather than a route to the card
                page. Falling through to the default NavLink target (/lists)
                handles the first-visit / no-cached-path case. */}
            <NavLink
              to="/lists"
              title="Lists"
              onClick={(e) => {
                const lastPath = readLastListPath()
                if (lastPath) {
                  e.preventDefault()
                  navigate(lastPath)
                }
              }}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`
              }
            >
              <ListChecks size={14} />
              <span className="sr-only lg:not-sr-only">Lists</span>
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

          {/* < md trigger for the global-destinations popover (Help,
              Settings, Sign out only). The mobile bottom action bars
              handle Gear, Lists, and any page-local actions, so this
              menu deliberately doesn't duplicate them. */}
          <div className="md:hidden">
            <MobileMenu />
          </div>
        </div>
      </div>
    </header>
  )
}

// Route-specific heading slot. On /lists/:id: mobile renders
// CurrentListHeader (the specific list name in the top bar), while desktop
// renders the workspace label "Lists" so the global heading matches the
// active Lists nav pill — the specific list title lives in the page body's
// CurrentListHeader on desktop. Other routes render a static text heading
// at all sizes. Loading state on mobile /lists/:id shows a neutral
// placeholder so the bar's height stays stable.
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
    // Desktop list-detail anchors the specific list title in the page body's
    // toolbar (ListDetailPage's CurrentListHeader), while the global heading
    // still identifies the section like every other top-nav destination.
    // Mobile keeps the actual list name in the top bar because the page body
    // toolbar is not visible there.
    if (!isMobile) return <StaticHeading>Lists</StaticHeading>
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
  if (route.kind === 'gear') return <StaticHeading>Gear Inventory</StaticHeading>
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
