import { useEffect, useRef, type ReactNode } from 'react'

// Wrapper around the native <dialog> element opened with showModal(), which
// gives us focus trap, top-layer rendering, scroll lock, and Escape-to-close
// for free.
//
// Usage:
//   <Modal open={shown} onClose={() => setShown(false)} title="Confirm delete">
//     <div className="p-6">
//       <h2>Confirm delete</h2>
//       …
//     </div>
//   </Modal>
//
// `title` becomes the dialog's aria-label. Backdrop click closes by default;
// pass closeOnBackdropClick={false} for forms with unsaved drafts.
type Props = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Extra classes applied to the dialog element itself (sizing, max-height). */
  className?: string
  closeOnBackdropClick?: boolean
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  className,
  closeOnBackdropClick = true,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // Native showModal() auto-focuses the first sequentially focusable
      // descendant. On touch-open that lands a visible focus indicator on
      // whatever control happens to come first (e.g. the first toggle in
      // List options), which reads as an accidental selection. Pull focus
      // onto the dialog itself instead — tabIndex={-1} makes it
      // programmatically focusable without entering the tab order, so
      // keyboard users still Tab into the first real control next.
      // preventScroll avoids the browser scrolling the focused dialog into
      // view (it's already centered by showModal()).
      dialog.focus({ preventScroll: true })
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (!closeOnBackdropClick) return
    // With the current `p-0` dialog + inner-wrapper structure, a
    // target===currentTarget click represents a click on the ::backdrop
    // area: child elements own their own click targets, and the dialog
    // element has no padding region a click could land on without hitting
    // a child. If a future modal child leaves the dialog content area
    // exposed (e.g., reintroducing padding on the dialog itself), revisit
    // this — target===currentTarget would no longer be exclusively
    // backdrop. Today it is.
    if (e.target === e.currentTarget) e.currentTarget.close()
  }

  return (
    // The click-events-have-key-events / no-noninteractive-element-interactions
    // rules want a keyboard handler alongside this onClick. The keyboard
    // equivalent (Esc to close) is provided by the native <dialog> opened via
    // showModal() — the browser fires the dialog's `cancel`/`close` events,
    // which feed onClose. Backdrops are not focusable, so adding an
    // onKeyDown here would be unreachable for keyboard users.
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label={title}
      onClose={onClose}
      onClick={handleClick}
      // m-auto restores native dialog centering: the UA stylesheet's
      // dialog:modal { margin: auto } gets overridden by Tailwind preflight's
      // `* { margin: 0 }` (author origin > UA), so without this an opened
      // dialog renders pinned to top: 0; left: 0 instead of centered.
      // focus:outline-none suppresses any UA focus ring on the dialog
      // itself when we focus it after showModal() — the dialog is a
      // focus sink, not a visible target.
      className={`m-auto rounded-xl bg-white p-0 shadow-lg backdrop:bg-black/40 focus:outline-none ${className ?? ''}`}
    >
      {children}
    </dialog>
  )
}
