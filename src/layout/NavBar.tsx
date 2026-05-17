import { useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, HelpCircle, LogOut, Pencil, Plus, Settings } from 'lucide-react'
import { useRequireSession } from '../auth/use-require-session'
import { supabase } from '../lib/supabase'
import { queryKeys, fetchLists, updateList, makeOptimisticUpdate } from '../lib/queries'
import type { List } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import MobileMenu from './MobileMenu'
import ListSelector from './ListSelector'
import { useSidebarDrawer } from './sidebar-drawer-context'
import InlineTitle from '../lists/InlineTitle'
import ListSettingsButton from '../lists/ListSettingsButton'
import ListSettingsPanel from '../lists/ListSettingsPanel'
import Modal from '../components/Modal'

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

export default function NavBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const route = resolveRoute(pathname)
  const { available, setOpen } = useSidebarDrawer()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <header className="border-b border-gray-200 bg-white print:hidden">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 sm:gap-3 lg:gap-6 px-4">
        {/* Mobile sidebar trigger — only renders when the active page has
            registered sidebar content (today: ListDetailPage). Visible
            "Add" label so the affordance reads as the action it performs
            (open the gear picker drawer, which is the single mobile
            add path) without crowding the list title. On pages without
            a drawer, this slot collapses and the brand sits at the left
            edge. Hidden on lg+ where the page renders the equivalent
            left aside inline and category sections expose their own
            inline add-row instead. */}
        {available && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Add to list"
            className="lg:hidden inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <Plus size={16} />
            <span>Add</span>
          </button>
        )}

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

        {/* Right cluster — list-context controls (only on /lists/:id) and
            the persistent secondary destinations (Help/Settings/Sign out at
            md+, MobileMenu at <md). On /lists/:id the MobileMenu is rendered
            by ListContextControls instead so the list-action rows can sit
            above the global section in a single popover. */}
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {route.kind === 'list-detail' && <ListContextControls listId={route.listId} />}

          {/* Persistent links on md+. Lists/Gear NavLinks removed — list
              switching is the chevron selector, gear access moves to the
              sidebar in Phase 3. */}
          <div className="hidden md:flex items-center gap-1">
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

          {/* < md trigger for the secondary-destination popover. On
              /lists/:id the same menu is rendered by ListContextControls
              with list-action props above the global section, so suppress
              this top-level mount there to avoid two adjacent menu
              triggers (the original bug). On every other authed route the
              top-level mount is the only menu surface. */}
          {route.kind !== 'list-detail' && (
            <div className="md:hidden">
              <MobileMenu />
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

// Route-specific heading slot. /lists/:id loads the lists query and renders
// InlineTitle + ListSelector once the current list resolves. Other routes
// render a static text heading. Loading state on /lists/:id shows just the
// chevron-less placeholder so the bar's height stays stable.
function RouteHeading({ route }: { route: RouteContext }) {
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''

  // Lists are fetched here for both the heading text and the selector body.
  // The query is also used by ListDetailPage / RootRedirect — same key, so
  // there's a single source of truth in the cache.
  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
    // Don't fetch when there's no list-context — the static-heading routes
    // don't need lists, but we keep the query enabled there too so the
    // cache is warm when the user switches into a list. Cheap.
  })

  if (route.kind === 'list-detail') {
    const list = lists.find((l) => l.id === route.listId)
    if (!list) {
      // Either the lists query is still loading, or the URL points at a
      // list the current user can't see / that no longer exists. Either
      // way, render no heading content rather than thrash.
      return <div className="flex-1 min-w-0" />
    }
    return <ListHeading list={list} lists={lists} userId={userId} />
  }

  if (route.kind === 'all-lists') return <StaticHeading>All lists</StaticHeading>
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

function ListHeading({
  list,
  lists,
  userId,
}: {
  list: import('../lib/types').List
  lists: import('../lib/types').List[]
  userId: string
}) {
  const qc = useQueryClient()
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateList(id, { name }),
    ...makeOptimisticUpdate<List, { id: string; name: string }>({
      qc,
      queryKey: queryKeys.lists(),
      id: ({ id }) => id,
      apply: (item, { name }) => ({
        ...item,
        name,
        updated_at: new Date().toISOString(),
      }),
    }),
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // Counter the pencil increments to push InlineTitle into edit mode. The
  // counter idiom matches LibraryPanel's focusSearchTrigger.
  const [editTrigger, setEditTrigger] = useState(0)

  function handleContainerClick() {
    // Mid-edit, the container becomes click-inert: the input owns the
    // click target while the user is typing, and its blur handler runs
    // commit/cancel for clicks that escape. Without this guard, clicking
    // the container's padding while editing would commit AND open the
    // selector in the same gesture.
    if (editing) return
    setSelectorOpen((o) => !o)
  }

  return (
    // Visual container — primary click target now opens the selector
    // (frequent action). Rename moves to the sibling pencil affordance,
    // hover-revealed at md+ and always visible at <md (touch).
    //
    // The chevron button inside ListSelector is the keyboard-accessible
    // trigger for the selector (Tab + Enter); this div is a mouse-only
    // hit-area expansion. We still satisfy the click-events-have-key-events
    // / no-static-element-interactions a11y rules with role="button" +
    // tabIndex={-1} + an Enter/Space onKeyDown so screen-reader users who
    // happen to focus the container directly get the same affordance.
    <div
      ref={containerRef}
      role="button"
      tabIndex={-1}
      aria-label="Switch list (click). Use the chevron to keyboard-activate."
      onClick={handleContainerClick}
      onKeyDown={(e) => {
        // Only act on keys focused on the container itself. Descendants
        // (the rename input, the chevron button, the pencil button) own
        // their own key handling — without this guard, keystrokes bubble
        // up through the React tree and Space/Enter get preventDefault'd
        // before the descendant can read them. Most visible failure:
        // spacebar didn't insert spaces while renaming a list inline.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleContainerClick()
        }
      }}
      className={`group flex flex-1 min-w-0 items-center rounded-lg bg-gray-50 transition-colors hover:bg-gray-100 ${
        editing ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      <InlineTitle
        key={list.id}
        name={list.name}
        onSave={(v) => renameMut.mutate({ id: list.id, name: v })}
        editTrigger={editTrigger}
        onEditingChange={setEditing}
      />
      {!editing && (
        <button
          type="button"
          onClick={(e) => {
            // Don't bubble to the container's onClick — that would open
            // the selector in the same gesture as entering edit mode.
            e.stopPropagation()
            setEditTrigger((t) => t + 1)
          }}
          aria-label="Rename list"
          title="Rename list"
          // 32×32 hit area (h-8 w-8) for touch comfort. opacity-100 at
          // <md so touch users can always see it; md:opacity-0 +
          // md:group-hover:opacity-100 hides it on desktop until the
          // user hovers the switcher container.
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-400 opacity-100 transition-opacity hover:text-gray-600 md:opacity-0 md:group-hover:opacity-100"
        >
          <Pencil size={14} />
        </button>
      )}
      <ListSelector
        lists={lists}
        currentListId={list.id}
        userId={userId}
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        anchorRef={containerRef}
      />
    </div>
  )
}

// /lists/:id-only controls. Renders inline g/oz, List options, Pack at md+;
// at <md the same actions live in a kebab. Sharing no longer has its own
// top-level trigger — it's a Sharing section inside List options, so the
// modal hosts ListSettingsPanel and the user reaches the public-link toggle
// + copy URL by opening List options.
function ListContextControls({ listId }: { listId: string }) {
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''
  const { data: lists = [] } = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
  })
  const list = lists.find((l) => l.id === listId)
  const { weightUnit, toggleWeightUnit } = useWeightUnit()
  const [searchParams, setSearchParams] = useSearchParams()
  const isPackMode = searchParams.get('mode') === 'pack'
  const [settingsOpen, setSettingsOpen] = useState(false)

  function togglePackMode() {
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev)
        if (isPackMode) np.delete('mode')
        else np.set('mode', 'pack')
        return np
      },
      { replace: false },
    )
  }

  // List-specific affordances (List options button, Pack pill, mobile
  // settings modal body) only render once `list` resolves. g/oz and the
  // mobile menu render unconditionally so the user retains access to
  // global actions (Help / Settings / Sign out) and the unit toggle during
  // the lists query's cold-load window. Without that, /lists/:id has no
  // reachable global menu while loading — a regression versus rendering
  // null.
  return (
    <>
      {/* g/oz toggle — same on every viewport. The text label is short
          enough to render even at 375px without crowding. */}
      <button
        onClick={toggleWeightUnit}
        title={`Switch to ${weightUnit === 'g' ? 'oz' : 'g'}`}
        aria-label={`Toggle weight unit (currently ${weightUnit})`}
        className="rounded-lg border border-gray-300 px-2 sm:px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
      >
        {weightUnit}
      </button>

      {/* md+ inline list controls — gated on resolved list to avoid
          rendering List options / Pack against a stale or absent row.
          Order matches the target mental model: List options (current-list
          settings) sits next to the selector + units cluster, then Pack
          stands alone as the mode switch. */}
      {list && (
        <>
          <div className="hidden md:flex">
            <ListSettingsButton list={list} />
          </div>
          <button
            onClick={togglePackMode}
            title={isPackMode ? 'Pack mode: on' : 'Pack mode: off'}
            aria-label="Pack mode"
            aria-pressed={isPackMode}
            className={`hidden md:inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              isPackMode
                ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-gray-300 text-gray-500 hover:bg-gray-50'
            }`}
          >
            <ClipboardList size={14} />
            <span>Pack</span>
          </button>
        </>
      )}

      {/* < md unified menu — Pack, List options, then the global section.
          Sharing reaches the user through the List options modal, not as
          its own row. Renders unconditionally so the global section
          (Help, Settings, Sign out) remains reachable during the cold-load
          window; list-action handlers flow through only once `list`
          resolves so the rows are either fully wired or hidden. */}
      <div className="md:hidden">
        <MobileMenu
          list={list}
          onPackToggle={list ? togglePackMode : undefined}
          onListSettingsClick={list ? () => setSettingsOpen(true) : undefined}
        />
      </div>

      {/* Mobile list-options modal — opens via the mobile menu's
          List options row. ListSettingsPanel hosts Group worn items and
          the Sharing section (public-link toggle + copy URL). */}
      {list && (
        <Modal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="List options"
          className="w-full max-w-sm"
        >
          <div className="p-4">
            <h2 className="mb-3 text-base font-semibold text-gray-900">List options</h2>
            <ListSettingsPanel list={list} />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
