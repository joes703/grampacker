import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  ClipboardList,
  Globe,
  HelpCircle,
  LogOut,
  Menu,
  Settings,
  Settings2,
} from 'lucide-react'
import type { List } from '../lib/types'
import { supabase } from '../lib/supabase'
import { useAnchoredMenu } from '../lib/use-anchored-menu'

// Single mobile (<md) menu used at two consumption sites:
//   1. NavBar top-level on every authed route EXCEPT /lists/:id, with no
//      list-action props — renders the global-only section (Help, Settings,
//      Sign out).
//   2. NavBar's ListContextControls on /lists/:id, with all list-action
//      props — renders Pack mode, List options, Share, divider, then the
//      global section.
//
// Replaces the previous pair of adjacent overflow buttons (HamburgerMenu +
// ListActionsKebab) which competed on the same right-side region of the
// mobile top bar.
//
// State distribution:
//   - URL state (Pack mode, current pathname) is read locally so active
//     styling stays correct without lifting state.
//   - List-options + Share modals (open/close) live in ListContextControls;
//     this component just calls the handlers passed in via props.
//   - Sign out lives here, since both consumption sites need it and
//     centralizing it avoids two copies of the supabase.auth.signOut +
//     navigate('/login') pair.
type Props = {
  /** Provide together with the three list-action handlers to enable the
   *  list-actions section. When list is undefined (e.g. cold-load window
   *  before the lists query resolves), only the global section renders. */
  list?: List
  onPackToggle?: () => void
  onListSettingsClick?: () => void
  onShareClick?: () => void
}

export default function MobileMenu({
  list,
  onPackToggle,
  onListSettingsClick,
  onShareClick,
}: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const isPackMode = searchParams.get('mode') === 'pack'
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-anchored' })

  // The list-action section requires both the list row (for active states
  // on Share) and all three handlers. If any is missing, hide the section
  // — partial rendering would mean a row whose toggle did nothing.
  const showListActions =
    Boolean(list) && Boolean(onPackToggle) && Boolean(onListSettingsClick) && Boolean(onShareClick)

  async function handleSignOut() {
    close()
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        aria-label="More options"
        aria-expanded={open}
        className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
      >
        <Menu size={20} />
      </button>

      {open && menuPos && 'right' in menuPos && createPortal(
        // Width and chrome match the previous HamburgerMenu / ListActionsKebab
        // (w-48 and w-44 respectively). Standardizing on w-48 to give the
        // longer "Exit pack mode" / "Ungroup worn" labels comfortable room.
        <div
          ref={menuRef}
          className="fixed z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          {showListActions && list && (
            <>
              <ToggleRow
                icon={<ClipboardList size={14} />}
                label={isPackMode ? 'Exit pack mode' : 'Pack mode'}
                active={isPackMode}
                onClick={() => {
                  close()
                  onPackToggle?.()
                }}
              />
              <MenuRowButton
                icon={<Settings2 size={14} />}
                onClick={() => {
                  close()
                  onListSettingsClick?.()
                }}
              >
                List options…
              </MenuRowButton>
              <ToggleRow
                icon={<Globe size={14} />}
                label="Share…"
                active={list.is_shared}
                onClick={() => {
                  close()
                  onShareClick?.()
                }}
              />
              <div className="my-1 border-t border-gray-100" />
            </>
          )}

          {/* Global section — Help, Settings, Sign out. NavLink would
              normally drive active styling, but the menu only opens on
              non-active routes (you don't open the mobile menu from /help
              to navigate to /help) so the active state would never show
              in practice. Use a cheap pathname check via useLocation so
              the rare case where the user is already on /help and opens
              the menu is still styled consistently with the toggle rows. */}
          <MenuLink
            to="/help"
            icon={<HelpCircle size={14} />}
            active={pathname === '/help'}
            onClick={close}
          >
            Help
          </MenuLink>
          <MenuLink
            to="/settings"
            icon={<Settings size={14} />}
            active={pathname === '/settings'}
            onClick={close}
          >
            Settings
          </MenuLink>
          <div className="my-1 border-t border-gray-100" />
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}

// Shared row primitive for the three list-action toggles. Centralizes the
// active-styling ternary so a future copy edit can't drift between rows.
// The blue-tinted active style mirrors the desktop pill controls in
// ListContextControls (without the border, since menu rows aren't bordered).
function ToggleRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
        active
          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// Non-toggle row primitive — opens a modal or runs an action that lives
// elsewhere. Used by "List options…" which routes to a modal hosting
// ListSettingsPanel (the toggles live there, not in the menu). Same row
// chrome as MenuLink so the menu reads as one consistent list, just
// without the active-state styling since the row has no persistent state.
function MenuRowButton({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

// Help / Settings rows. NavLink would auto-derive active state from the
// router, but it doesn't compose with the gray-active vs blue-active
// distinction the menu uses; passing `active` explicitly keeps the visual
// system consistent.
function MenuLink({
  to,
  icon,
  children,
  active,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 px-3 py-2 text-sm ${
        active
          ? 'bg-gray-100 text-gray-900 font-medium hover:bg-gray-100'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span>{children}</span>
    </Link>
  )
}

