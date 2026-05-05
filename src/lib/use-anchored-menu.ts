import { useRef, useState, type RefObject } from 'react'
import { usePortalPopover } from './use-portal-popover'

type RightFlush = { variant: 'right-flush'; menuWidth: number }
type RightAnchored = { variant: 'right-anchored' }
type AnchorVariant = RightFlush | RightAnchored

type MenuPos =
  | { top: number; left: number }
  | { top: number; right: number }

// Shared kebab/popover scaffolding. Combines the menuPos state, trigger
// + content refs, the openMenu() that reads triggerRef.current's
// getBoundingClientRect to compute coordinates, and a usePortalPopover
// subscription so dismiss behavior (mousedown outside, scroll, resize,
// escape) is identical to the inline pattern it replaces.
//
// Anchor variants:
//   - right-flush: menu's right edge aligns with the trigger's right
//     edge. menuWidth is the menu's pixel width (matches Tailwind w-44 =
//     176, w-48 = 192, etc.). Min 8px from viewport left to avoid
//     clipping. Used by row kebabs.
//   - right-anchored: menu's right edge is `viewport.innerWidth -
//     trigger.right` from the right side. Used by HamburgerMenu and
//     similar fixed-position headers; menuWidth is unused since the
//     coordinate is measured from the right.
export function useAnchoredMenu(anchor: AnchorVariant): {
  open: boolean
  openMenu: () => void
  close: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  menuPos: MenuPos | null
} {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const open = menuPos !== null
  const close = () => setMenuPos(null)
  usePortalPopover({ isOpen: open, onClose: close, triggerRef, contentRef: menuRef })

  function openMenu() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    if (anchor.variant === 'right-flush') {
      setMenuPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - anchor.menuWidth),
      })
    } else {
      setMenuPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      })
    }
  }

  return { open, openMenu, close, triggerRef, menuRef, menuPos }
}
