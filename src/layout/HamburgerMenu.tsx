import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router'
import { HelpCircle, Info, LogOut, Menu, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Mobile-only kebab-style menu for the secondary destinations that don't fit
// in the bottom tab bar (Help, About, Settings, Sign out). Modeled on the
// portal-popover pattern used by RowKebab — overlay + fixed-positioned panel,
// dismisses on outside click, scroll, or resize. A right-side drawer would
// be heavier UX for four items; this keeps the codebase to one popover idiom.
export default function HamburgerMenu() {
  const navigate = useNavigate()
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = menuPos !== null

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (
        menuRef.current && !menuRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) {
        setMenuPos(null)
      }
    }
    function dismiss() { setMenuPos(null) }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  function openMenu() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }

  async function handleSignOut() {
    setMenuPos(null)
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setMenuPos(null) : openMenu())}
        aria-label="More options"
        aria-expanded={open}
        className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
      >
        <Menu size={20} />
      </button>

      {open && menuPos && createPortal(
        // Plain <div> with semantic <button>/<a> children — dropping role="menu"
        // because we don't implement arrow-key navigation (WAI-ARIA's menu
        // pattern requires it). Tab order is sufficient for four items.
        <div
          ref={menuRef}
          className="fixed z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          <MenuLink to="/help" icon={<HelpCircle size={14} />} onClick={() => setMenuPos(null)}>
            Help
          </MenuLink>
          <MenuLink to="/about" icon={<Info size={14} />} onClick={() => setMenuPos(null)}>
            About
          </MenuLink>
          <MenuLink to="/settings" icon={<Settings size={14} />} onClick={() => setMenuPos(null)}>
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

function MenuLink({
  to,
  icon,
  children,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
    >
      {icon}
      <span>{children}</span>
    </Link>
  )
}
