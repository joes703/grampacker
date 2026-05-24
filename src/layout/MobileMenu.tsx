import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { HelpCircle, LogOut, Menu, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import { MOBILE_ROW_CONTROL_TARGET, POPOVER_SURFACE } from '../components/flat-table-styles'

// Mobile (<md) global menu — Help, Settings, Sign out only. Mounted at
// the NavBar top level on every authed route. The primary destinations
// (Gear, Lists) live in the persistent mobile bottom bars on every page,
// so they're deliberately not duplicated here. List-specific actions
// (Pack, List options, Add) live in the page's MobileListActionBar at
// the bottom of the screen, not here.
//
// State distribution:
//   - Open/close lives in this component (useAnchoredMenu).
//   - Sign out runs here so both the desktop md+ button and this menu
//     don't have to duplicate the supabase.auth.signOut + navigate
//     ('/login') pair.
//
// Rows are buttons that call navigate(to) after close(), not react-router
// <Link> elements. The portal-rendered menu used <Link> previously, but
// taps on it intermittently failed to navigate on mobile — likely the
// close()-driven state update racing the Link's internal click handler.
// Explicit navigate() after close() removes the race.
export default function MobileMenu() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-anchored' })

  function go(to: string) {
    close()
    navigate(to)
  }

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
        className={`md:hidden inline-flex ${MOBILE_ROW_CONTROL_TARGET} items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100`}
      >
        <Menu size={20} />
      </button>

      {open && menuPos && 'right' in menuPos && createPortal(
        <div
          ref={menuRef}
          className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          {/* Global section — Help, Settings, Sign out. Gear and Lists
              are already persistent in the mobile bottom bar on every
              authed route, so they aren't duplicated here. */}
          <MenuItem
            icon={<HelpCircle size={14} />}
            active={pathname === '/help'}
            onClick={() => go('/help')}
          >
            Help
          </MenuItem>
          <MenuItem
            icon={<Settings size={14} />}
            active={pathname === '/settings'}
            onClick={() => go('/settings')}
          >
            Settings
          </MenuItem>
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

// Navigation rows. Plain buttons rather than <Link> — see the file-level
// comment for why. aria-current="page" preserves screen-reader cue when
// the user opens the menu while already on the destination.
function MenuItem({
  icon,
  children,
  active,
  onClick,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
        active
          ? 'bg-gray-100 text-gray-900 font-medium hover:bg-gray-100'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}
