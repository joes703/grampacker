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
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (!closeOnBackdropClick) return
    if (e.target !== e.currentTarget) return
    // Click registered on the dialog element itself (not a child). Compare
    // coords against the dialog's box; if outside, the user clicked the
    // backdrop.
    const rect = e.currentTarget.getBoundingClientRect()
    if (
      e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom
    ) {
      e.currentTarget.close()
    }
  }

  return (
    // The click-events-have-key-events / no-noninteractive-element-interactions
    // rules want a keyboard handler alongside this onClick. The keyboard
    // equivalent (Esc to close) is provided by the native <dialog> opened via
    // showModal() — the browser fires the dialog's `cancel`/`close` events,
    // which feed onClose. Backdrops are not focusable, so adding an
    // onKeyDown here would be unreachable for keyboard users.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop click; Esc handled by native <dialog>
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={handleClick}
      // m-auto restores native dialog centering: the UA stylesheet's
      // dialog:modal { margin: auto } gets overridden by Tailwind preflight's
      // `* { margin: 0 }` (author origin > UA), so without this an opened
      // dialog renders pinned to top: 0; left: 0 instead of centered.
      className={`m-auto rounded-xl bg-white p-0 shadow-lg backdrop:bg-black/40 ${className ?? ''}`}
    >
      {children}
    </dialog>
  )
}
