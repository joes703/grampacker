import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

type MenuPos = { top: number; left: number }

// The kebab menu's positioning and dismissal (KebabMenu is the one caller).
//
// Position: the menu's right edge aligns with the trigger's right edge
// (menuWidth is its pixel width, matching Tailwind's w-44 = 176, w-48 = 192),
// at least 8px from the viewport's left, flipped above the trigger when there
// is no room below.
//
// Dismissal, while open:
//   - mousedown outside BOTH the trigger and the menu closes it (mousedown, so
//     it closes before focus or selection moves to the new target; the
//     trigger's own onClick handles the toggle);
//   - a scroll anywhere except inside the menu closes it, and so does a
//     resize: the position is a snapshot taken at open time;
//   - Escape closes it and returns focus to the trigger (only Escape: the
//     other dismissals are the user moving focus themselves);
//   - opening focuses the menu itself, so a temporarily disabled safe action
//     never sends focus straight to a destructive one.
export function useAnchoredMenu(menuWidth: number): {
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

  const positionFromRect = useCallback((rect: DOMRect, menuHeight = 0): MenuPos => {
    const gap = 4
    const viewportPad = 8
    const belowTop = rect.bottom + gap
    const aboveTop = rect.top - menuHeight - gap
    const shouldFlipUp =
      menuHeight > 0 && window.innerHeight - rect.bottom < menuHeight + viewportPad
    const maxTop = Math.max(viewportPad, window.innerHeight - menuHeight - viewportPad)
    const top = Math.min(Math.max(shouldFlipUp ? aboveTop : belowTop, viewportPad), maxTop)

    return {
      top,
      left: Math.max(8, rect.right - menuWidth),
    }
  }, [menuWidth])

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

  useEffect(() => {
    if (!open) return

    const menu = menuRef.current
    if (menu) {
      // Focusable without joining the Tab order.
      if (!menu.hasAttribute('tabindex')) menu.tabIndex = -1
      menu.focus()
    }

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMenuPos(null)
    }
    function handleScroll(e: Event) {
      // A scroll inside the menu (reaching for its last item) must not close
      // it. A window scroll's target is not a Node, so it closes.
      const target = e.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setMenuPos(null)
    }
    function handleResize() {
      setMenuPos(null)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setMenuPos(null)
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return { open, openMenu, close, triggerRef, menuRef, menuPos }
}
