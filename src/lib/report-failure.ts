import { showToast } from './toast'

// Report a failure inline when the surface that issued the write is still on
// screen, and by toast when it is not. A panel inside a Modal reports inline (the
// modal rule in src/lib/mutation-error-handler.ts: the error belongs beside the
// form), but by the time a slow request fails, that same Modal may have been
// closed by another action (mobile List options closes on Duplicate or Export) or
// unmounted, and an inline message written then is invisible. Checked when the
// failure lands, not when the write was issued. The toast is seen even if some
// other modal is open by then (src/lib/toast-host.ts).
//
// `anchor` is any element that is always rendered by the panel. "On screen"
// means still in the document and not inside a closed <dialog>; Modal keeps its
// children mounted while closed, so being mounted alone does not prove it.
//
// Known limits, accepted: an anchor in an open dialog that ANOTHER modal has
// since covered still counts as on screen, so the message goes inline, behind
// the top one; and a caller's per-call onError never runs at all once the
// caller has unmounted (TanStack drops per-call callbacks), so it never gets here.
export function reportFailure(
  anchor: Element | null,
  message: string,
  showInline: (message: string) => void,
): void {
  const dialog = anchor?.closest('dialog')
  if (anchor?.isConnected && (!dialog || dialog.open)) showInline(message)
  else showToast(message, { type: 'error' })
}
