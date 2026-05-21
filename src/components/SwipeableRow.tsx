import { useRef, useState, type ReactNode } from 'react'

// Trailing-edge swipe action for a list row. Hand-rolled (no dependency) so it
// can coexist cleanly with the dnd-kit TouchSensor that owns vertical reorder:
//
//   - Touch/pen only. Mouse is ignored so it never races the MouseSensor on
//     a narrow desktop window; mouse users use the kebab / edit modal.
//   - Only a horizontal-dominant leftward drag past CLAIM_THRESHOLD is
//     claimed. A vertical-dominant move bails immediately, leaving the gesture
//     to the page (scroll) or to the reorder long-press.
//   - Because a swipe moves horizontally right away, it exceeds the reorder
//     sensor's 5px tolerance before its 200ms hold elapses, so the pending
//     drag self-cancels. Hold-still starts a reorder; swipe starts a reveal.
//
// Partial swipe snaps the row open to reveal the action button (tap it to
// fire). When allowFullSwipe is set, dragging past half the row width fires
// the action directly on release. While open, a tap anywhere on the row body
// closes it instead of activating the row's own tap handler.
type Props = {
  onAction: () => void
  /** Action button text and its accessible name. */
  label: string
  /** Tailwind bg/text classes for the revealed action panel. Default is a
   *  calm red (removal, but not as loud as a destructive delete). */
  actionClassName?: string
  /** Panel classes while the drag is past the full-swipe threshold, i.e.
   *  releasing now will fire the action — a slightly stronger red signals
   *  that armed state. Only meaningful when allowFullSwipe is set. */
  actionArmedClassName?: string
  /** When true, a long drag (past half the row) fires onAction on release.
   *  Leave false for destructive actions that must go through a confirm. */
  allowFullSwipe?: boolean
  children: ReactNode
}

const ACTION_WIDTH = 88
const CLAIM_THRESHOLD = 8
const FULL_SWIPE_RATIO = 0.5

export default function SwipeableRow({
  onAction,
  label,
  actionClassName = 'bg-red-50 text-red-700',
  actionArmedClassName = 'bg-red-100 text-red-700',
  allowFullSwipe = false,
  children,
}: Props) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Armed = a release now would cross the full-swipe threshold and fire the
  // action. Tracked in state (not derived from the gesture ref) so the panel
  // can recolor as feedback without reading a ref during render.
  const [armed, setArmed] = useState(false)
  const fgRef = useRef<HTMLDivElement>(null)
  // Keep the live distance outside React state so pointer-up can settle from
  // the final move value even if React has not flushed the last setState yet.
  const dxRef = useRef(0)
  const g = useRef({ startX: 0, startY: 0, base: 0, claimed: false, bailed: false, width: 0 })

  function setVisualDx(next: number) {
    dxRef.current = next
    setDx(next)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse') return
    g.current = {
      startX: e.clientX,
      startY: e.clientY,
      base: dx,
      claimed: false,
      bailed: false,
      width: fgRef.current?.offsetWidth ?? 0,
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = g.current
    if (e.pointerType === 'mouse' || s.bailed) return
    const ddx = e.clientX - s.startX
    const ddy = e.clientY - s.startY
    if (!s.claimed) {
      if (Math.abs(ddx) < CLAIM_THRESHOLD && Math.abs(ddy) < CLAIM_THRESHOLD) return
      // Vertical-dominant gesture: let the page scroll or the reorder
      // long-press take it. Bail for the rest of this pointer sequence.
      if (Math.abs(ddy) >= Math.abs(ddx)) {
        s.bailed = true
        return
      }
      s.claimed = true
      setDragging(true)
      fgRef.current?.setPointerCapture(e.pointerId)
    }
    const next = Math.min(0, Math.max(-s.width, s.base + ddx))
    e.preventDefault()
    setVisualDx(next)
    setArmed(allowFullSwipe && s.width > 0 && -next >= s.width * FULL_SWIPE_RATIO)
  }

  function settle(e: React.PointerEvent) {
    const s = g.current
    if (e.pointerType === 'mouse' || !s.claimed) return
    s.claimed = false
    setDragging(false)
    setArmed(false)
    if (fgRef.current?.hasPointerCapture(e.pointerId)) {
      fgRef.current.releasePointerCapture(e.pointerId)
    }
    const dragged = -dxRef.current
    if (allowFullSwipe && dragged >= s.width * FULL_SWIPE_RATIO) {
      setVisualDx(0)
      onAction()
    } else if (dragged >= ACTION_WIDTH * 0.6) {
      setVisualDx(-ACTION_WIDTH)
    } else {
      setVisualDx(0)
    }
  }

  const open = dx !== 0

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Action revealed behind the row, anchored to the trailing edge. */}
      <div className="absolute inset-y-0 right-0 flex">
        <button
          type="button"
          onClick={() => {
            setVisualDx(0)
            onAction()
          }}
          aria-label={label}
          tabIndex={open ? 0 : -1}
          className={`flex w-[88px] items-center justify-center text-sm font-medium ${armed ? actionArmedClassName : actionClassName}`}
        >
          {label}
        </button>
      </div>
      {/* Foreground row content; translates left to reveal the action. */}
      <div
        ref={fgRef}
        className="relative bg-white"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 150ms ease',
          // Allow normal vertical page scroll, but keep horizontal swipes in
          // this component instead of letting the browser cancel pointer moves.
          touchAction: 'pan-y',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={settle}
        onPointerCancel={settle}
      >
        {children}
        {/* While open, intercept taps to close instead of activating the row
            body (which would open the edit modal). Absent when closed so
            normal taps pass straight through. */}
        {open && (
          <button
            type="button"
            aria-label="Close"
            onClick={() => setVisualDx(0)}
            className="absolute inset-0"
          />
        )}
      </div>
    </div>
  )
}
