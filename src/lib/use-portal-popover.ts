import { useEffect, useRef, type RefObject } from 'react'

// Shared dismissal lifecycle for portal-rendered popovers (kebabs, dropdowns,
// share-link panels). Wires the same four listeners that every popover in the
// app needs:
//
//   1. mousedown anywhere outside BOTH the trigger and the content closes the
//      popover. mousedown (not click) so the popover dismisses before any
//      focus/selection side-effects on the new target.
//   2. scroll on any ancestor closes — listened at window/capture so a scroll
//      inside any nested container bubbles through.
//   3. resize closes (the popover position is computed from a getBoundingClientRect
//      snapshot at open time and would otherwise drift).
//   4. Escape closes — common a11y expectation; none of the call sites had
//      a competing Escape handler.
//
// Listeners attach when isOpen flips true and detach when it flips false or
// the component unmounts. No-op when isOpen is false.
//
// "Outside" means outside BOTH refs — clicks inside the trigger let the
// trigger's own onClick handle the toggle, clicks inside the content are the
// menu items doing their thing.
//
// `onClose` does NOT need to be memoized by callers: the hook stores the
// latest reference in a ref so the listener-attach effect doesn't re-run on
// every render, and the listeners always invoke the freshest closure.
export function usePortalPopover(opts: {
  isOpen: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
  closeOnScroll?: boolean
  closeOnResize?: boolean
  closeOnEscape?: boolean
}): void {
  const {
    isOpen,
    onClose,
    triggerRef,
    contentRef,
    closeOnScroll = true,
    closeOnResize = true,
    closeOnEscape = true,
  } = opts

  // Keep the latest onClose in a ref so the effect's deps stay stable across
  // renders even when callers pass a fresh inline arrow each time.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (contentRef.current?.contains(target)) return
      onCloseRef.current()
    }
    function handleScroll(e: Event) {
      // Scrolls INSIDE the popover content (e.g. an internally-scrollable
      // menu reaching for its bottom item) must not dismiss. Only ancestor
      // scrolls should — those mean the popover's anchor moved and the
      // position snapshot is stale. Window-target scrolls (e.target === window)
      // are not Nodes; treat those as outside-content and dismiss.
      const target = e.target
      if (target instanceof Node && contentRef.current?.contains(target)) return
      onCloseRef.current()
    }
    function handleResize() {
      onCloseRef.current()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      onCloseRef.current()
      // Return focus to the trigger so keyboard users land where they started.
      // Only on Escape: outside-click/scroll/resize are user-initiated focus
      // changes (or implicit ones) and stealing focus back would feel wrong.
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', handleMouseDown)
    if (closeOnScroll) window.addEventListener('scroll', handleScroll, true)
    if (closeOnResize) window.addEventListener('resize', handleResize)
    if (closeOnEscape) document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      if (closeOnScroll) window.removeEventListener('scroll', handleScroll, true)
      if (closeOnResize) window.removeEventListener('resize', handleResize)
      if (closeOnEscape) document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, triggerRef, contentRef, closeOnScroll, closeOnResize, closeOnEscape])
}
