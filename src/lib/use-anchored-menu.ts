import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
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
  const triggerRectRef = useRef<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const open = menuPos !== null
  const close = () => setMenuPos(null)
  const anchorVariant = anchor.variant
  const menuWidth = anchor.variant === 'right-flush' ? anchor.menuWidth : undefined
  usePortalPopover({ isOpen: open, onClose: close, triggerRef, contentRef: menuRef })

  const positionFromRect = useCallback((rect: DOMRect, menuHeight = 0): MenuPos => {
    const gap = 4
    const viewportPad = 8
    const belowTop = rect.bottom + gap
    const aboveTop = rect.top - menuHeight - gap
    const shouldFlipUp =
      menuHeight > 0 && window.innerHeight - rect.bottom < menuHeight + viewportPad
    const maxTop = Math.max(viewportPad, window.innerHeight - menuHeight - viewportPad)
    const top = Math.min(Math.max(shouldFlipUp ? aboveTop : belowTop, viewportPad), maxTop)

    if (anchorVariant === 'right-flush') {
      return {
        top,
        left: Math.max(8, rect.right - (menuWidth ?? 0)),
      }
    }
    return {
      top,
      right: Math.max(8, window.innerWidth - rect.right),
    }
  }, [anchorVariant, menuWidth])

  function openMenu() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    triggerRectRef.current = rect
    setMenuPos(positionFromRect(rect))
  }

  useLayoutEffect(() => {
    if (!open || !triggerRectRef.current || !menuRef.current) return
    const height = menuRef.current.getBoundingClientRect().height
    setMenuPos(positionFromRect(triggerRectRef.current, height))
  }, [open, positionFromRect])

  return { open, openMenu, close, triggerRef, menuRef, menuPos }
}
