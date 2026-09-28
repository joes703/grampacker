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
export function reportFailure(
  anchor: Element | null,
  message: string,
  showInline: (message: string) => void,
): void {
  const dialog = anchor?.closest('dialog')
  if (anchor?.isConnected && (!dialog || dialog.open)) showInline(message)
  else showToast(message, { type: 'error' })
}
