import { showToast } from './toast'

// Report a failure inline when the surface that issued the write is still on
// screen, and by toast when it is not. A panel inside a Modal must report inline
// (a toast raised behind an open top-layer <dialog> is never seen - the rule in
// src/lib/mutation-error-handler.ts), but by the time a slow request fails, that
// same Modal may have been closed by another action (mobile List options closes
// on Duplicate or Export) or unmounted, and an inline message written then is
// invisible too. Checked when the failure lands, not when the write was issued.
//
// `anchor` is any element that is always rendered by the panel. "On screen"
// means still in the document and not inside a closed <dialog>; Modal keeps its
// children mounted while closed, so being mounted alone does not prove it.
//
// Known limits, accepted: the fallback toast is itself hidden if a DIFFERENT
// modal is open when the failure lands (say, the same Share dialog closed and
// reopened mid-request), and a caller's per-call onError never runs at all once
// the caller has unmounted, so it never gets here. Closing both for good means
// rendering toasts in the top layer, which would retire the modal rule.
export function reportFailure(
  anchor: Element | null,
  message: string,
  showInline: (message: string) => void,
): void {
  const dialog = anchor?.closest('dialog')
  if (anchor?.isConnected && (!dialog || dialog.open)) showInline(message)
  else showToast(message, { type: 'error' })
}
