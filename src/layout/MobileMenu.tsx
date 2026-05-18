import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router'
import { Backpack, Boxes, HelpCircle, LogOut, Menu, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAnchoredMenu } from '../lib/use-anchored-menu'

// Mobile (<md) global menu — Help, Settings, Sign out. Mounted at the
// NavBar top level on every authed route, including /lists/:id. List-
// specific actions (Pack, List options, Add) live in the page's
// MobileListActionBar at the bottom of the screen, not here.
//
// State distribution:
//   - Open/close lives in this component (useAnchoredMenu).
//   - Sign out runs here so both the desktop md+ button and this menu
//     don't have to duplicate the supabase.auth.signOut + navigate
//     ('/login') pair.
export default function MobileMenu() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-anchored' })

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
        <div
          ref={menuRef}
          className="fixed z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          {/* App navigation + global section. Mobile pages such as
              Settings/Help still need a way back into the app without
              relying on browser Back. */}
          <MenuLink
            to="/lists"
            icon={<Backpack size={14} />}
            active={pathname === '/lists' || pathname.startsWith('/lists/')}
            onClick={close}
          >
            Lists
          </MenuLink>
          <MenuLink
            to="/gear"
            icon={<Boxes size={14} />}
            active={pathname === '/gear'}
            onClick={close}
          >
            Gear
          </MenuLink>
          <div className="my-1 border-t border-gray-100" />

          {/* Global section — Help, Settings, Sign out. NavLink would
              normally drive active styling, but the menu only opens on
              non-active routes (you don't open the mobile menu from /help
              to navigate to /help) so the active state would never show
              in practice. Use a cheap pathname check via useLocation so
              the rare case where the user is already on /help and opens
              the menu is still styled consistently. */}
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

// Help / Settings rows. NavLink would auto-derive active state from the
// router, but passing `active` explicitly keeps the visual system
// consistent with how other menus in the codebase style their rows.
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
