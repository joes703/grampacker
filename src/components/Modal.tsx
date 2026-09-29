import { useEffect, useRef, type ReactNode } from 'react'
import { addToastHost, removeToastHost } from '../lib/toast-host'

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
  /**
   * Block every dismissal path (Escape, backdrop) while true - for dialogs
   * that must stay up during an in-flight save. This must intercept the
   * native CANCELABLE `cancel` event: a guard on onClose alone runs AFTER
   * the dialog has already closed itself, leaving the parent's open state
   * pointing at a hidden dialog with no way back to the error/retry UI.
   */
  preventDismiss?: boolean
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  className,
  closeOnBackdropClick = true,
  preventDismiss = false,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  // Where ToastViewport renders while this dialog is open (src/lib/toast-host.ts):
  // a toast outside an open modal dialog is painted behind it and inert. The
  // host stack must follow the NATIVE dialog, which can close (Escape, backdrop)
  // or reopen (preventDismiss) without `open` changing, so it is updated at
  // every showModal()/close, not only when the prop flips.
  const slotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dialog = ref.current
    const slot = slotRef.current
    if (!dialog || !slot) return
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
    // The cleanup unregisters when `open` flips false (the native `close` event
    // is queued, so handleClose alone would leave the host pointing into a
    // hidden dialog until it lands), on unmount while open, and in StrictMode's
    // replay, whose re-adds run in effect order and so keep showModal() order.
    if (dialog.open) addToastHost(slot)
    return () => removeToastHost(slot)
  }, [open])

  // Escape (and other user-agent dismissals) fire a cancelable `cancel`
  // event BEFORE the dialog closes - this is the only point where dismissal
  // can actually be stopped.
  function handleCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    if (preventDismiss) e.preventDefault()
  }

  // The `close` event fires after the dialog has closed. Normally it feeds
  // onClose so the parent drops its open state. Under preventDismiss a close
  // can still slip through (e.g. a close watcher skipping the second
  // Escape's cancel): reopen and swallow it rather than desync from the
  // parent, which still renders the dialog as open.
  function handleClose(e: React.SyntheticEvent<HTMLDialogElement>) {
    const dialog = e.currentTarget
    const slot = slotRef.current
    // Checks the dialog, not the event: a close queued before a reopen arrives
    // after it, and must not unregister the dialog that is open again.
    if (slot && !dialog.open) removeToastHost(slot)
    if (preventDismiss) {
      if (open && !dialog.open) {
        dialog.showModal()
        if (slot) addToastHost(slot)
      }
      return
    }
    onClose()
  }

  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (!closeOnBackdropClick || preventDismiss) return
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
      onCancel={handleCancel}
      onClose={handleClose}
      onClick={handleClick}
      // m-auto restores native dialog centering: the UA stylesheet's
      // dialog:modal { margin: auto } gets overridden by Tailwind preflight's
      // `* { margin: 0 }` (author origin > UA), so without this an opened
      // dialog renders pinned to top: 0; left: 0 instead of centered.
      // focus:outline-none suppresses any UA focus ring on the dialog
      // itself when we focus it after showModal() — the dialog is a
      // focus sink, not a visible target.
      // print:hidden: an open modal <dialog> is in the TOP LAYER, so it
      // paints over the document on paper as well as on screen. Covers
      // every dialog - ConfirmDialog, MobileOptionsModal, Settings.
      className={`m-auto rounded-xl bg-white p-0 shadow-lg backdrop:bg-black/40 focus:outline-none print:hidden ${className ?? ''}`}
    >
      {children}
      {/* The toast region portaled in here is position: fixed and relies on the
          VIEWPORT staying its containing block, so it sits where it does
          outside a modal and the dialog's overflow does not clip it. Anything
          that makes the dialog a containing block for fixed descendants breaks
          that: transform, translate/scale/rotate, perspective, filter,
          backdrop-filter, contain (layout/paint), or will-change naming one of
          them - on the dialog, its className, or this slot. */}
      <div ref={slotRef} />
    </dialog>
  )
}
